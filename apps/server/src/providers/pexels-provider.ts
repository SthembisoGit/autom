import { join } from 'node:path';

import type { AppEnv, RuntimePaths } from '@autom/config';
import type { AssetReference, ContentProfile, SceneSpec, ScriptPackage } from '@autom/contracts';

import { ensureJobArtifactDirectory, writeArtifactFile } from '../lib/artifacts.js';
import type { VisualProvider } from '../lib/types.js';

const PEXELS_SEARCH_ENDPOINT = 'https://api.pexels.com/videos/search';
const PEXELS_REQUEST_TIMEOUT_MS = 15_000;

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
      warnings: ['Using local visual fallback. No Pexels API key is configured.'],
    };
  }
}

export class PexelsVisualProvider implements VisualProvider {
  constructor(private readonly apiKey: string) {}

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
    const directory = await ensureJobArtifactDirectory(input.runtimePaths, input.jobId, 'visuals');

    for (const scene of input.scriptPackage.scenes) {
      if (input.excludeSceneOrders?.includes(scene.order)) {
        selectedVisualQueries.push(scene.visualQuery);
        continue;
      }

      const candidateQueries = buildCandidateQueries(scene, input.profile);
      let selection: {
        query: string;
        video: PexelsVideo;
        file: PexelsVideoFile;
      } | null = null;

      for (const query of candidateQueries) {
        const searchResponse = await fetch(
          `${PEXELS_SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=3&orientation=portrait`,
          {
            headers: {
              Authorization: this.apiKey,
            },
            signal: AbortSignal.timeout(PEXELS_REQUEST_TIMEOUT_MS),
          }
        ).catch((error) => {
          if (isAbortError(error)) {
            warnings.push(`Pexels lookup timed out for "${query}".`);
            return null;
          }

          throw error;
        });

        if (!searchResponse) {
          continue;
        }

        if (!searchResponse.ok) {
          if ([401, 403, 429].includes(searchResponse.status)) {
            throw new Error(`Pexels lookup failed with status ${searchResponse.status}.`);
          }

          warnings.push(`Pexels lookup failed for "${query}".`);
          continue;
        }

        const payload = (await searchResponse.json()) as PexelsSearchResponse;
        const video = payload.videos?.find((candidate) => selectBestPortraitFile(candidate));
        const file = video ? selectBestPortraitFile(video) : null;

        if (!video || !file) {
          continue;
        }

        selection = { query, video, file };
        break;
      }

      if (!selection) {
        warnings.push(`Pexels returned no portrait results for scene ${scene.order}.`);
        continue;
      }

      try {
        const downloadResponse = await fetch(selection.file.link ?? '', {
          signal: AbortSignal.timeout(PEXELS_REQUEST_TIMEOUT_MS),
        }).catch((error) => {
          if (isAbortError(error)) {
            warnings.push(`Pexels download timed out for scene ${scene.order}.`);
            return null;
          }

          throw error;
        });
        if (!downloadResponse) {
          continue;
        }

        if (!downloadResponse.ok) {
          warnings.push(`Pexels download failed for scene ${scene.order}.`);
          continue;
        }

        const outputPath = join(directory, `scene-${scene.order}.mp4`);
        const buffer = Buffer.from(await downloadResponse.arrayBuffer());
        await writeArtifactFile(outputPath, buffer);

        selectedVisualQueries.push(selection.query);
        assetReferences.push(
          buildVideoAssetReference(
            outputPath,
            selection.video,
            selection.file,
            scene.order,
            selection.query
          )
        );
      } catch {
        warnings.push(`Pexels download failed for scene ${scene.order}.`);
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
}

export function createVisualProvider(env: AppEnv): VisualProvider {
  if (env.PEXELS_API_KEY) {
    return new PexelsVisualProvider(env.PEXELS_API_KEY);
  }

  return new LocalVisualProvider();
}

function buildCandidateQueries(scene: SceneSpec, profile: ContentProfile): string[] {
  const sceneKeywords = scene.text
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(' ');

  return Array.from(
    new Set(
      [
        scene.visualQuery,
        `${profile.visualStyle} ${sceneKeywords}`.trim(),
        `${profile.niche} ${sceneKeywords}`.trim(),
      ].filter(Boolean)
    )
  );
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

function buildVideoAssetReference(
  outputPath: string,
  video: PexelsVideo,
  file: PexelsVideoFile,
  sceneOrder: number,
  query: string
): AssetReference {
  return {
    kind: 'video',
    path: outputPath,
    label: `Pexels clip for scene ${sceneOrder}${video.user?.name ? ` by ${video.user.name}` : ''}`,
    provider: 'pexels',
    sourceUrl: video.url ?? file.link ?? null,
    mimeType: file.file_type ?? 'video/mp4',
    externalId: video.id || file.id ? [video.id, file.id].filter(Boolean).join(':') : null,
    sceneOrder,
    query,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
