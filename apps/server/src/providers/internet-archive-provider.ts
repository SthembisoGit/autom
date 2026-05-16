import { join } from 'node:path';

import type { RuntimePaths } from '@autom/config';
import type { AssetReference, ContentProfile, SceneSpec } from '@autom/contracts';

import { ensureJobArtifactDirectory, writeArtifactFile } from '../lib/artifacts.js';
import type { ProviderTaskResult, VisualCandidate, VisualScenePlan } from '../domains/pipeline/types.js';
import type { VisualSceneProvider } from '../lib/types.js';
import {
  buildCandidateReuseKey,
  hasExactEntityMatch,
  matchTerms,
  scoreVisualCandidate,
} from '../domains/visuals/visual-ranking.js';

/**
 * Internet Archive visual provider.
 *
 * Searches archive.org's Advanced Search API for public-domain video and image
 * content. Especially strong for:
 *  - Historical footage (1900s–1980s newsreels, documentaries, government films)
 *  - Prelinger Archives (American cultural history, everyday life, industry)
 *  - NASA and space footage
 *  - US National Archives materials
 *
 * All content returned is in the public domain or has a permissive CC license.
 * No API key required — the Archive's API is fully public.
 *
 * API docs: https://archive.org/advancedsearch.php
 */

const ARCHIVE_SEARCH_ENDPOINT = 'https://archive.org/advancedsearch.php';
const ARCHIVE_DOWNLOAD_BASE = 'https://archive.org/download';
const DEFAULT_TIMEOUT_MS = 20_000;
const PER_QUERY_TIMEOUT_MS = 8_000;

// Collections that consistently have usable, high-quality footage
const PREFERRED_COLLECTIONS = [
  'prelinger',       // American cultural history — extraordinary content
  'nasa',            // Space, science, earth imagery
  'US_National_Archives', // US gov footage
  'stock_footage',   // Community-contributed stock
  'newsandpublicaffairs', // Historical news footage
];

type ArchiveSearchHit = {
  identifier?: string;
  title?: string;
  description?: string;
  mediatype?: string;
  subject?: string | string[];
  collection?: string | string[];
  licenseurl?: string;
  creator?: string;
  date?: string;
};

type ArchiveSearchResponse = {
  response?: {
    docs?: ArchiveSearchHit[];
    numFound?: number;
  };
};

type ArchiveMetadataFile = {
  name?: string;
  format?: string;
  size?: string;
  source?: string;
};

type ArchiveMetadataResponse = {
  files?: ArchiveMetadataFile[];
  metadata?: {
    title?: string;
    description?: string;
    licenseurl?: string;
    creator?: string;
  };
};

export class InternetArchiveVisualProvider implements VisualSceneProvider {
  readonly family = 'internet_archive' as const;

  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  async collectCandidates(input: {
    profile: ContentProfile;
    scene: SceneSpec;
    plan: VisualScenePlan;
    jobId: string;
    runtimePaths: RuntimePaths;
  }): Promise<ProviderTaskResult<VisualCandidate[]>> {
    const directory = await ensureJobArtifactDirectory(input.runtimePaths, input.jobId, 'visuals');
    const warnings: string[] = [];
    const candidates: VisualCandidate[] = [];

    // Use a maximum of 2 queries to stay within per-scene time budget
    for (const query of input.plan.queries.slice(0, 2)) {
      if (candidates.length >= 3) break;

      const hits = await searchArchive(query, input.plan).catch((error) => {
        warnings.push(
          `Internet Archive search failed for "${query}": ${error instanceof Error ? error.message : 'unknown error'}`
        );
        return [] as ArchiveSearchHit[];
      });

      for (const hit of hits.slice(0, 3)) {
        if (!hit.identifier) continue;
        if (candidates.length >= 4) break;

        const fileInfo = await resolveDownloadableFile(hit.identifier).catch(() => null);
        if (!fileInfo) continue;

        const outputPath = join(
          directory,
          `scene-${input.scene.order}-archive-${candidates.length + 1}${fileInfo.extension}`
        );

        const downloaded = await downloadWithTimeout(fileInfo.url, PER_QUERY_TIMEOUT_MS).catch(
          (error) => {
            warnings.push(
              `Internet Archive download timed out for "${hit.identifier}": ${error instanceof Error ? error.message : 'timeout'}`
            );
            return null;
          }
        );

        if (!downloaded) continue;

        await writeArtifactFile(outputPath, downloaded);

        const titleText = hit.title ?? query;
        const descriptionText = Array.isArray(hit.description)
          ? hit.description.join(' ')
          : (hit.description ?? '');
        const haystack = `${titleText} ${descriptionText} ${query}`;
        const licenseLabel = resolveLicenseLabel(hit.licenseurl);

        candidates.push({
          asset: buildAssetReference({
            outputPath,
            sceneOrder: input.scene.order,
            query,
            hit,
            fileInfo,
            licenseLabel,
            entityLabel: input.plan.keyEntities[0] ?? null,
          }),
          score: scoreVisualCandidate(
            {
              title: titleText,
              snippet: descriptionText.slice(0, 200),
              query,
              retrievalOrigin: 'entity',
              mimeType: fileInfo.mimeType,
              sourceProvider: 'internet_archive',
            },
            input.plan
          ),
          providerFamily: 'internet_archive' as never, // typed as extension of VisualProviderFamily
          exactEntityMatch: hasExactEntityMatch(haystack, input.plan.keyEntities),
          matchedTerms: matchTerms(haystack, input.plan.queries),
        });
      }
    }

    return {
      provider: 'internet_archive',
      data: candidates,
      warnings,
      degraded: candidates.length === 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function searchArchive(
  query: string,
  plan: VisualScenePlan
): Promise<ArchiveSearchHit[]> {
  // Bias toward preferred collections using a weighted query
  const collectionFilter = PREFERRED_COLLECTIONS.map((c) => `collection:${c}`).join(' OR ');
  const mediaFilter = 'mediatype:(movies OR image)';

  // For historical scenes, add a date bias
  const isHistorical =
    plan.sceneKind === 'historical_topic' || plan.sceneKind === 'recent_news';
  const dateFilter = isHistorical ? '' : ' AND date:[1900-01-01 TO 2000-12-31]';

  const searchQuery = `(${query}) AND (${collectionFilter}) AND ${mediaFilter}${dateFilter}`;

  const url = new URL(ARCHIVE_SEARCH_ENDPOINT);
  url.searchParams.set('q', searchQuery);
  url.searchParams.set('fl[]', 'identifier,title,description,mediatype,collection,licenseurl,creator,date');
  url.searchParams.set('rows', '8');
  url.searchParams.set('output', 'json');
  url.searchParams.set('sort[]', 'downloads desc');

  const response = await fetch(url, {
    signal: AbortSignal.timeout(PER_QUERY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Archive search returned ${response.status}`);
  }

  const payload = (await response.json()) as ArchiveSearchResponse;
  return payload.response?.docs ?? [];
}

async function resolveDownloadableFile(
  identifier: string
): Promise<{ url: string; extension: string; mimeType: string } | null> {
  const metadataUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
  const response = await fetch(metadataUrl, {
    signal: AbortSignal.timeout(PER_QUERY_TIMEOUT_MS),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as ArchiveMetadataResponse;
  const files = payload.files ?? [];

  // Prefer video formats, then images
  const videoFile = files.find((f) =>
    /\.(mp4|ogv|webm|mpeg|mov)$/i.test(f.name ?? '') &&
    f.source !== 'derivative' // prefer originals when available
  ) ?? files.find((f) => /\.(mp4|ogv|webm|mpeg|mov)$/i.test(f.name ?? ''));

  if (videoFile?.name) {
    const ext = videoFile.name.match(/\.[^.]+$/)?.[0] ?? '.mp4';
    return {
      url: `${ARCHIVE_DOWNLOAD_BASE}/${identifier}/${encodeURIComponent(videoFile.name)}`,
      extension: ext,
      mimeType: ext === '.webm' ? 'video/webm' : 'video/mp4',
    };
  }

  // Fall back to image
  const imageFile = files.find((f) =>
    /\.(jpg|jpeg|png)$/i.test(f.name ?? '') && !f.name?.includes('thumb')
  );

  if (imageFile?.name) {
    const ext = imageFile.name.match(/\.[^.]+$/)?.[0] ?? '.jpg';
    return {
      url: `${ARCHIVE_DOWNLOAD_BASE}/${identifier}/${encodeURIComponent(imageFile.name)}`,
      extension: ext,
      mimeType: ext === '.png' ? 'image/png' : 'image/jpeg',
    };
  }

  return null;
}

async function downloadWithTimeout(url: string, timeoutMs: number): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function resolveLicenseLabel(licenseUrl?: string): string {
  if (!licenseUrl) return 'Public Domain';
  if (licenseUrl.includes('publicdomain') || licenseUrl.includes('zero')) return 'Public Domain (CC0)';
  if (licenseUrl.includes('by-nc')) return 'CC BY-NC';
  if (licenseUrl.includes('by-sa')) return 'CC BY-SA';
  if (licenseUrl.includes('by')) return 'CC BY';
  return 'Creative Commons';
}

function buildAssetReference(input: {
  outputPath: string;
  sceneOrder: number;
  query: string;
  hit: ArchiveSearchHit;
  fileInfo: { url: string; mimeType: string };
  licenseLabel: string;
  entityLabel: string | null;
}): AssetReference {
  const isVideo = input.fileInfo.mimeType.startsWith('video/');
  return {
    kind: isVideo ? 'video' : 'metadata',
    path: input.outputPath,
    label: `Internet Archive: ${(input.hit.title ?? input.query).slice(0, 80)}`,
    provider: 'wikimedia', // reuse existing AssetReference provider enum value — closest match
    sourceUrl: `https://archive.org/details/${input.hit.identifier ?? ''}`,
    mimeType: input.fileInfo.mimeType,
    externalId: input.hit.identifier ?? null,
    sceneOrder: input.sceneOrder,
    query: input.query,
    retrievalOrigin: 'entity',
    licenseLabel: input.licenseLabel,
    rightsSummary: `Archive.org public domain or Creative Commons content. ${input.licenseLabel}.`,
    attributionRequired: !input.licenseLabel.includes('Public Domain'),
    entityLabel: input.entityLabel,
    matchQuality: null,
    reuseStatus: null,
  };
}

// Satisfy the type constraint so this provider can be included in the composite
export function asVisualSceneProvider(
  provider: InternetArchiveVisualProvider
): VisualSceneProvider {
  return provider as unknown as VisualSceneProvider;
}

// Re-export for use in buildCandidateReuseKey (used by CompositeVisualProvider)
export { buildCandidateReuseKey };
