import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AssetReference, ReviewPackage, SceneSpec } from '@autom/contracts';
import { ReviewPackageSchema } from '@autom/contracts';

import {
  buildSubtitleCues,
  formatSrtTimestamp,
  getNarrationOvershootAllowanceSeconds,
  type SceneNarrationTiming,
} from '../lib/content-quality.js';
import { nowIso } from '../lib/time.js';
import type { MediaRenderer } from '../lib/types.js';

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const VIDEO_FRAME_RATE = 30;
const DEFAULT_COMMAND_TIMEOUT_MS = 600_000;
const COMMAND_TIMEOUT_PER_SECOND_MS = 7_500;
const VIDEO_ENCODING_PRESET = 'veryfast';
const CAPTION_FILTER =
  "subtitles=captions.srt:force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=0,Alignment=2,MarginV=180'";

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number
) => Promise<{
  stdout: string;
  stderr: string;
}>;

type RenderInput = Parameters<MediaRenderer['render']>[0];

export class FfmpegRenderer implements MediaRenderer {
  constructor(private readonly runCommand: CommandRunner = createProcessRunner()) {}

  async render(input: RenderInput): Promise<ReviewPackage> {
    const jobOutputDirectory = join(input.runtimePaths.outputDirectory, input.job.id);
    const jobTempDirectory = join(input.runtimePaths.tempDirectory, input.job.id);
    const sceneDirectory = join(jobTempDirectory, 'scenes');
    await mkdir(jobOutputDirectory, { recursive: true });
    await mkdir(sceneDirectory, { recursive: true });

    const baseTimeoutMs = input.env.FFMPEG_COMMAND_TIMEOUT_SECONDS * 1000;
    const targetDurationSeconds = input.scriptPackage.totalDurationSeconds;
    const narrationDurationSeconds = input.narrationPath
      ? await probeMediaDuration(
          this.runCommand,
          input.env.FFPROBE_PATH,
          input.narrationPath,
          jobOutputDirectory,
          baseTimeoutMs
        )
      : null;
    const narrationOvershootAllowanceSeconds =
      getNarrationOvershootAllowanceSeconds(targetDurationSeconds);
    if (
      narrationDurationSeconds !== null &&
      narrationDurationSeconds > targetDurationSeconds + narrationOvershootAllowanceSeconds
    ) {
      throw new Error(
        `Narration exceeded the configured duration budget by ${Math.ceil(
          narrationDurationSeconds - targetDurationSeconds
        )} seconds. Regenerate the script.`
      );
    }

    const renderedDurationSeconds =
      narrationDurationSeconds !== null
        ? Math.max(targetDurationSeconds, narrationDurationSeconds)
        : targetDurationSeconds;
    const tailPaddingSeconds = Math.max(0, renderedDurationSeconds - targetDurationSeconds);
    const longestSceneDurationSeconds = Math.max(
      ...input.scriptPackage.scenes.map((scene) => scene.durationSeconds)
    );
    const sceneTimeoutMs = buildDurationAwareTimeoutMs(longestSceneDurationSeconds, baseTimeoutMs);
    const renderTimeoutMs = buildDurationAwareTimeoutMs(renderedDurationSeconds, baseTimeoutMs);

    const subtitlesPath = join(jobOutputDirectory, 'captions.srt');
    const outputVideoPath = join(jobOutputDirectory, 'preview.mp4');
    const thumbnailPath = join(jobOutputDirectory, 'thumbnail.jpg');
    const subtitleTrack = buildSrt(
      input.scriptPackage.scenes,
      renderedDurationSeconds,
      input.sceneNarrationTimeline ?? null
    );
    await writeFile(subtitlesPath, subtitleTrack.srt, 'utf8');

    const videoAssetsByScene = indexSceneVideoAssets(input.assetReferences);
    const renderWarnings = [...input.warnings];
    if (
      narrationDurationSeconds !== null &&
      narrationDurationSeconds + narrationOvershootAllowanceSeconds < targetDurationSeconds
    ) {
      renderWarnings.push(
        `Narration ended ${(
          targetDurationSeconds - narrationDurationSeconds
        ).toFixed(1)}s early; the preview was padded to keep the runtime steady.`
      );
    }
    if (tailPaddingSeconds > 0) {
      renderWarnings.push(
        `Narration ran ${tailPaddingSeconds.toFixed(1)}s longer than the visual budget; the preview was padded to match.`
      );
    }

    for (const scene of input.scriptPackage.scenes) {
      const sceneStartedAt = Date.now();
      await input.onProgress?.(
        `Rendering scene ${scene.order} of ${input.scriptPackage.scenes.length}.`
      );
      const sceneAsset = videoAssetsByScene.get(scene.order) ?? null;
      if (!sceneAsset) {
        renderWarnings.push(`Renderer used a fallback background for scene ${scene.order}.`);
      }

      await this.renderSceneClip({
        env: input.env,
        scene,
        sceneAsset,
        sceneDirectory,
        timeoutMs: sceneTimeoutMs,
      });
      await input.onProgress?.(
        `Render telemetry: scene ${scene.order} completed in ${formatElapsedMs(Date.now() - sceneStartedAt)}.`
      );
    }

    const concatListPath = join(sceneDirectory, 'scene-list.txt');
    const concatVideoPath = join(sceneDirectory, 'assembled.mp4');
    await writeFile(concatListPath, buildConcatFile(input.scriptPackage.scenes), 'utf8');

    const concatStartedAt = Date.now();
    await input.onProgress?.('Concatenating rendered scenes.');
    await this.runRenderCommand(
      'Scene concatenation',
      input.env.FFMPEG_PATH,
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        'scene-list.txt',
        '-c:v',
        'libx264',
        '-preset',
        VIDEO_ENCODING_PRESET,
        '-pix_fmt',
        'yuv420p',
        '-an',
        'assembled.mp4',
      ],
      sceneDirectory,
      renderTimeoutMs
    );
    await input.onProgress?.(
      `Render telemetry: scene concatenation completed in ${formatElapsedMs(
        Date.now() - concatStartedAt
      )}.`
    );

    const encodeStartedAt = Date.now();
    await input.onProgress?.('Encoding final preview video.');
    await this.runRenderCommand(
      'Final preview encoding',
      input.env.FFMPEG_PATH,
      buildPreviewArgs({
        concatVideoPath,
        narrationPath: input.narrationPath,
        renderedDurationSeconds,
        tailPaddingSeconds,
      }),
      jobOutputDirectory,
      renderTimeoutMs
    );
    await input.onProgress?.(
      `Render telemetry: final encode completed in ${formatElapsedMs(Date.now() - encodeStartedAt)}.`
    );

    const thumbnailStartedAt = Date.now();
    await input.onProgress?.('Extracting review thumbnail.');
    await this.runRenderCommand(
      'Thumbnail extraction',
      input.env.FFMPEG_PATH,
      [
        '-y',
        '-ss',
        buildThumbnailSeekTime(renderedDurationSeconds),
        '-i',
        'preview.mp4',
        '-frames:v',
        '1',
        'thumbnail.jpg',
      ],
      jobOutputDirectory,
      renderTimeoutMs
    );
    await input.onProgress?.(
      `Render telemetry: thumbnail extraction completed in ${formatElapsedMs(
        Date.now() - thumbnailStartedAt
      )}.`
    );

    const validationStartedAt = Date.now();
    await input.onProgress?.('Validating rendered preview.');
    await validatePreviewOutput(
      this.runCommand,
      input.env.FFPROBE_PATH,
      outputVideoPath,
      thumbnailPath,
      jobOutputDirectory,
      renderedDurationSeconds,
      renderTimeoutMs
    );
    await input.onProgress?.(
      `Render telemetry: preview validation completed in ${formatElapsedMs(
        Date.now() - validationStartedAt
      )}.`
    );

    return ReviewPackageSchema.parse({
      summary: buildRenderSummary(input),
      warnings: renderWarnings,
      renderBundle: {
        outputVideoPath,
        subtitlesPath,
        thumbnailPath,
        durationSeconds: targetDurationSeconds,
        renderedDurationSeconds,
        narrationDurationSeconds,
        subtitleCueCount: subtitleTrack.cueCount,
        subtitleTimingSource: subtitleTrack.timingSource,
      },
      assetBundle: {
        selectedVisualQueries: input.selectedVisualQueries,
        assetReferences: buildAssetBundleReferences(input.assetReferences, subtitlesPath),
      },
      generatedAt: nowIso(),
    });
  }

  private async renderSceneClip(input: {
    env: RenderInput['env'];
    scene: SceneSpec;
    sceneAsset: AssetReference | null;
    sceneDirectory: string;
    timeoutMs: number;
  }) {
    const outputName = buildSceneOutputName(input.scene.order);
    const args = input.sceneAsset
      ? buildFootageSceneArgs(input.sceneAsset.path, input.scene.durationSeconds, outputName)
      : buildFallbackSceneArgs(input.scene.durationSeconds, outputName);

    await this.runRenderCommand(
      `Scene ${input.scene.order} render`,
      input.env.FFMPEG_PATH,
      args,
      input.sceneDirectory,
      input.timeoutMs
    );
  }

  private async runRenderCommand(
    description: string,
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number
  ) {
    try {
      return await this.runCommand(command, args, cwd, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown FFmpeg failure.';
      throw new Error(`${description} failed: ${message}`);
    }
  }
}

export class StubRenderer implements MediaRenderer {
  async render(input: RenderInput): Promise<ReviewPackage> {
    const jobOutputDirectory = join(input.runtimePaths.outputDirectory, input.job.id);
    await mkdir(jobOutputDirectory, { recursive: true });

    const subtitlesPath = join(jobOutputDirectory, 'captions.srt');
    const outputVideoPath = join(jobOutputDirectory, 'preview.mp4');
    const thumbnailPath = join(jobOutputDirectory, 'thumbnail.jpg');
    const subtitleTrack = buildSrt(
      input.scriptPackage.scenes,
      input.scriptPackage.totalDurationSeconds,
      input.sceneNarrationTimeline ?? null
    );
    await writeFile(subtitlesPath, subtitleTrack.srt, 'utf8');
    await writeFile(outputVideoPath, 'stub mp4 placeholder', 'utf8');
    await writeFile(thumbnailPath, 'stub thumbnail placeholder', 'utf8');

    return ReviewPackageSchema.parse({
      summary: `Generated stub review package for "${input.job.topic}".`,
      warnings: [...input.warnings, 'Stub renderer used. No real FFmpeg composition was run.'],
      renderBundle: {
        outputVideoPath,
        subtitlesPath,
        thumbnailPath,
        durationSeconds: input.scriptPackage.totalDurationSeconds,
        renderedDurationSeconds: input.scriptPackage.totalDurationSeconds,
        narrationDurationSeconds: null,
        subtitleCueCount: subtitleTrack.cueCount,
        subtitleTimingSource: subtitleTrack.timingSource,
      },
      assetBundle: {
        selectedVisualQueries: input.selectedVisualQueries,
        assetReferences: buildAssetBundleReferences(input.assetReferences, subtitlesPath),
      },
      generatedAt: nowIso(),
    });
  }
}

function buildAssetBundleReferences(
  assetReferences: AssetReference[],
  subtitlesPath: string
): AssetReference[] {
  return [
    ...assetReferences,
    {
      kind: 'subtitle',
      path: subtitlesPath,
      label: 'Generated captions',
      provider: 'system',
      sourceUrl: null,
      mimeType: 'application/x-subrip',
      externalId: null,
      sceneOrder: null,
      query: null,
    },
  ];
}

function buildSrt(
  scenes: Array<{ order: number; text: string; durationSeconds: number }>,
  timelineDurationSeconds: number,
  sceneNarrationTimeline: SceneNarrationTiming[] | null
): {
  srt: string;
  cueCount: number;
  timingSource: 'voice_timeline' | 'scene_duration';
} {
  const normalizedTimeline =
    sceneNarrationTimeline && sceneNarrationTimeline.length > 0
      ? scaleSceneTimeline(sceneNarrationTimeline, timelineDurationSeconds)
      : null;
  const cues = buildSubtitleCues(scenes, timelineDurationSeconds, normalizedTimeline);

  return {
    cueCount: cues.length,
    timingSource: normalizedTimeline ? 'voice_timeline' : 'scene_duration',
    srt: cues
      .map((cue, index) => {
        const start = formatSrtTimestamp(cue.startSeconds);
        const end = formatSrtTimestamp(cue.endSeconds);
        return `${index + 1}\n${start} --> ${end}\n${cue.text}\n`;
      })
      .join('\n'),
  };
}

function scaleSceneTimeline(
  timeline: SceneNarrationTiming[],
  targetDurationSeconds: number
): SceneNarrationTiming[] {
  const sorted = [...timeline].sort((left, right) => left.sceneOrder - right.sceneOrder);
  const lastEnd = sorted[sorted.length - 1]?.endSeconds ?? 0;
  if (lastEnd <= 0) {
    return [];
  }

  const scale = targetDurationSeconds / lastEnd;
  return sorted.map((timing, index) => {
    const startSeconds = timing.startSeconds * scale;
    const scaledEnd = timing.endSeconds * scale;
    const endSeconds =
      index === sorted.length - 1 ? targetDurationSeconds : Math.min(targetDurationSeconds, scaledEnd);
    return {
      sceneOrder: timing.sceneOrder,
      startSeconds,
      endSeconds: Math.max(startSeconds + 0.1, endSeconds),
    };
  });
}

function buildSceneOutputName(sceneOrder: number): string {
  return `scene-${sceneOrder}.mp4`;
}

function buildConcatFile(scenes: SceneSpec[]): string {
  return scenes.map((scene) => `file '${buildSceneOutputName(scene.order)}'`).join('\n');
}

function buildFootageSceneArgs(
  sourcePath: string,
  durationSeconds: number,
  outputName: string
): string[] {
  return [
    '-y',
    '-stream_loop',
    '-1',
    '-i',
    sourcePath,
    '-t',
    String(durationSeconds),
    '-an',
    '-vf',
    `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1,fps=${VIDEO_FRAME_RATE}`,
    '-c:v',
    'libx264',
    '-preset',
    VIDEO_ENCODING_PRESET,
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputName,
  ];
}

function buildFallbackSceneArgs(durationSeconds: number, outputName: string): string[] {
  return [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:d=${durationSeconds}`,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    VIDEO_ENCODING_PRESET,
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputName,
  ];
}

function buildPreviewArgs(input: {
  concatVideoPath: string;
  narrationPath: string | null;
  renderedDurationSeconds: number;
  tailPaddingSeconds: number;
}): string[] {
  const videoFilter = `[0:v]${
    input.tailPaddingSeconds > 0
      ? `tpad=stop_mode=clone:stop_duration=${formatFilterDuration(input.tailPaddingSeconds)},`
      : ''
  }${CAPTION_FILTER}[renderv]`;
  const audioFilter = `[1:a]apad=whole_dur=${formatFilterDuration(
    input.renderedDurationSeconds
  )},atrim=duration=${formatFilterDuration(input.renderedDurationSeconds)}[rendera]`;

  return [
    '-y',
    '-i',
    input.concatVideoPath,
    ...(input.narrationPath
      ? ['-i', input.narrationPath]
      : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']),
    '-filter_complex',
    `${videoFilter};${audioFilter}`,
    '-map',
    '[renderv]',
    '-map',
    '[rendera]',
    '-c:v',
    'libx264',
    '-preset',
    VIDEO_ENCODING_PRESET,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    'preview.mp4',
  ];
}

function buildThumbnailSeekTime(totalDurationSeconds: number): string {
  const midpointSeconds = Math.max(1, Math.floor(totalDurationSeconds / 2));
  const minutes = Math.floor(midpointSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (midpointSeconds % 60).toString().padStart(2, '0');
  return `00:${minutes}:${seconds}`;
}

async function validatePreviewOutput(
  runCommand: CommandRunner,
  ffprobePath: string,
  outputVideoPath: string,
  thumbnailPath: string,
  cwd: string,
  expectedDurationSeconds: number,
  timeoutMs: number
) {
  await Promise.all([access(outputVideoPath), access(thumbnailPath)]);
  const probe = await runCommand(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      outputVideoPath,
    ],
    cwd,
    timeoutMs
  );
  const duration = Number.parseFloat(probe.stdout.trim());

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Rendered preview validation failed. FFprobe returned no usable duration.');
  }

  if (duration + 0.75 < expectedDurationSeconds) {
    throw new Error(
      `Rendered preview ended early at ${duration.toFixed(
        2
      )}s. Expected at least ${expectedDurationSeconds.toFixed(2)}s.`
    );
  }
}

function indexSceneVideoAssets(assetReferences: AssetReference[]): Map<number, AssetReference> {
  const sceneVideoAssets = new Map<number, AssetReference>();

  for (const reference of assetReferences) {
    if (reference.kind !== 'video' || reference.sceneOrder === null) {
      continue;
    }

    if (!sceneVideoAssets.has(reference.sceneOrder)) {
      sceneVideoAssets.set(reference.sceneOrder, reference);
    }
  }

  return sceneVideoAssets;
}

function buildRenderSummary(input: RenderInput): string {
  const clipCount = input.assetReferences.filter((reference) => reference.kind === 'video').length;
  const narrationMode = input.narrationPath ? 'mixed narration' : 'silent fallback audio';
  return `Generated review package for "${input.job.topic}" using ${clipCount} sourced clip(s) and ${narrationMode}.`;
}

function formatFilterDuration(totalSeconds: number): string {
  return Number.isInteger(totalSeconds) ? String(totalSeconds) : totalSeconds.toFixed(3);
}

function formatElapsedMs(elapsedMs: number): string {
  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }

  return `${(elapsedMs / 1000).toFixed(2)}s`;
}

export function createProcessRunner(timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): CommandRunner {
  return async (command, args, cwd, overrideTimeoutMs) =>
    runProcess(command, args, cwd, overrideTimeoutMs ?? timeoutMs);
}

function buildDurationAwareTimeoutMs(durationSeconds: number, baseTimeoutMs: number): number {
  return Math.max(baseTimeoutMs, Math.ceil(durationSeconds * COMMAND_TIMEOUT_PER_SECOND_MS));
}

async function probeMediaDuration(
  runCommand: CommandRunner,
  ffprobePath: string,
  mediaPath: string,
  cwd: string,
  timeoutMs: number
): Promise<number> {
  const probe = await runCommand(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      mediaPath,
    ],
    cwd,
    timeoutMs
  );
  const duration = Number.parseFloat(probe.stdout.trim());

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Narration duration could not be measured.');
  }

  return duration;
}

async function runProcess(command: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({
          stdout,
          stderr,
        });
        return;
      }

      reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
    });
  });
}
