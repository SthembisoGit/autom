import { join } from 'node:path';

import type { AppEnv, RuntimePaths } from '@autom/config';
import type { AssetReference, ContentProfile, SceneSpec, ScriptPackage } from '@autom/contracts';

import { ensureJobArtifactDirectory, writeArtifactFile } from '../lib/artifacts.js';
import type {
  ContentBrief,
  ProviderTaskResult,
  VisualCandidate,
  VisualProvider,
  VisualProviderFamily,
  VisualSceneKind,
  VisualScenePlan,
  VisualSceneProvider,
} from '../lib/types.js';
import { createContentOrchestrator } from './content-orchestrator.js';
import { createNewsProvider } from './news-provider.js';

const PEXELS_SEARCH_ENDPOINT = 'https://api.pexels.com/videos/search';
const PIXABAY_VIDEO_ENDPOINT = 'https://pixabay.com/api/videos/';
const UNSPLASH_SEARCH_ENDPOINT = 'https://api.unsplash.com/search/photos';
const WIKIMEDIA_SEARCH_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;

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
          mime?: string;
          extmetadata?: Record<string, { value?: string }>;
        }>;
      }
    >;
  };
};

type VisualPlannerResult = {
  plan: VisualScenePlan;
  warnings: string[];
};

type CompositeVisualProviderOptions = {
  pexels?: VisualSceneProvider | null;
  pixabay?: VisualSceneProvider | null;
  wikimedia?: VisualSceneProvider | null;
  newsContext?: VisualSceneProvider | null;
  contentBriefResolver?: ((profile: ContentProfile, topic: string) => Promise<ContentBrief | null>) | null;
};

export class LocalVisualProvider implements VisualProvider {
  async select(input: {
    scriptPackage: ScriptPackage;
    profile: ContentProfile;
    jobId: string;
    runtimePaths: RuntimePaths;
    excludeSceneOrders?: number[];
  }) {
    return {
      selectedVisualQueries: input.scriptPackage.scenes.map((scene) => scene.visualQuery),
      assetReferences: [],
      warnings: ['Using local visual fallback. No visual source providers are configured.'],
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
    const usedCandidateKeys = new Set<string>();
    const contentBrief = this.contentBriefResolver
      ? await this.contentBriefResolver(input.profile, input.scriptPackage.title).catch(() => null)
      : null;

    for (const scene of input.scriptPackage.scenes) {
      if (input.excludeSceneOrders?.includes(scene.order)) {
        selectedVisualQueries.push(scene.visualQuery);
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
        selectedVisualQueries.push(plannerResult.plan.queries[0] ?? scene.visualQuery);
        warnings.push(`No visual candidate found for scene ${scene.order}; renderer will use fallback visuals.`);
        continue;
      }

      const best = chooseBestVisualCandidate(candidates.data, plannerResult.plan, usedCandidateKeys);
      if (!best) {
        selectedVisualQueries.push(plannerResult.plan.queries[0] ?? scene.visualQuery);
        warnings.push(
          plannerResult.plan.exactMatchRequired
            ? `Scene ${scene.order} could not find an exact factual visual match.`
            : `Visual selection could not rank any candidate for scene ${scene.order}.`
        );
        continue;
      }

      selectedVisualQueries.push(best.asset.query ?? plannerResult.plan.queries[0] ?? scene.visualQuery);
      usedCandidateKeys.add(buildCandidateReuseKey(best.asset));
      assetReferences.push(best.asset);
      if (best.reuseBlockedCount > 0) {
        warnings.push(
          `Scene ${scene.order} blocked ${best.reuseBlockedCount} repeated clip candidate${
            best.reuseBlockedCount === 1 ? '' : 's'
          } before choosing ${best.asset.provider}.`
        );
      }
      if (best.forcedReuse) {
        warnings.push(`Scene ${scene.order} reused an existing source clip because no acceptable alternative was found.`);
      }
    }

    return {
      selectedVisualQueries:
        selectedVisualQueries.length > 0
          ? selectedVisualQueries
          : input.scriptPackage.scenes.map((scene) => scene.visualQuery),
      assetReferences,
      warnings,
    };
  }

  private async collectCandidatesForScene(input: {
    scene: SceneSpec;
    plan: VisualScenePlan;
    profile: ContentProfile;
    jobId: string;
    runtimePaths: RuntimePaths;
  }): Promise<ProviderTaskResult<VisualCandidate[]>> {
    const warnings: string[] = [];
    const candidates: VisualCandidate[] = [];

    for (const family of input.plan.preferredProviders) {
      const provider = this.sceneProviders.get(family);
      if (!provider) {
        continue;
      }

      try {
        const result = await provider.collectCandidates({
          profile: input.profile,
          scene: input.scene,
          plan: input.plan,
          jobId: input.jobId,
          runtimePaths: input.runtimePaths,
        });
        warnings.push(...result.warnings);
        candidates.push(...result.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unknown ${family} visual failure.`;
        warnings.push(`${family} visual lookup failed for scene ${input.scene.order}. ${message}`);
      }
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

  constructor(private readonly apiKey: string, private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {}

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
      const response = await fetch(
        `${PEXELS_SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait`,
        {
          headers: { Authorization: this.apiKey },
          signal: AbortSignal.timeout(this.timeoutMs),
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
      const rankedVideos = payload.videos?.filter((candidate) => selectBestPortraitFile(candidate)) ?? [];
      if (rankedVideos.length === 0) {
        continue;
      }

      for (const video of rankedVideos.slice(0, 3)) {
        const file = selectBestPortraitFile(video);
        if (!file?.link) {
          continue;
        }

        const outputPath = join(directory, `scene-${input.scene.order}-pexels-${candidateCount + 1}.mp4`);
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
          score: scoreVisualCandidate({
            title: `${query} ${video.user?.name ?? ''}`,
            snippet: query,
            query,
            retrievalOrigin: 'stock',
            mimeType: 'video/mp4',
          }, input.plan),
          providerFamily: 'pexels',
          exactEntityMatch: hasExactEntityMatch(`${query} ${video.user?.name ?? ''}`, input.plan.keyEntities),
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

  constructor(private readonly apiKey: string, private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {}

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
      const response = await fetch(
        `${PIXABAY_VIDEO_ENDPOINT}?key=${encodeURIComponent(this.apiKey)}&q=${encodeURIComponent(query)}&per_page=5`,
        {
          signal: AbortSignal.timeout(this.timeoutMs),
        }
      ).catch((error) => {
        if (isAbortError(error)) {
          warnings.push(`Pixabay lookup timed out for "${query}".`);
          return null;
        }

        throw error;
      });

      if (!response?.ok) {
        continue;
      }

      const payload = (await response.json()) as PixabayResponse;
      const hits = payload.hits?.filter((candidate) => selectBestPixabayVariant(candidate)?.url) ?? [];
      if (hits.length === 0) {
        continue;
      }

      for (const hit of hits.slice(0, 3)) {
        const variant = selectBestPixabayVariant(hit);
        if (!variant?.url) {
          continue;
        }

        const outputPath = join(directory, `scene-${input.scene.order}-pixabay-${candidateCount + 1}.mp4`);
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

  constructor(private readonly accessKey: string, private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {}

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
    wikimedia: options?.wikimedia ?? new WikimediaCommonsProvider(),
    pixabay:
      options?.pixabay ??
      (env.PIXABAY_API_KEY ? new PixabayVisualProvider(env.PIXABAY_API_KEY) : null),
    pexels:
      options?.pexels ??
      (env.PEXELS_API_KEY ? new PexelsVisualProvider(env.PEXELS_API_KEY) : null),
  });

  return composite;
}

export function buildVisualScenePlan(
  scene: SceneSpec,
  profile: ContentProfile,
  contentBrief: ContentBrief | null
): VisualPlannerResult {
  const sceneKind = classifySceneKind(scene, contentBrief);
  const querySet = buildPlannerQueries(scene, profile, contentBrief, sceneKind);
  const keyEntities = extractVisualEntities(scene, contentBrief);
  const exactMatchRequired = sceneKind === 'recent_news' || sceneKind === 'named_person_or_event' || sceneKind === 'historical_topic';
  const allowStockFallback = sceneKind === 'generic_business_or_lifestyle' || sceneKind === 'product_or_tool_demo' || sceneKind === 'place_or_institution';

  return {
    plan: {
      sceneOrder: scene.order,
      sceneKind,
      queries: querySet,
      keyEntities,
      preferredProviders: resolveProviderFamilies(sceneKind),
      exactMatchRequired,
      allowStockFallback,
    },
    warnings:
      exactMatchRequired && keyEntities.length === 0
        ? [`Scene ${scene.order} looks factual but no strong entity hints were resolved.`]
        : [],
  };
}

function classifySceneKind(scene: SceneSpec, contentBrief: ContentBrief | null): VisualSceneKind {
  if (contentBrief?.contentType) {
    return contentBrief.contentType;
  }

  const text = `${scene.text} ${scene.visualQuery}`.toLowerCase();
  if (/\b(news|reported|announced|today|latest|update|headline)\b/.test(text)) {
    return 'recent_news';
  }
  if (/\b(history|historical|legacy|mandela|president|war|empire)\b/.test(text)) {
    return 'historical_topic';
  }
  if (/\b(tool|software|dashboard|app|platform|workflow|seo|crm|automation)\b/.test(text)) {
    return 'product_or_tool_demo';
  }
  if (extractCapitalizedEntities(`${scene.text} ${scene.visualQuery}`).length > 0) {
    return 'named_person_or_event';
  }

  return 'generic_business_or_lifestyle';
}

function buildPlannerQueries(
  scene: SceneSpec,
  profile: ContentProfile,
  contentBrief: ContentBrief | null,
  sceneKind: VisualSceneKind
): string[] {
  const evidenceQueries =
    contentBrief?.evidence.items
      .slice(0, 3)
      .map((item) => item.title.trim())
      .filter((value) => value.length > 0) ?? [];
  const desiredVisualQueries = contentBrief?.desiredVisuals.slice(0, 2) ?? [];
  const factualScene = ['recent_news', 'named_person_or_event', 'historical_topic', 'place_or_institution'].includes(
    sceneKind
  );

  return Array.from(
    new Set(
      [
        ...extractEntityFocusedQueries(scene, contentBrief),
        ...extractSceneSpecificQueries(scene),
        ...evidenceQueries,
        ...desiredVisualQueries,
        scene.visualQuery,
        normalizePlannerQuery(scene.text),
        ...(factualScene
          ? []
          : [
              `${profile.visualStyle} ${scene.visualQuery}`.trim(),
              `${profile.niche} ${scene.text}`.replace(/[^\w\s]/g, ' ').trim(),
            ]),
      ].filter((value) => value && value.trim().length > 0)
    )
  ).slice(0, 5);
}

function extractSceneSpecificQueries(scene: SceneSpec): string[] {
  const tokens = tokenize(scene.text).filter((token) => !VISUAL_QUERY_STOPWORDS.has(token));
  const compactActionQuery = tokens.slice(0, 6).join(' ').trim();
  const verbAnchoredQuery = tokens.slice(0, 3).concat(tokens.slice(-2)).join(' ').trim();

  return [compactActionQuery, verbAnchoredQuery]
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value.length >= 8);
}

function extractEntityFocusedQueries(scene: SceneSpec, contentBrief: ContentBrief | null): string[] {
  const entities = extractVisualEntities(scene, contentBrief);
  if (entities.length === 0) {
    return [];
  }

  return [
    entities.join(' '),
    `${entities[0]} ${scene.visualQuery}`,
    `${entities[0]} ${scene.text}`.replace(/[^\w\s]/g, ' '),
  ].map((value) => value.trim());
}

function extractVisualEntities(scene: SceneSpec, contentBrief: ContentBrief | null): string[] {
  const entities = new Set<string>(contentBrief?.keyEntities ?? []);
  for (const entity of extractCapitalizedEntities(`${scene.text} ${scene.visualQuery}`)) {
    entities.add(entity);
  }

  return Array.from(entities).slice(0, 4);
}

function resolveProviderFamilies(sceneKind: VisualSceneKind): VisualProviderFamily[] {
  switch (sceneKind) {
    case 'recent_news':
      return ['news_context', 'wikimedia', 'pixabay', 'pexels'];
    case 'named_person_or_event':
    case 'historical_topic':
      return ['wikimedia', 'pixabay', 'pexels'];
    case 'generic_business_or_lifestyle':
      return ['pexels', 'pixabay', 'wikimedia'];
    case 'product_or_tool_demo':
      return ['pixabay', 'pexels', 'wikimedia'];
    case 'place_or_institution':
      return ['wikimedia', 'pixabay', 'pexels'];
    default:
      return ['pexels', 'pixabay', 'wikimedia'];
  }
}

function chooseBestVisualCandidate(
  candidates: VisualCandidate[],
  plan: VisualScenePlan,
  usedCandidateKeys: Set<string>
): (VisualCandidate & { forcedReuse: boolean; reuseBlockedCount: number }) | null {
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const uniqueCandidates = sorted.filter(
    (candidate) => !usedCandidateKeys.has(buildCandidateReuseKey(candidate.asset))
  );
  const duplicateCount = sorted.length - uniqueCandidates.length;
  const candidatePool = uniqueCandidates.length > 0 ? uniqueCandidates : sorted;
  const forcedReuse = uniqueCandidates.length === 0 && sorted.length > 0;

  const exact = candidatePool.find((candidate) => candidate.exactEntityMatch);
  if (exact) {
    return {
      ...exact,
      asset: {
        ...exact.asset,
        matchQuality: 'exact',
        reuseStatus: forcedReuse ? 'forced_reuse' : 'unique',
      },
      forcedReuse,
      reuseBlockedCount: duplicateCount,
    };
  }

  if (plan.exactMatchRequired) {
    const relevantFallback = candidatePool.find(
      (candidate) =>
        candidate.score >= 14 &&
        (candidate.providerFamily === 'wikimedia' ||
          candidate.providerFamily === 'news_context' ||
          candidate.matchedTerms.length >= 2)
    );
    return relevantFallback
      ? {
          ...relevantFallback,
          asset: {
            ...relevantFallback.asset,
            matchQuality: 'relevant',
            reuseStatus: forcedReuse ? 'forced_reuse' : 'unique',
          },
          forcedReuse,
          reuseBlockedCount: duplicateCount,
        }
      : null;
  }

  const fallback = candidatePool[0] ?? null;
  return fallback
    ? {
        ...fallback,
        asset: {
          ...fallback.asset,
          matchQuality: fallback.score >= 14 ? 'relevant' : 'fallback',
          reuseStatus: forcedReuse ? 'forced_reuse' : 'unique',
        },
        forcedReuse,
        reuseBlockedCount: duplicateCount,
      }
    : null;
}

function scoreVisualCandidate(
  input: {
    title: string;
    snippet: string;
    query: string;
    retrievalOrigin: AssetReference['retrievalOrigin'];
    mimeType: string | null;
  },
  plan: VisualScenePlan
): number {
  const haystack = `${input.title} ${input.snippet} ${input.query}`.toLowerCase();
  let score = 0;

  for (const query of plan.queries) {
    for (const token of tokenize(query)) {
      if (haystack.includes(token)) {
        score += 3;
      }
    }
  }

  for (const entity of plan.keyEntities) {
    if (haystack.includes(entity.toLowerCase())) {
      score += 6;
    }
  }

  if (input.retrievalOrigin === 'entity' || input.retrievalOrigin === 'news') {
    score += 4;
  }

  if (input.retrievalOrigin === 'stock') {
    score += plan.allowStockFallback ? 1 : -2;
  }

  if (input.mimeType?.startsWith('video/')) {
    score += 2;
  }

  if (plan.sceneKind === 'recent_news' && input.retrievalOrigin === 'news') {
    score += 3;
  }

  if (
    ['recent_news', 'named_person_or_event', 'historical_topic'].includes(plan.sceneKind) &&
    input.retrievalOrigin === 'stock'
  ) {
    score -= 2;
  }

  return score;
}

function normalizePlannerQuery(value: string): string {
  return value.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
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

function buildCandidateReuseKey(asset: AssetReference): string {
  return [asset.provider, asset.externalId ?? '', asset.sourceUrl ?? ''].join('|');
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
      return Math.abs(rightHeight - 1920) - Math.abs(leftHeight - 1920);
    })[0] ?? null
  );
}

async function fetchWikimediaImageInfo(title: string, timeoutMs: number): Promise<{
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
  const attributionRequired = /attribution/i.test(stripHtml(info.extmetadata?.UsageTerms?.value ?? ''));

  return {
    url: info.url,
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

function extractCapitalizedEntities(value: string): string[] {
  return Array.from(
    new Set(
      value.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)?.map((match) => match.trim()) ?? []
    )
  );
}

function hasExactEntityMatch(haystack: string, entities: string[]): boolean {
  const lowerHaystack = haystack.toLowerCase();
  return entities.some((entity) => lowerHaystack.includes(entity.toLowerCase()));
}

function matchTerms(haystack: string, queries: string[]): string[] {
  const lowerHaystack = haystack.toLowerCase();
  return Array.from(
    new Set(
      queries.flatMap((query) =>
        tokenize(query).filter((token) => lowerHaystack.includes(token))
      )
    )
  );
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

const VISUAL_QUERY_STOPWORDS = new Set([
  'about',
  'after',
  'before',
  'because',
  'could',
  'every',
  'from',
  'have',
  'into',
  'just',
  'like',
  'most',
  'only',
  'over',
  'some',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
]);

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
