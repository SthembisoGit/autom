import { join } from 'node:path';

import type { AppEnv, RuntimePaths } from '@autom/config';
import type {
  AssetReference,
  ContentProfile,
  SceneSpec,
  ScriptPackage,
  VisualSelectionOutcome,
} from '@autom/contracts';

import type {
  ContentBrief,
  ProviderTaskResult,
  VisualCandidate,
  VisualProviderFamily,
  VisualScenePlan,
} from '../domains/pipeline/types.js';
import { createContentOrchestrator } from '../domains/research/content-orchestrator.js';
import { createNewsProvider } from '../domains/research/news-provider.js';
import { isExactVisualMatchRequired } from '../domains/visuals/visual-coverage.js';
import {
  buildCandidateReuseKey,
  chooseBestVisualCandidate,
  hasExactEntityMatch,
  matchTerms,
  scoreVisualCandidate,
} from '../domains/visuals/visual-ranking.js';
import {
  buildVisualScenePlan,
  classifySceneKind,
} from '../domains/visuals/visual-source-planner.js';
import { ensureJobArtifactDirectory, writeArtifactFile } from '../lib/artifacts.js';
import type { VisualProvider, VisualSceneProvider } from '../lib/types.js';
import { WARNING_CODE, withWarningCode } from '../lib/warning-codes.js';
import { InternetArchiveVisualProvider } from './internet-archive-provider.js';
import { NasaVisualProvider } from './nasa-provider.js';

export { buildVisualScenePlan } from '../domains/visuals/visual-source-planner.js';

const PEXELS_SEARCH_ENDPOINT = 'https://api.pexels.com/videos/search';
const PIXABAY_VIDEO_ENDPOINT = 'https://pixabay.com/api/videos/';
const UNSPLASH_SEARCH_ENDPOINT = 'https://api.unsplash.com/search/photos';
const WIKIMEDIA_SEARCH_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

type PexelsVideoFile = {
  id?: number;
  file_type?: string;
  height?: number;
  link?: string;
  quality?: string;
  width?: number;
};

type PexelsVideo = {
  id?: number;
  image?: string;
  url?: string;
  user?: {
    name?: string;
    url?: string;
  };
  video_files?: PexelsVideoFile[];
};

type PexelsSearchResponse = {
  videos?: PexelsVideo[];
};

type PixabayVideoVariant = {
  url?: string;
  width?: number;
  height?: number;
};

type PixabayHit = {
  id?: number;
  tags?: string;
  pageURL?: string;
  user?: string;
  videos?: Record<string, PixabayVideoVariant>;
};

type PixabayResponse = {
  hits?: PixabayHit[];
};

type UnsplashPhoto = {
  id?: string;
  alt_description?: string | null;
  description?: string | null;
  urls?: {
    regular?: string;
  };
  links?: {
    html?: string;
  };
  user?: {
    name?: string;
  };
};

type UnsplashResponse = {
  results?: UnsplashPhoto[];
};

type WikimediaSearchResponse = {
  query?: {
    search?: Array<{
      title?: string;
      pageid?: number;
      snippet?: string;
    }>;
  };
};

type WikimediaImageInfoResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: Array<{
          url?: string;
          thumburl?: string;
          mime?: string;
          extmetadata?: Record<string, { value?: string }>;
        }>;
      }
    >;
  };
};

type CompositeVisualProviderOptions = {
  pexels?: VisualSceneProvider | null;
  pixabay?: VisualSceneProvider | null;
  wikimedia?: VisualSceneProvider | null;
  newsContext?: VisualSceneProvider | null;
  internetArchive?: VisualSceneProvider | null;
  nasa?: VisualSceneProvider | null;
  contentBriefResolver?:
    | ((profile: ContentProfile, topic: string) => Promise<ContentBrief | null>)
    | null;
};

export class LocalVisualProvider implements VisualProvider {
  async select(input: {
    scriptPackage: ScriptPackage;
    profile: ContentProfile;
    jobId: string;
    runtimePaths: RuntimePaths;
    excludeSceneOrders?: number[];
  }) {
    const visualSelectionOutcomes: VisualSelectionOutcome[] = input.scriptPackage.scenes.map(
      (scene) => {
        const sceneKind = classifySceneKind(scene, null);
        return {
          sceneOrder: scene.order,
          sceneKind,
          exactMatchRequired: isExactVisualMatchRequired(sceneKind),
          status: 'fallback',
          providerFamily: null,
          selectedQuery: scene.visualQuery,
        };
      }
    );

    return {
      selectedVisualQueries: input.scriptPackage.scenes.map((scene) => scene.visualQuery),
      assetReferences: [],
      warnings: ['Using local visual fallback. No visual source providers are configured.'],
      visualSelectionOutcomes,
    };
  }
}

export class CompositeVisualProvider implements VisualProvider {
  private readonly sceneProviders: Map<VisualProviderFamily, VisualSceneProvider>;
  private readonly contentBriefResolver:
    | ((profile: ContentProfile, topic: string) => Promise<ContentBrief | null>)
    | null;

  constructor(options: CompositeVisualProviderOptions) {
    this.sceneProviders = new Map(
      [
        options.newsContext ?? null,
        options.internetArchive ?? null,
        options.nasa ?? null,
        options.wikimedia ?? null,
        options.pixabay ?? null,
        options.pexels ?? null,
      ]
        .filter((provider): provider is VisualSceneProvider => Boolean(provider))
        .map((provider) => [provider.family, provider])
    );
    this.contentBriefResolver = options.contentBriefResolver ?? null;
  }

  async select(input: {
    scriptPackage: ScriptPackage;
    profile: ContentProfile;
    jobId: string;
    runtimePaths: RuntimePaths;
    excludeSceneOrders?: number[];
  }) {
    const warnings: string[] = [];
    const selectedVisualQueries: string[] = [];
    const assetReferences: AssetReference[] = [];
    const visualSelectionOutcomes: VisualSelectionOutcome[] = [];
    const usedCandidateKeys = new Set<string>();
    const contentBrief = this.contentBriefResolver
      ? await this.contentBriefResolver(input.profile, input.scriptPackage.title).catch(() => null)
      : null;

    for (const scene of input.scriptPackage.scenes) {
      if (input.excludeSceneOrders?.includes(scene.order)) {
        const skippedSceneKind = classifySceneKind(scene, contentBrief);
        selectedVisualQueries.push(scene.visualQuery);
        visualSelectionOutcomes.push({
          sceneOrder: scene.order,
          sceneKind: skippedSceneKind,
          exactMatchRequired: isExactVisualMatchRequired(skippedSceneKind),
          status: 'skipped',
          providerFamily: null,
          selectedQuery: scene.visualQuery,
        });
        continue;
      }

      const plannerResult = buildVisualScenePlan(scene, input.profile, contentBrief);
      warnings.push(...plannerResult.warnings);

      const candidates = await this.collectCandidatesForScene({
        scene,
        plan: plannerResult.plan,
        profile: input.profile,
        jobId: input.jobId,
        runtimePaths: input.runtimePaths,
      });

      warnings.push(...candidates.warnings);
      if (candidates.data.length === 0) {
        const selectedQuery = plannerResult.plan.queries[0] ?? scene.visualQuery;
        selectedVisualQueries.push(selectedQuery);
        warnings.push(
          withWarningCode(
            WARNING_CODE.VISUAL_NO_CANDIDATE,
            `No visual candidate found for scene ${scene.order}; renderer will use fallback visuals.`
          )
        );
        visualSelectionOutcomes.push({
          sceneOrder: scene.order,
          sceneKind: plannerResult.plan.sceneKind,
          exactMatchRequired: plannerResult.plan.exactMatchRequired,
          status: 'unresolved',
          providerFamily: null,
          selectedQuery,
        });
        continue;
      }

      const best = chooseBestVisualCandidate(
        candidates.data,
        plannerResult.plan,
        usedCandidateKeys
      );
      if (!best) {
        const selectedQuery = plannerResult.plan.queries[0] ?? scene.visualQuery;
        selectedVisualQueries.push(selectedQuery);
        warnings.push(
          plannerResult.plan.exactMatchRequired
            ? withWarningCode(
                WARNING_CODE.VISUAL_EXACT_NOT_FOUND,
                `Scene ${scene.order} could not find an exact factual visual match.`
              )
            : `Visual selection could not rank any candidate for scene ${scene.order}.`
        );
        visualSelectionOutcomes.push({
          sceneOrder: scene.order,
          sceneKind: plannerResult.plan.sceneKind,
          exactMatchRequired: plannerResult.plan.exactMatchRequired,
          status: 'unresolved',
          providerFamily: null,
          selectedQuery,
        });
        continue;
      }

      const selectedQuery = best.asset.query ?? plannerResult.plan.queries[0] ?? scene.visualQuery;
      selectedVisualQueries.push(selectedQuery);
      usedCandidateKeys.add(buildCandidateReuseKey(best.asset));
      assetReferences.push(best.asset);
      visualSelectionOutcomes.push({
        sceneOrder: scene.order,
        sceneKind: plannerResult.plan.sceneKind,
        exactMatchRequired: plannerResult.plan.exactMatchRequired,
        status:
          best.asset.matchQuality === 'exact'
            ? 'exact'
            : best.asset.matchQuality === 'relevant'
              ? 'relevant'
              : 'fallback',
        providerFamily: (best.providerFamily === 'internet_archive' || best.providerFamily === 'nasa')
          ? null
          : best.providerFamily,
        selectedQuery,
      });
      if (best.reuseBlockedCount > 0) {
        warnings.push(
          `Scene ${scene.order} blocked ${best.reuseBlockedCount} repeated clip candidate${
            best.reuseBlockedCount === 1 ? '' : 's'
          } before choosing ${best.asset.provider}.`
        );
      }
      if (best.forcedReuse) {
        warnings.push(
          `Scene ${scene.order} reused an existing source clip because no acceptable alternative was found.`
        );
      }
    }

    return {
      selectedVisualQueries:
        selectedVisualQueries.length > 0
          ? selectedVisualQueries
          : input.scriptPackage.scenes.map((scene) => scene.visualQuery),
      assetReferences,
      warnings,
      visualSelectionOutcomes,
    };
  }

  private async collectCandidatesForScene(input: {
    scene: SceneSpec;
    plan: VisualScenePlan;
    profile: ContentProfile;
    jobId: string;
    runtimePaths: RuntimePaths;
  }): Promise<ProviderTaskResult<VisualCandidate[]>> {
    const results = await Promise.all(
      input.plan.preferredProviders.map(async (family) => {
        const provider = this.sceneProviders.get(family);
        if (!provider) {
          return null;
        }

        try {
          return await provider.collectCandidates({
            profile: input.profile,
            scene: input.scene,
            plan: input.plan,
            jobId: input.jobId,
            runtimePaths: input.runtimePaths,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : `Unknown ${family} visual failure.`;
          return {
            provider: family,
            data: [] as VisualCandidate[],
            warnings: [`${family} visual lookup failed for scene ${input.scene.order}. ${message}`],
            degraded: true,
          } satisfies ProviderTaskResult<VisualCandidate[]>;
        }
      })
    );

    const warnings: string[] = [];
    const candidates: VisualCandidate[] = [];
    for (const result of results) {
      if (!result) {
        continue;
      }

      warnings.push(...result.warnings);
      candidates.push(...result.data);
    }

    return {
      provider: 'composite',
      data: candidates,
      warnings,
      degraded: candidates.length === 0,
    };
  }
}

export class PexelsVisualProvider implements VisualSceneProvider {
  readonly family = 'pexels' as const;

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ) {}

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
    let candidateCount = 0;

    for (const query of input.plan.queries.slice(0, 2)) {
      const response = await fetch(
        `${PEXELS_SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait`,
        {
          headers: { Authorization: this.apiKey },
          signal: AbortSignal.timeout(8_000),
        }
      ).catch((error) => {
        if (isAbortError(error)) {
          warnings.push(`Pexels lookup timed out for "${query}".`);
          return null;
        }

        throw error;
      });

      if (!response) {
        continue;
      }

      if (!response.ok) {
        if ([401, 403, 429].includes(response.status)) {
          throw new Error(`Pexels lookup failed with status ${response.status}.`);
        }

        warnings.push(`Pexels lookup failed for "${query}".`);
        continue;
      }

      const payload = (await response.json()) as PexelsSearchResponse;
      const rankedVideos =
        payload.videos?.filter((candidate) => selectBestPortraitFile(candidate)) ?? [];
      if (rankedVideos.length === 0) {
        continue;
      }

      for (const video of rankedVideos.slice(0, 3)) {
        const file = selectBestPortraitFile(video);
        if (!file?.link) {
          continue;
        }

        const outputPath = join(
          directory,
          `scene-${input.scene.order}-pexels-${candidateCount + 1}.mp4`
        );
        const download = await fetch(file.link, {
          signal: AbortSignal.timeout(this.timeoutMs),
        }).catch((error) => {
          if (isAbortError(error)) {
            warnings.push(`Pexels download timed out for scene ${input.scene.order}.`);
            return null;
          }

          throw error;
        });

        if (!download?.ok) {
          warnings.push(`Pexels download failed for scene ${input.scene.order}.`);
          continue;
        }

        await writeArtifactFile(outputPath, Buffer.from(await download.arrayBuffer()));
        candidates.push({
          asset: buildVisualAssetReference({
            kind: 'video',
            outputPath,
            label: `Pexels clip for scene ${input.scene.order}`,
            provider: 'pexels',
            sourceUrl: video.url ?? file.link ?? null,
            mimeType: file.file_type ?? 'video/mp4',
            externalId: video.id || file.id ? [video.id, file.id].filter(Boolean).join(':') : null,
            sceneOrder: input.scene.order,
            query,
            retrievalOrigin: 'stock',
            licenseLabel: 'Pexels License',
            rightsSummary: 'Stock footage selected from Pexels for editorial visual support.',
            attributionRequired: false,
            entityLabel: input.plan.keyEntities[0] ?? null,
          }),
          score: scoreVisualCandidate(
            {
              title: `${query} ${video.user?.name ?? ''}`,
              snippet: query,
              query,
              retrievalOrigin: 'stock',
              mimeType: 'video/mp4',
            },
            input.plan
          ),
          providerFamily: 'pexels',
          exactEntityMatch: hasExactEntityMatch(
            `${query} ${video.user?.name ?? ''}`,
            input.plan.keyEntities
          ),
          matchedTerms: matchTerms(`${query} ${video.user?.name ?? ''}`, input.plan.queries),
        });
        candidateCount += 1;
        if (candidateCount >= 4) {
          break;
        }
      }

      if (candidateCount >= 4) {
        break;
      }
    }

    return {
      provider: 'pexels',
      data: candidates,
      warnings,
      degraded: candidates.length === 0,
    };
  }
}

export class PixabayVisualProvider implements VisualSceneProvider {
  readonly family = 'pixabay' as const;

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ) {}

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
    let candidateCount = 0;

    for (const query of input.plan.queries.slice(0, 2)) {
      const response = await fetch(
        `${PIXABAY_VIDEO_ENDPOINT}?key=${encodeURIComponent(this.apiKey)}&q=${encodeURIComponent(query)}&per_page=5`,
        {
          // 4s timeout — Pixabay is consistently slow; fail fast and fall through to Pexels.
          signal: AbortSignal.timeout(4_000),
        }
      ).catch((error) => {
        if (isAbortError(error)) {
          warnings.push(`Pixabay lookup timed out for "${query}".`);
          return null;
        }

        throw error;
      });

      if (!response) {
        continue;
      }

      if (!response.ok) {
        if ([401, 403, 429].includes(response.status)) {
          throw new Error(`Pixabay lookup failed with status ${response.status}. Check PIXABAY_API_KEY.`);
        }
        warnings.push(`Pixabay lookup failed for "${query}" (status ${response.status}).`);
        continue;
      }

      const payload = (await response.json()) as PixabayResponse;
      const hits =
        payload.hits?.filter((candidate) => selectBestPixabayVariant(candidate)?.url) ?? [];
      if (hits.length === 0) {
        continue;
      }

      for (const hit of hits.slice(0, 3)) {
        const variant = selectBestPixabayVariant(hit);
        if (!variant?.url) {
          continue;
        }

        const outputPath = join(
          directory,
          `scene-${input.scene.order}-pixabay-${candidateCount + 1}.mp4`
        );
        const download = await fetch(variant.url, {
          signal: AbortSignal.timeout(this.timeoutMs),
        }).catch((error) => {
          if (isAbortError(error)) {
            warnings.push(`Pixabay download timed out for scene ${input.scene.order}.`);
            return null;
          }

          throw error;
        });

        if (!download?.ok) {
          continue;
        }

        await writeArtifactFile(outputPath, Buffer.from(await download.arrayBuffer()));
        const title = hit.tags ?? query;
        candidates.push({
          asset: buildVisualAssetReference({
            kind: 'video',
            outputPath,
            label: `Pixabay clip for scene ${input.scene.order}`,
            provider: 'pixabay',
            sourceUrl: hit.pageURL ?? variant.url,
            mimeType: 'video/mp4',
            externalId: hit.id ? String(hit.id) : null,
            sceneOrder: input.scene.order,
            query,
            retrievalOrigin: 'stock',
            licenseLabel: 'Pixabay Content License',
            rightsSummary: 'Pixabay stock footage chosen for scene support.',
            attributionRequired: false,
            entityLabel: input.plan.keyEntities[0] ?? null,
          }),
          score: scoreVisualCandidate(
            {
              title,
              snippet: hit.user ?? '',
              query,
              retrievalOrigin: 'stock',
              mimeType: 'video/mp4',
            },
            input.plan
          ),
          providerFamily: 'pixabay',
          exactEntityMatch: hasExactEntityMatch(title, input.plan.keyEntities),
          matchedTerms: matchTerms(title, input.plan.queries),
        });
        candidateCount += 1;
        if (candidateCount >= 4) {
          break;
        }
      }

      if (candidateCount >= 4) {
        break;
      }
    }

    return {
      provider: 'pixabay',
      data: candidates,
      warnings,
      degraded: candidates.length === 0,
    };
  }
}

export class UnsplashPhotoProvider implements VisualSceneProvider {
  readonly family = 'unsplash' as const;

  constructor(
    private readonly accessKey: string,
    private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ) {}

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

    for (const query of input.plan.queries.slice(0, 3)) {
      const response = await fetch(
        `${UNSPLASH_SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=3&orientation=portrait`,
        {
          headers: {
            Authorization: `Client-ID ${this.accessKey}`,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        }
      ).catch((error) => {
        if (isAbortError(error)) {
          warnings.push(`Unsplash lookup timed out for "${query}".`);
          return null;
        }

        throw error;
      });

      if (!response?.ok) {
        continue;
      }

      const payload = (await response.json()) as UnsplashResponse;
      const photo = payload.results?.find((candidate) => candidate.urls?.regular);
      if (!photo?.urls?.regular) {
        continue;
      }

      const outputPath = join(directory, `scene-${input.scene.order}-unsplash.jpg`);
      const download = await fetch(photo.urls.regular, {
        signal: AbortSignal.timeout(this.timeoutMs),
      }).catch((error) => {
        if (isAbortError(error)) {
          warnings.push(`Unsplash download timed out for scene ${input.scene.order}.`);
          return null;
        }

        throw error;
      });

      if (!download?.ok) {
        continue;
      }

      await writeArtifactFile(outputPath, Buffer.from(await download.arrayBuffer()));
      const title = photo.description ?? photo.alt_description ?? query;
      candidates.push({
        asset: buildVisualAssetReference({
          kind: 'metadata',
          outputPath,
          label: `Unsplash image for scene ${input.scene.order}`,
          provider: 'unsplash',
          sourceUrl: photo.links?.html ?? photo.urls.regular,
          mimeType: 'image/jpeg',
          externalId: photo.id ?? null,
          sceneOrder: input.scene.order,
          query,
          retrievalOrigin: 'stock',
          licenseLabel: 'Unsplash License',
          rightsSummary: 'Unsplash still image selected for factual or lifestyle context.',
          attributionRequired: false,
          entityLabel: input.plan.keyEntities[0] ?? null,
        }),
        score: scoreVisualCandidate(
          {
            title,
            snippet: photo.user?.name ?? '',
            query,
            retrievalOrigin: 'stock',
            mimeType: 'image/jpeg',
          },
          input.plan
        ),
        providerFamily: 'unsplash',
        exactEntityMatch: hasExactEntityMatch(title, input.plan.keyEntities),
        matchedTerms: matchTerms(title, input.plan.queries),
      });
      break;
    }

    return {
      provider: 'unsplash',
      data: candidates,
      warnings,
      degraded: candidates.length === 0,
    };
  }
}

export class WikimediaCommonsProvider implements VisualSceneProvider {
  readonly family = 'wikimedia' as const;

  constructor(private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {}

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
    let candidateCount = 0;

    for (const query of input.plan.queries.slice(0, 3)) {
      const searchUrl = new URL(WIKIMEDIA_SEARCH_ENDPOINT);
      searchUrl.searchParams.set('action', 'query');
      searchUrl.searchParams.set('list', 'search');
      searchUrl.searchParams.set('format', 'json');
      searchUrl.searchParams.set('origin', '*');
      searchUrl.searchParams.set('srsearch', query);
      searchUrl.searchParams.set('srlimit', '3');
      searchUrl.searchParams.set('srnamespace', '6');

      const response = await fetch(searchUrl, {
        signal: AbortSignal.timeout(this.timeoutMs),
      }).catch((error) => {
        if (isAbortError(error)) {
          warnings.push(`Wikimedia lookup timed out for "${query}".`);
          return null;
        }

        throw error;
      });

      if (!response?.ok) {
        continue;
      }

      const payload = (await response.json()) as WikimediaSearchResponse;
      const matches = payload.query?.search?.filter((candidate) => candidate.title) ?? [];
      if (matches.length === 0) {
        continue;
      }

      for (const match of matches.slice(0, 3)) {
        if (!match.title) {
          continue;
        }

        const imageInfo = await fetchWikimediaImageInfo(match.title, this.timeoutMs);
        const imageUrl = imageInfo?.url;
        if (!imageUrl) {
          continue;
        }

        const outputPath = join(
          directory,
          `scene-${input.scene.order}-wikimedia-${candidateCount + 1}${inferFileExtension(imageInfo.mime)}`
        );
        const download = await fetch(imageUrl, {
          signal: AbortSignal.timeout(this.timeoutMs),
        }).catch((error) => {
          if (isAbortError(error)) {
            warnings.push(`Wikimedia download timed out for scene ${input.scene.order}.`);
            return null;
          }

          throw error;
        });

        if (!download?.ok) {
          continue;
        }

        await writeArtifactFile(outputPath, Buffer.from(await download.arrayBuffer()));
        const title = match.title.replace(/^File:/i, '');
        candidates.push({
          asset: buildVisualAssetReference({
            kind: 'metadata',
            outputPath,
            label: `Wikimedia asset for scene ${input.scene.order}`,
            provider: 'wikimedia',
            sourceUrl: imageUrl,
            mimeType: imageInfo.mime ?? 'image/jpeg',
            externalId: match.pageid ? String(match.pageid) : null,
            sceneOrder: input.scene.order,
            query,
            retrievalOrigin: input.plan.sceneKind === 'recent_news' ? 'news' : 'entity',
            licenseLabel: imageInfo.licenseLabel,
            rightsSummary: imageInfo.rightsSummary,
            attributionRequired: imageInfo.attributionRequired,
            entityLabel: input.plan.keyEntities[0] ?? title,
          }),
          score: scoreVisualCandidate(
            {
              title,
              snippet: stripHtml(match.snippet ?? ''),
              query,
              retrievalOrigin: input.plan.sceneKind === 'recent_news' ? 'news' : 'entity',
              mimeType: imageInfo.mime ?? 'image/jpeg',
            },
            input.plan
          ),
          providerFamily: 'wikimedia',
          exactEntityMatch: hasExactEntityMatch(title, input.plan.keyEntities),
          matchedTerms: matchTerms(title, input.plan.queries),
        });
        candidateCount += 1;
        if (candidateCount >= 4) {
          break;
        }
      }

      if (candidateCount >= 4) {
        break;
      }
    }

    return {
      provider: 'wikimedia',
      data: candidates,
      warnings,
      degraded: candidates.length === 0,
    };
  }
}

export class GoogleNewsContextVisualProvider implements VisualSceneProvider {
  readonly family = 'news_context' as const;

  async collectCandidates(input: {
    profile: ContentProfile;
    scene: SceneSpec;
    plan: VisualScenePlan;
    jobId: string;
    runtimePaths: RuntimePaths;
  }): Promise<ProviderTaskResult<VisualCandidate[]>> {
    void input;
    return {
      provider: 'news_context',
      data: [],
      warnings: ['News context was used to improve factual visual matching.'],
      degraded: true,
    };
  }
}

export function createVisualProvider(
  env: AppEnv,
  options?: CompositeVisualProviderOptions
): VisualProvider {
  const timeoutMs = env.VISUAL_PROVIDER_TIMEOUT_SECONDS * 1000;
  const contentBriefResolver =
    options?.contentBriefResolver ??
    (env.TAVILY_API_KEY || env.COHERE_API_KEY
      ? async (profile: ContentProfile, topic: string) => {
          const newsProvider = createNewsProvider();
          return await createContentOrchestrator(env, newsProvider).buildBrief(profile, topic);
        }
      : null);

  const composite = new CompositeVisualProvider({
    contentBriefResolver,
    newsContext: options?.newsContext ?? new GoogleNewsContextVisualProvider(),
    // Internet Archive and NASA are always available — no API key needed
    internetArchive: options?.internetArchive ?? new InternetArchiveVisualProvider(timeoutMs),
    nasa: options?.nasa ?? new NasaVisualProvider(),
    wikimedia: options?.wikimedia ?? new WikimediaCommonsProvider(timeoutMs),
    pixabay:
      options?.pixabay ??
      (env.PIXABAY_API_KEY ? new PixabayVisualProvider(env.PIXABAY_API_KEY, timeoutMs) : null),
    pexels:
      options?.pexels ??
      (env.PEXELS_API_KEY ? new PexelsVisualProvider(env.PEXELS_API_KEY, timeoutMs) : null),
  });

  return composite;
}

function buildVisualAssetReference(input: {
  kind: AssetReference['kind'];
  outputPath: string;
  label: string;
  provider: AssetReference['provider'];
  sourceUrl: string | null;
  mimeType: string | null;
  externalId: string | null;
  sceneOrder: number | null;
  query: string | null;
  retrievalOrigin: AssetReference['retrievalOrigin'];
  licenseLabel: string | null;
  rightsSummary: string | null;
  attributionRequired: boolean;
  entityLabel: string | null;
}): AssetReference {
  return {
    kind: input.kind,
    path: input.outputPath,
    label: input.label,
    provider: input.provider,
    sourceUrl: input.sourceUrl,
    mimeType: input.mimeType,
    externalId: input.externalId,
    sceneOrder: input.sceneOrder,
    query: input.query,
    retrievalOrigin: input.retrievalOrigin,
    licenseLabel: input.licenseLabel,
    rightsSummary: input.rightsSummary,
    attributionRequired: input.attributionRequired,
    entityLabel: input.entityLabel,
    matchQuality: null,
    reuseStatus: null,
  };
}

function selectBestPortraitFile(video: PexelsVideo): PexelsVideoFile | null {
  const files = (video.video_files ?? []).filter((file) => {
    if (!file.link || !file.width || !file.height) {
      return false;
    }

    return file.height >= file.width;
  });

  if (files.length === 0) {
    return null;
  }

  return (
    [...files].sort((left, right) => {
      const leftDelta = Math.abs((left.height ?? 0) - 1920);
      const rightDelta = Math.abs((right.height ?? 0) - 1920);
      return leftDelta - rightDelta;
    })[0] ?? null
  );
}

function selectBestPixabayVariant(hit: PixabayHit): PixabayVideoVariant | null {
  const variants = Object.values(hit.videos ?? {}).filter((variant) => Boolean(variant.url));
  if (variants.length === 0) {
    return null;
  }

  return (
    [...variants].sort((left, right) => {
      const leftHeight = left.height ?? 0;
      const rightHeight = right.height ?? 0;
      return Math.abs(leftHeight - 1920) - Math.abs(rightHeight - 1920);
    })[0] ?? null
  );
}

async function fetchWikimediaImageInfo(
  title: string,
  timeoutMs: number
): Promise<{
  url: string | null;
  mime: string | null;
  licenseLabel: string | null;
  rightsSummary: string | null;
  attributionRequired: boolean;
} | null> {
  const infoUrl = new URL(WIKIMEDIA_SEARCH_ENDPOINT);
  infoUrl.searchParams.set('action', 'query');
  infoUrl.searchParams.set('prop', 'imageinfo');
  infoUrl.searchParams.set('iiprop', 'url|mime|extmetadata');
  infoUrl.searchParams.set('iiurlwidth', '1440');
  infoUrl.searchParams.set('titles', title);
  infoUrl.searchParams.set('format', 'json');
  infoUrl.searchParams.set('origin', '*');

  const response = await fetch(infoUrl, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as WikimediaImageInfoResponse;
  const page = Object.values(payload.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.url) {
    return null;
  }

  const licenseLabel = stripHtml(info.extmetadata?.LicenseShortName?.value ?? '') || null;
  const attributionRequired = /attribution/i.test(
    stripHtml(info.extmetadata?.UsageTerms?.value ?? '')
  );

  return {
    url: info.thumburl ?? info.url,
    mime: info.mime ?? null,
    licenseLabel,
    rightsSummary: stripHtml(info.extmetadata?.UsageTerms?.value ?? '') || licenseLabel,
    attributionRequired,
  };
}

function inferFileExtension(mimeType: string | null | undefined): string {
  if (!mimeType) {
    return '.jpg';
  }

  if (mimeType.includes('png')) {
    return '.png';
  }

  if (mimeType.includes('svg')) {
    return '.svg';
  }

  return '.jpg';
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
