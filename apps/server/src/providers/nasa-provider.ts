import { join } from 'node:path';

import type { RuntimePaths } from '@autom/config';
import type { AssetReference, ContentProfile, SceneSpec } from '@autom/contracts';

import { ensureJobArtifactDirectory, writeArtifactFile } from '../lib/artifacts.js';
import type { ProviderTaskResult, VisualCandidate, VisualScenePlan } from '../domains/pipeline/types.js';
import type { VisualSceneProvider } from '../lib/types.js';
import {
  hasExactEntityMatch,
  matchTerms,
  scoreVisualCandidate,
} from '../domains/visuals/visual-ranking.js';

/**
 * NASA Images and Video Library provider.
 *
 * Free, no API key required. All content is in the public domain — NASA does
 * not license its materials (17 U.S.C. § 105).
 *
 * Best for scenes involving: space, technology, earth observation, science,
 * astronauts, rockets, satellite imagery, climate, atmosphere.
 *
 * API: https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf
 */

const NASA_SEARCH_ENDPOINT = 'https://images-api.nasa.gov/search';
const PER_QUERY_TIMEOUT_MS = 8_000;

type NasaSearchItem = {
  href?: string;
  data?: Array<{
    nasa_id?: string;
    title?: string;
    description?: string;
    keywords?: string[];
    media_type?: string;
    date_created?: string;
    photographer?: string;
    center?: string;
  }>;
  links?: Array<{
    href?: string;
    rel?: string;
    render?: string;
  }>;
};

type NasaSearchResponse = {
  collection?: {
    items?: NasaSearchItem[];
  };
};

type NasaAssetResponse = {
  collection?: {
    items?: Array<{ href?: string }>;
  };
};

export class NasaVisualProvider implements VisualSceneProvider {
  readonly family = 'nasa' as const;

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

    for (const query of input.plan.queries.slice(0, 2)) {
      if (candidates.length >= 3) break;

      const items = await searchNasa(query).catch((error) => {
        warnings.push(
          `NASA search failed for "${query}": ${error instanceof Error ? error.message : 'unknown error'}`
        );
        return [] as NasaSearchItem[];
      });

      for (const item of items.slice(0, 3)) {
        if (candidates.length >= 4) break;

        const meta = item.data?.[0];
        if (!meta?.nasa_id) continue;

        const fileUrl = await resolveNasaFileUrl(item, meta.nasa_id, meta.media_type).catch(
          () => null
        );
        if (!fileUrl) continue;

        const isVideo = meta.media_type === 'video';
        const extension = isVideo ? '.mp4' : '.jpg';
        const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
        const outputPath = join(
          directory,
          `scene-${input.scene.order}-nasa-${candidates.length + 1}${extension}`
        );

        const downloaded = await downloadFile(fileUrl).catch((error) => {
          warnings.push(
            `NASA download failed for "${meta.nasa_id}": ${error instanceof Error ? error.message : 'error'}`
          );
          return null;
        });

        if (!downloaded) continue;

        await writeArtifactFile(outputPath, downloaded);

        const titleText = meta.title ?? query;
        const snippetText = (meta.description ?? '').slice(0, 200);
        const haystack = `${titleText} ${snippetText} ${(meta.keywords ?? []).join(' ')}`;

        candidates.push({
          asset: buildAssetReference({
            outputPath,
            sceneOrder: input.scene.order,
            query,
            nasaId: meta.nasa_id,
            title: titleText,
            isVideo,
            mimeType,
            entityLabel: input.plan.keyEntities[0] ?? null,
          }),
          score: scoreVisualCandidate(
            {
              title: titleText,
              snippet: snippetText,
              query,
              retrievalOrigin: 'entity',
              mimeType,
              sourceProvider: 'nasa',
            },
            input.plan
          ),
          providerFamily: 'nasa' as never,
          exactEntityMatch: hasExactEntityMatch(haystack, input.plan.keyEntities),
          matchedTerms: matchTerms(haystack, input.plan.queries),
        });
      }
    }

    return {
      provider: 'nasa',
      data: candidates,
      warnings,
      degraded: candidates.length === 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function searchNasa(query: string): Promise<NasaSearchItem[]> {
  const url = new URL(NASA_SEARCH_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('media_type', 'image,video');
  url.searchParams.set('page_size', '8');

  const response = await fetch(url, {
    signal: AbortSignal.timeout(PER_QUERY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`NASA search returned ${response.status}`);
  }

  const payload = (await response.json()) as NasaSearchResponse;
  return payload.collection?.items ?? [];
}

async function resolveNasaFileUrl(
  item: NasaSearchItem,
  nasaId: string,
  mediaType?: string
): Promise<string | null> {
  // For images, the thumbnail link in the search result is directly usable
  if (mediaType !== 'video') {
    const imageLink = item.links?.find(
      (l) => l.rel === 'preview' || l.render === 'image'
    )?.href;
    if (imageLink) return imageLink;
  }

  // For video (or when no direct link exists), fetch the asset manifest
  if (!item.href) return null;

  const assetResponse = await fetch(item.href, {
    signal: AbortSignal.timeout(PER_QUERY_TIMEOUT_MS),
  });

  if (!assetResponse.ok) return null;

  const assetPayload = (await assetResponse.json()) as NasaAssetResponse;
  const assetItems = assetPayload.collection?.items ?? [];

  // Prefer MP4 for video, JPEG for images
  const preferred = mediaType === 'video'
    ? assetItems.find((a) => /~mobile\.mp4$|\.mp4$/i.test(a.href ?? ''))
    : assetItems.find((a) => /~medium\.jpg$|\.jpg$|\.jpeg$/i.test(a.href ?? ''));

  return preferred?.href ?? assetItems[0]?.href ?? null;
}

async function downloadFile(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PER_QUERY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function buildAssetReference(input: {
  outputPath: string;
  sceneOrder: number;
  query: string;
  nasaId: string;
  title: string;
  isVideo: boolean;
  mimeType: string;
  entityLabel: string | null;
}): AssetReference {
  return {
    kind: input.isVideo ? 'video' : 'metadata',
    path: input.outputPath,
    label: `NASA: ${input.title.slice(0, 80)}`,
    provider: 'wikimedia', // closest existing AssetReference provider value
    sourceUrl: `https://images.nasa.gov/details-${input.nasaId}`,
    mimeType: input.mimeType,
    externalId: input.nasaId,
    sceneOrder: input.sceneOrder,
    query: input.query,
    retrievalOrigin: 'entity',
    licenseLabel: 'Public Domain (NASA)',
    rightsSummary: 'NASA content is not subject to copyright and is in the public domain.',
    attributionRequired: false,
    entityLabel: input.entityLabel,
    matchQuality: null,
    reuseStatus: null,
  };
}
