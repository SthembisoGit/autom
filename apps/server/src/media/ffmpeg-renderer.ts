import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';

import type {
  AssetReference,
  ContentMode,
  RenderSceneVisualOutcome,
  ReviewPackage,
  SceneSpec,
} from '@autom/contracts';
import { ReviewPackageSchema } from '@autom/contracts';

import { findBackgroundAudioSource } from '../domains/production/audio-bed-service.js';
import { buildAssetBundleReferences, buildSrt } from '../domains/production/subtitle-service.js';
import {
  type SceneNarrationTiming,
  getNarrationOvershootAllowanceSeconds,
} from '../lib/content-quality.js';
import { nowIso } from '../lib/time.js';
import type { DialogueTurnTiming, MediaRenderer, TranscriptWordTiming } from '../lib/types.js';
import {
  type DialogueCharacterRasterPack,
  ensureDialogueCharacterRasters,
} from './dialogue-assets.js';

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const VIDEO_FRAME_RATE = 30;
const DEFAULT_COMMAND_TIMEOUT_MS = 600_000;
const COMMAND_TIMEOUT_PER_SECOND_MS = 7_500;
const VIDEO_ENCODING_PRESET = 'medium';
const { join } = await import('node:path');

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

type ResolvedSceneTiming = {
  sceneOrder: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

type SceneVisualDecision = {
  mode: 'dialogue' | 'footage' | 'image' | 'fallback';
  sceneAsset: AssetReference | null;
  dialogueTurns: DialogueTurnTiming[];
  transcriptWords: TranscriptWordTiming[];
  providerUsed: RenderSceneVisualOutcome['providerUsed'];
  usedFallback: boolean;
};

type DialogueMouthState = 'rest' | 'mid' | 'open' | 'wide' | 'fv';

type DialogueMouthCue = {
  speakerId: string;
  state: DialogueMouthState;
  startSeconds: number;
  endSeconds: number;
};

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

    const sceneTrackDurationSeconds = narrationDurationSeconds ?? targetDurationSeconds;
    const normalizedSceneTimeline =
      input.sceneNarrationTimeline && input.sceneNarrationTimeline.length > 0
        ? scaleSceneTimeline(input.sceneNarrationTimeline, sceneTrackDurationSeconds)
        : null;
    const resolvedSceneTimings = resolveSceneTimings(
      input.scriptPackage.scenes,
      normalizedSceneTimeline,
      sceneTrackDurationSeconds
    );
    const sceneTimingByOrder = new Map(
      resolvedSceneTimings.map((timing) => [timing.sceneOrder, timing] as const)
    );
    const renderedDurationSeconds =
      narrationDurationSeconds !== null ? narrationDurationSeconds : targetDurationSeconds;
    const videoPaddingSeconds = Math.max(
      0,
      renderedDurationSeconds -
        resolvedSceneTimings.reduce((sum, timing) => sum + timing.durationSeconds, 0)
    );
    const longestSceneDurationSeconds = Math.max(
      ...resolvedSceneTimings.map((timing) => timing.durationSeconds)
    );
    const sceneTimeoutMs = buildDurationAwareTimeoutMs(longestSceneDurationSeconds, baseTimeoutMs);
    const renderTimeoutMs = buildDurationAwareTimeoutMs(renderedDurationSeconds, baseTimeoutMs);

    const subtitlesPath = join(jobOutputDirectory, 'captions.srt');
    const outputVideoPath = join(jobOutputDirectory, 'preview.mp4');
    const thumbnailPath = join(jobOutputDirectory, 'thumbnail.jpg');
    const contentMode = input.contentMode ?? input.profile.contentMode ?? 'narration';
    const isDialogueRender = contentMode === 'dialogue' && Boolean(input.scriptPackage.dialogue);
    const characterRasters =
      isDialogueRender && input.profile.dialogueCharacterPresetId
        ? await ensureDialogueCharacterRasters(
            input.profile.dialogueCharacterPresetId,
            jobTempDirectory
          )
        : null;
    const subtitleTrack = buildSrt(
      input.scriptPackage.scenes,
      renderedDurationSeconds,
      normalizedSceneTimeline,
      input.transcriptWords ?? null
    );
    await writeFile(subtitlesPath, subtitleTrack.srt, 'utf8');

    const sceneAssetsByScene = indexSceneVisualAssets(input.assetReferences);
    const captionFilter = buildCaptionFilter(
      contentMode,
      characterRasters?.subtitleSafeZone ?? null
    );
    const backgroundAudioPath = await findBackgroundAudioSource(
      this.runCommand,
      input.env.FFPROBE_PATH,
      input.assetReferences,
      jobOutputDirectory,
      baseTimeoutMs
    );
    await input.onProgress?.(`Subtitle timing source used: ${subtitleTrack.timingSource}.`);
    if (characterRasters) {
      await input.onProgress?.(`Dialogue character preset used: ${characterRasters.presetId}.`);
    }
    if (backgroundAudioPath) {
      await input.onProgress?.('Background audio bed sourced from selected footage.');
    }
    const renderWarnings = [...input.warnings];
    const sceneVisualOutcomes: RenderSceneVisualOutcome[] = [];
    if (narrationDurationSeconds !== null && narrationDurationSeconds > targetDurationSeconds) {
      renderWarnings.push(
        `Narration ran ${(narrationDurationSeconds - targetDurationSeconds).toFixed(
          1
        )}s longer than the visual budget; the preview was padded to match.`
      );
    }

    for (const scene of input.scriptPackage.scenes) {
      const sceneStartedAt = Date.now();
      await input.onProgress?.(
        `Rendering scene ${scene.order} of ${input.scriptPackage.scenes.length}.`
      );
      const sceneAsset = sceneAssetsByScene.get(scene.order) ?? null;
      const sceneTiming = sceneTimingByOrder.get(scene.order) ?? {
        sceneOrder: scene.order,
        startSeconds: 0,
        endSeconds: scene.durationSeconds,
        durationSeconds: scene.durationSeconds,
      };
      const sceneDialogueTurns = (input.dialogueTurnTimeline ?? []).filter(
        (turn) => turn.sceneOrder === scene.order
      );
      const sceneTranscriptWords = normalizeTranscriptWordsForScene(
        input.transcriptWords ?? [],
        sceneTiming.startSeconds,
        sceneTiming.endSeconds
      );
      const sceneVisualDecision = resolveSceneVisualDecision({
        sceneAsset,
        isDialogueRender,
        dialogueTurns: normalizeDialogueTurnsForScene(
          sceneDialogueTurns,
          sceneTiming.startSeconds,
          sceneTiming.durationSeconds
        ),
        transcriptWords: sceneTranscriptWords,
      });
      const usedFallback = sceneVisualDecision.usedFallback;

      if (usedFallback) {
        const fallbackMessage = `Renderer used a fallback visual for scene ${scene.order}.`;
        renderWarnings.push(fallbackMessage);
        await input.onProgress?.(fallbackMessage);
      }

      await this.renderSceneClip({
        env: input.env,
        sceneOrder: scene.order,
        durationSeconds: sceneTiming.durationSeconds,
        visualDecision: sceneVisualDecision,
        sceneDirectory,
        timeoutMs: sceneTimeoutMs,
        characterRasters,
      });
      sceneVisualOutcomes.push({
        sceneOrder: scene.order,
        requestedVisualMode: resolveSceneVisualMode(scene),
        providerUsed: sceneVisualDecision.providerUsed,
        usedFallback,
      });
      await input.onProgress?.(
        `Render telemetry: scene ${scene.order} completed in ${formatElapsedMs(Date.now() - sceneStartedAt)}.`
      );
    }

    const concatListPath = join(sceneDirectory, 'scene-list.txt');
    const concatVideoPath = join(sceneDirectory, 'assembled.mp4');
    await writeFile(concatListPath, buildConcatFile(input.scriptPackage.scenes), 'utf8');

    const concatStartedAt = Date.now();
    const sceneCount = input.scriptPackage.scenes.length;
    await input.onProgress?.('Concatenating rendered scenes.');

    // Simple concat — reliable and fast for any scene count.
    // xfade filter_complex was reverted: opening all scenes simultaneously
    // in one ffmpeg command causes memory exhaustion and hangs on videos
    // longer than ~3 minutes. Scene-level fade-in (applied per scene during
    // individual render) already handles the loop seam visually.
    await this.runRenderCommand(
      'Scene concatenation',
      input.env.FFMPEG_PATH,
      [
        '-y', '-f', 'concat', '-safe', '0', '-i', 'scene-list.txt',
        '-c:v', 'libx264', '-preset', VIDEO_ENCODING_PRESET,
        '-pix_fmt', 'yuv420p', '-an', 'assembled.mp4',
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
        backgroundAudioPath,
        renderedDurationSeconds,
        videoPaddingSeconds,
        captionFilter,
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
        contentMode,
        dialogueSpeakerNames:
          input.scriptPackage.dialogue?.speakers.map((speaker) => speaker.name) ?? [],
        dialogueTurnCount: input.scriptPackage.dialogue?.turns.length ?? 0,
        sceneVisualOutcomes,
        backgroundAudioPresent: Boolean(backgroundAudioPath),
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
    sceneOrder: number;
    durationSeconds: number;
    visualDecision: SceneVisualDecision;
    sceneDirectory: string;
    timeoutMs: number;
    characterRasters: DialogueCharacterRasterPack | null;
  }) {
    const outputName = buildSceneOutputName(input.sceneOrder);
    const args =
      input.visualDecision.mode === 'dialogue' &&
      input.characterRasters &&
      input.visualDecision.dialogueTurns.length > 0
        ? buildDialogueSceneArgs(
            input.durationSeconds,
            outputName,
            input.visualDecision.dialogueTurns,
            input.visualDecision.transcriptWords,
            input.characterRasters
          )
        : input.visualDecision.mode === 'footage' && input.visualDecision.sceneAsset
          ? buildFootageSceneArgs(
              input.visualDecision.sceneAsset.path,
              input.durationSeconds,
              outputName
            )
          : input.visualDecision.mode === 'image' && input.visualDecision.sceneAsset
            ? buildImageSceneArgs(
                input.visualDecision.sceneAsset.path,
                input.durationSeconds,
                outputName
              )
            : buildFallbackSceneArgs(input.durationSeconds, outputName);

    await this.runRenderCommand(
      `Scene ${input.sceneOrder} render`,
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
      input.sceneNarrationTimeline ?? null,
      input.transcriptWords ?? null
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
        contentMode: 'narration',
        dialogueTurnCount: input.scriptPackage.dialogue?.turns.length ?? 0,
        sceneVisualOutcomes: [],
        backgroundAudioPresent: false,
      },
      assetBundle: {
        selectedVisualQueries: input.selectedVisualQueries,
        assetReferences: buildAssetBundleReferences(input.assetReferences, subtitlesPath),
      },
      generatedAt: nowIso(),
    });
  }
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
      index === sorted.length - 1
        ? targetDurationSeconds
        : Math.min(targetDurationSeconds, scaledEnd);
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

function resolveSceneTimings(
  scenes: SceneSpec[],
  normalizedTimeline: SceneNarrationTiming[] | null,
  timelineDurationSeconds: number
): ResolvedSceneTiming[] {
  if (normalizedTimeline && normalizedTimeline.length > 0) {
    return normalizedTimeline.map((timing) => ({
      sceneOrder: timing.sceneOrder,
      startSeconds: timing.startSeconds,
      endSeconds: timing.endSeconds,
      durationSeconds: Math.max(0.25, timing.endSeconds - timing.startSeconds),
    }));
  }

  const sourceDurationSeconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const scale = sourceDurationSeconds > 0 ? timelineDurationSeconds / sourceDurationSeconds : 1;
  let elapsedSeconds = 0;

  return scenes.map((scene, index) => {
    const durationSeconds =
      index === scenes.length - 1
        ? Math.max(0.25, timelineDurationSeconds - elapsedSeconds)
        : Math.max(0.25, scene.durationSeconds * scale);
    const startSeconds = elapsedSeconds;
    const endSeconds = startSeconds + durationSeconds;
    elapsedSeconds = endSeconds;
    return {
      sceneOrder: scene.order,
      startSeconds,
      endSeconds,
      durationSeconds,
    };
  });
}

function resolveSceneVisualMode(scene: Pick<SceneSpec, 'visualMode'>): SceneSpec['visualMode'] {
  return scene.visualMode ?? 'auto';
}

function resolveSceneVisualDecision(input: {
  sceneAsset: AssetReference | null;
  isDialogueRender: boolean;
  dialogueTurns: DialogueTurnTiming[];
  transcriptWords: TranscriptWordTiming[];
}): SceneVisualDecision {
  if (input.isDialogueRender && input.dialogueTurns.length > 0 && !input.sceneAsset) {
    return {
      mode: 'dialogue',
      providerUsed: 'dialogue',
      usedFallback: false,
      sceneAsset: null,
      dialogueTurns: input.dialogueTurns,
      transcriptWords: input.transcriptWords,
    };
  }

  if (input.sceneAsset) {
    return {
      mode: isRenderableImageAsset(input.sceneAsset) ? 'image' : 'footage',
      providerUsed: normalizeVisualProvider(input.sceneAsset.provider),
      usedFallback: false,
      sceneAsset: input.sceneAsset,
      dialogueTurns: input.dialogueTurns,
      transcriptWords: input.transcriptWords,
    };
  }

  if (input.isDialogueRender && input.dialogueTurns.length > 0) {
    return {
      mode: 'dialogue',
      providerUsed: 'dialogue',
      usedFallback: true,
      sceneAsset: null,
      dialogueTurns: input.dialogueTurns,
      transcriptWords: input.transcriptWords,
    };
  }

  return {
    mode: 'fallback',
    providerUsed: 'system',
    usedFallback: true,
    sceneAsset: null,
    dialogueTurns: [],
    transcriptWords: [],
  };
}

function normalizeVisualProvider(
  provider: AssetReference['provider']
): RenderSceneVisualOutcome['providerUsed'] {
  if (
    provider === 'local' ||
    provider === 'deepgram' ||
    provider === 'groq' ||
    provider === 'pexels' ||
    provider === 'pixabay' ||
    provider === 'unsplash' ||
    provider === 'wikimedia' ||
    provider === 'veo' ||
    provider === 'system'
  ) {
    return provider;
  }

  return 'system';
}

function buildFootageSceneArgs(
  sourcePath: string,
  durationSeconds: number,
  outputName: string
): string[] {
  // stream_loop -1 loops the clip to fill the scene duration.
  // fade=in:0:15 adds a 0.5s (15 frame) fade-in that masks the loop seam when
  // the clip is shorter than the scene — the loop restart is hidden under the fade.
  // tpad=stop_mode=clone extends the clip by cloning the last frame if needed,
  // preventing ffmpeg from stalling at end of stream before the trim completes.
  const fadeFrames = Math.min(15, Math.floor(durationSeconds * VIDEO_FRAME_RATE * 0.08));
  const scaleAndCrop = `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT}`;
  const loopFadeFilter = `${scaleAndCrop},setsar=1,fps=${VIDEO_FRAME_RATE},fade=in:0:${fadeFrames}:alpha=0`;

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
    loopFadeFilter,
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

/**
 * Build an image scene with a varied Ken Burns motion effect.
 *
 * Rather than always zooming in from center (which looks identical across scenes),
 * we vary the motion based on the output filename to deterministically pick one of
 * four patterns: zoom-in from top-left, zoom-in from bottom-right, slow pan left,
 * slow pan right. The result looks directed rather than templated.
 */
function buildImageSceneArgs(
  sourcePath: string,
  durationSeconds: number,
  outputName: string
): string[] {
  const totalFrames = Math.max(1, Math.ceil(durationSeconds * VIDEO_FRAME_RATE));
  // Deterministic variation based on scene number extracted from outputName
  const sceneNum = parseInt(outputName.match(/\d+/)?.[0] ?? '1', 10);
  const motionVariant = sceneNum % 4;

  // Each variant has a distinct motion feel:
  // 0 — slow zoom in from top-left corner (news/serious content feel)
  // 1 — slow zoom in from bottom-right corner (mirror of 0)
  // 2 — slow horizontal pan left-to-right (documentary sweep)
  // 3 — slow zoom in from center with slight pan (classic Ken Burns)
  const zoompanExpr = [
    // Variant 0: zoom in, anchor top-left
    `zoompan=z='min(zoom+0.0006,1.12)':x='iw/2-(iw/zoom/2)-iw*0.04':y='ih/2-(ih/zoom/2)-ih*0.04':d=${totalFrames}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${VIDEO_FRAME_RATE}`,
    // Variant 1: zoom in, anchor bottom-right
    `zoompan=z='min(zoom+0.0006,1.12)':x='iw/2-(iw/zoom/2)+iw*0.04':y='ih/2-(ih/zoom/2)+ih*0.04':d=${totalFrames}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${VIDEO_FRAME_RATE}`,
    // Variant 2: slow pan left-to-right, slight zoom
    `zoompan=z='min(zoom+0.0003,1.06)':x='iw*0.04*(on/${totalFrames})':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${VIDEO_FRAME_RATE}`,
    // Variant 3: classic center zoom
    `zoompan=z='min(zoom+0.0007,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${VIDEO_FRAME_RATE}`,
  ][motionVariant];

  return [
    '-y',
    '-loop',
    '1',
    '-i',
    sourcePath,
    '-t',
    String(durationSeconds),
    '-an',
    '-vf',
    `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},${zoompanExpr},setsar=1`,
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

function buildDialogueSceneArgs(
  durationSeconds: number,
  outputName: string,
  dialogueTurns: DialogueTurnTiming[],
  transcriptWords: TranscriptWordTiming[],
  characterRasters: DialogueCharacterRasterPack
): string[] {
  const speakerAWindows = dialogueTurns.filter((turn) => turn.speakerId === 'host_a');
  const speakerBWindows = dialogueTurns.filter((turn) => turn.speakerId !== 'host_a');
  const highlightAExpression = buildHighlightExpression(speakerAWindows);
  const highlightBExpression = buildHighlightExpression(speakerBWindows);
  const focusAShots = dialogueTurns.filter(
    (turn) => turn.shotType === 'speaker_focus' && turn.speakerId === 'host_a'
  );
  const focusBShots = dialogueTurns.filter(
    (turn) => turn.shotType === 'speaker_focus' && turn.speakerId !== 'host_a'
  );
  const focusAExpression = buildHighlightExpression(focusAShots);
  const focusBExpression = buildHighlightExpression(focusBShots);
  const speakerAMouthCues = buildDialogueMouthCues('host_a', speakerAWindows, transcriptWords);
  const speakerBMouthCues = buildDialogueMouthCues('host_b', speakerBWindows, transcriptWords);
  const hostAScaledWidth = buildScaledHostWidth(
    characterRasters.canvas.width,
    characterRasters.hostA.scale
  );
  const hostBScaledWidth = buildScaledHostWidth(
    characterRasters.canvas.width,
    characterRasters.hostB.scale
  );

  return [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x0f172a:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:d=${formatFilterDuration(durationSeconds)}`,
    '-loop',
    '1',
    '-i',
    characterRasters.hostA.base,
    '-loop',
    '1',
    '-i',
    characterRasters.hostA.mouth.mid,
    '-loop',
    '1',
    '-i',
    characterRasters.hostA.mouth.open,
    '-loop',
    '1',
    '-i',
    characterRasters.hostA.mouth.wide,
    '-loop',
    '1',
    '-i',
    characterRasters.hostA.mouth.fv,
    '-loop',
    '1',
    '-i',
    characterRasters.hostA.blink,
    '-loop',
    '1',
    '-i',
    characterRasters.hostB.base,
    '-loop',
    '1',
    '-i',
    characterRasters.hostB.mouth.mid,
    '-loop',
    '1',
    '-i',
    characterRasters.hostB.mouth.open,
    '-loop',
    '1',
    '-i',
    characterRasters.hostB.mouth.wide,
    '-loop',
    '1',
    '-i',
    characterRasters.hostB.mouth.fv,
    '-loop',
    '1',
    '-i',
    characterRasters.hostB.blink,
    '-filter_complex',
    buildDialogueSceneFilter({
      durationSeconds,
      speakerAWindows,
      speakerBWindows,
      speakerAMouthCues,
      speakerBMouthCues,
      highlightAExpression,
      highlightBExpression,
      focusAExpression,
      focusBExpression,
      characterRasters,
      hostAScaledWidth,
      hostBScaledWidth,
    }),
    '-map',
    '[outv]',
    '-t',
    formatFilterDuration(durationSeconds),
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

function buildFallbackSceneArgs(durationSeconds: number, outputName: string): string[] {
  return [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x0f172a:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:d=${durationSeconds}`,
    '-vf',
    `drawbox=x=44:y=620:w=430:h=820:color=0x2dd4bf@0.10:t=fill,drawbox=x=606:y=656:w=430:h=792:color=0xf59e0b@0.10:t=fill,drawbox=x=0:y=1548:w=${VIDEO_WIDTH}:h=372:color=0x020617@0.62:t=fill`,
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

function buildDialogueSceneFilter(input: {
  durationSeconds: number;
  speakerAWindows: DialogueTurnTiming[];
  speakerBWindows: DialogueTurnTiming[];
  speakerAMouthCues: DialogueMouthCue[];
  speakerBMouthCues: DialogueMouthCue[];
  highlightAExpression: string | null;
  highlightBExpression: string | null;
  focusAExpression: string | null;
  focusBExpression: string | null;
  characterRasters: DialogueCharacterRasterPack;
  hostAScaledWidth: number;
  hostBScaledWidth: number;
}): string {
  const highlightA = input.highlightAExpression
    ? `drawbox=x=32:y=622:w=430:h=846:color=0x2dd4bf@0.12:t=fill:enable='${input.highlightAExpression}',`
    : '';
  const highlightB = input.highlightBExpression
    ? `drawbox=x=618:y=646:w=430:h=820:color=0xf59e0b@0.12:t=fill:enable='${input.highlightBExpression}',`
    : '';
  const hostAPosition = input.characterRasters.hostA.layout;
  const hostBPosition = input.characterRasters.hostB.layout;
  const hostABob = `${hostAPosition.y}+12*sin(2*PI*(t+0.25)/5.4)`;
  const hostBBob = `${hostBPosition.y}+12*sin(2*PI*(t+0.65)/5.4)`;
  const speakerAMidExpression = buildCueExpression(input.speakerAMouthCues, 'mid');
  const speakerAOpenExpression = buildCueExpression(input.speakerAMouthCues, 'open');
  const speakerAWideExpression = buildCueExpression(input.speakerAMouthCues, 'wide');
  const speakerAFvExpression = buildCueExpression(input.speakerAMouthCues, 'fv');
  const speakerBMidExpression = buildCueExpression(input.speakerBMouthCues, 'mid');
  const speakerBOpenExpression = buildCueExpression(input.speakerBMouthCues, 'open');
  const speakerBWideExpression = buildCueExpression(input.speakerBMouthCues, 'wide');
  const speakerBFvExpression = buildCueExpression(input.speakerBMouthCues, 'fv');

  return [
    `[0:v]${highlightA}${highlightB}drawbox=x=0:y=1532:w=${VIDEO_WIDTH}:h=388:color=0x020617@0.62:t=fill[bg]`,
    `[1:v]scale=${input.hostAScaledWidth}:-1[hosta_base]`,
    `[2:v]scale=${input.hostAScaledWidth}:-1[hosta_mid]`,
    `[3:v]scale=${input.hostAScaledWidth}:-1[hosta_open]`,
    `[4:v]scale=${input.hostAScaledWidth}:-1[hosta_wide]`,
    `[5:v]scale=${input.hostAScaledWidth}:-1[hosta_fv]`,
    `[6:v]scale=${input.hostAScaledWidth}:-1[hosta_blink]`,
    `[7:v]scale=${input.hostBScaledWidth}:-1[hostb_base]`,
    `[8:v]scale=${input.hostBScaledWidth}:-1[hostb_mid]`,
    `[9:v]scale=${input.hostBScaledWidth}:-1[hostb_open]`,
    `[10:v]scale=${input.hostBScaledWidth}:-1[hostb_wide]`,
    `[11:v]scale=${input.hostBScaledWidth}:-1[hostb_fv]`,
    `[12:v]scale=${input.hostBScaledWidth}:-1[hostb_blink]`,
    `[bg][hosta_base]overlay=x=${hostAPosition.x}:y='${hostABob}'[v1]`,
    `[v1][hostb_base]overlay=x=${hostBPosition.x}:y='${hostBBob}'[v2]`,
    `[v2][hosta_mid]overlay=x=${hostAPosition.x}:y='${hostABob}':enable='${speakerAMidExpression}'[v3]`,
    `[v3][hosta_open]overlay=x=${hostAPosition.x}:y='${hostABob}':enable='${speakerAOpenExpression}'[v4]`,
    `[v4][hosta_wide]overlay=x=${hostAPosition.x}:y='${hostABob}':enable='${speakerAWideExpression}'[v5]`,
    `[v5][hosta_fv]overlay=x=${hostAPosition.x}:y='${hostABob}':enable='${speakerAFvExpression}'[v6]`,
    `[v6][hosta_blink]overlay=x=${hostAPosition.x}:y='${hostABob}':enable='${buildBlinkExpression(
      input.durationSeconds,
      0.35
    )}'[v7]`,
    `[v7][hostb_mid]overlay=x=${hostBPosition.x}:y='${hostBBob}':enable='${speakerBMidExpression}'[v8]`,
    `[v8][hostb_open]overlay=x=${hostBPosition.x}:y='${hostBBob}':enable='${speakerBOpenExpression}'[v9]`,
    `[v9][hostb_wide]overlay=x=${hostBPosition.x}:y='${hostBBob}':enable='${speakerBWideExpression}'[v10]`,
    `[v10][hostb_fv]overlay=x=${hostBPosition.x}:y='${hostBBob}':enable='${speakerBFvExpression}'[v11]`,
    `[v11][hostb_blink]overlay=x=${hostBPosition.x}:y='${hostBBob}':enable='${buildBlinkExpression(
      input.durationSeconds,
      1.15
    )}'[composed_chars]`,
    input.focusBExpression
      ? `[composed_chars]drawbox=x=32:y=622:w=430:h=846:color=black@0.65:t=fill:enable='${input.focusBExpression}'[dimmed_a]`
      : '[composed_chars]null[dimmed_a]',
    input.focusAExpression
      ? `[dimmed_a]drawbox=x=618:y=646:w=430:h=820:color=black@0.65:t=fill:enable='${input.focusAExpression}'[dimmed_b]`
      : '[dimmed_a]null[dimmed_b]',
    '[dimmed_b]format=yuv420p[outv]',
  ].join(';');
}

function buildPreviewArgs(input: {
  concatVideoPath: string;
  narrationPath: string | null;
  backgroundAudioPath: string | null;
  renderedDurationSeconds: number;
  videoPaddingSeconds: number;
  captionFilter: string;
}): string[] {
  const videoFilter = `[0:v]${
    input.videoPaddingSeconds > 0
      ? `tpad=stop_mode=clone:stop_duration=${formatFilterDuration(input.videoPaddingSeconds)},`
      : ''
  }${input.captionFilter}[renderv]`;
  const narrationInputIndex = 1;
  const backgroundInputIndex = 2;
  const baseAudioFilter = `[${narrationInputIndex}:a]apad=whole_dur=${formatFilterDuration(
    input.renderedDurationSeconds
  )},atrim=duration=${formatFilterDuration(input.renderedDurationSeconds)}[voice]`;
  const audioFilter = input.backgroundAudioPath
    ? `${baseAudioFilter};[${backgroundInputIndex}:a]volume=0.08,apad=whole_dur=${formatFilterDuration(
        input.renderedDurationSeconds
      )},atrim=duration=${formatFilterDuration(
        input.renderedDurationSeconds
      )}[bed];[voice][bed]amix=inputs=2:duration=first:dropout_transition=2[rendera]`
    : `${baseAudioFilter};[voice]anull[rendera]`;

  return [
    '-y',
    '-i',
    input.concatVideoPath,
    ...(input.narrationPath
      ? ['-i', input.narrationPath]
      : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']),
    ...(input.backgroundAudioPath ? ['-stream_loop', '-1', '-i', input.backgroundAudioPath] : []),
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
    '192k',
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

function indexSceneVisualAssets(assetReferences: AssetReference[]): Map<number, AssetReference> {
  const sceneAssets = new Map<number, AssetReference>();

  for (const reference of assetReferences) {
    if (reference.sceneOrder === null || !isRenderableSceneAsset(reference)) {
      continue;
    }

    const existing = sceneAssets.get(reference.sceneOrder);
    if (!existing) {
      sceneAssets.set(reference.sceneOrder, reference);
      continue;
    }

    if (existing.kind !== 'video' && reference.kind === 'video') {
      sceneAssets.set(reference.sceneOrder, reference);
    }
  }

  return sceneAssets;
}

function isRenderableSceneAsset(reference: AssetReference): boolean {
  return reference.kind === 'video' || isRenderableImageAsset(reference);
}

function isRenderableImageAsset(reference: AssetReference): boolean {
  return reference.kind === 'metadata' && reference.mimeType?.startsWith('image/') === true;
}

function buildRenderSummary(input: RenderInput): string {
  const clipCount = input.assetReferences.filter((reference) => reference.kind === 'video').length;
  const narrationMode = input.narrationPath ? 'mixed narration' : 'silent fallback audio';
  const contentMode = input.contentMode ?? 'narration';
  return `Generated ${contentMode} review package for "${input.job.topic}" using ${clipCount} sourced clip(s) and ${narrationMode}.`;
}

function buildCaptionFilter(
  contentMode: ContentMode,
  subtitleSafeZone: DialogueCharacterRasterPack['subtitleSafeZone'] | null
): string {
  const marginV =
    contentMode === 'dialogue' && subtitleSafeZone
      ? Math.max(36, VIDEO_HEIGHT - (subtitleSafeZone.top + subtitleSafeZone.height) + 8)
      : 40;

  // Caption style — 16pt bold, thick black outline, shadow, bottom-centre.
  // Bold=1 improves readability on busy archival footage.
  // Outline=3 + Shadow=1 creates strong contrast on any background colour.
  // MarginV positions captions above the lower 3rd of screen to avoid cropping on Reels.
  return `subtitles=captions.srt:force_style='FontName=Arial,FontSize=16,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=${marginV},MarginL=40,MarginR=40'`;
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

function normalizeDialogueTurnsForScene(
  dialogueTurns: DialogueTurnTiming[],
  sceneStartSeconds: number,
  sceneDurationSeconds: number
): DialogueTurnTiming[] {
  return dialogueTurns
    .map((turn) => ({
      ...turn,
      startSeconds: Math.max(0, turn.startSeconds - sceneStartSeconds),
      endSeconds: Math.min(
        sceneDurationSeconds,
        Math.max(0.1, turn.endSeconds - sceneStartSeconds)
      ),
    }))
    .filter((turn) => turn.endSeconds > turn.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds);
}

function normalizeTranscriptWordsForScene(
  transcriptWords: TranscriptWordTiming[],
  sceneStartSeconds: number,
  sceneEndSeconds: number
): TranscriptWordTiming[] {
  return transcriptWords
    .filter((word) => word.endSeconds > sceneStartSeconds && word.startSeconds < sceneEndSeconds)
    .map((word) => ({
      ...word,
      startSeconds: Math.max(0, word.startSeconds - sceneStartSeconds),
      endSeconds: Math.max(0.05, Math.min(sceneEndSeconds, word.endSeconds) - sceneStartSeconds),
    }))
    .filter((word) => word.endSeconds > word.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds);
}

function buildScaledHostWidth(canvasWidth: number, scale: number): number {
  return Math.max(180, Math.round(canvasWidth * scale));
}

function buildHighlightExpression(dialogueTurns: DialogueTurnTiming[]): string | null {
  const windows = dialogueTurns.map(
    (turn) =>
      `between(t,${formatFilterDuration(turn.startSeconds)},${formatFilterDuration(turn.endSeconds)})`
  );
  return windows.length > 0 ? windows.join('+') : null;
}

function buildDialogueMouthCues(
  speakerId: string,
  dialogueTurns: DialogueTurnTiming[],
  transcriptWords: TranscriptWordTiming[]
): DialogueMouthCue[] {
  if (dialogueTurns.length === 0) {
    return [];
  }

  const transcriptCues: DialogueMouthCue[] = [];
  for (const turn of dialogueTurns) {
    const turnWords = transcriptWords.filter((word) => {
      const midpoint = (word.startSeconds + word.endSeconds) / 2;
      return midpoint >= turn.startSeconds && midpoint <= turn.endSeconds;
    });

    for (const word of turnWords) {
      const durationSeconds = Math.max(0.1, word.endSeconds - word.startSeconds);
      const onsetEnd = Math.min(word.endSeconds, word.startSeconds + durationSeconds * 0.2);
      const sustainEnd = Math.max(onsetEnd + 0.02, word.startSeconds + durationSeconds * 0.78);
      transcriptCues.push({
        speakerId,
        state: classifyDialogueMouthState(word.word),
        startSeconds: onsetEnd,
        endSeconds: Math.min(word.endSeconds, sustainEnd),
      });

      if (sustainEnd < word.endSeconds) {
        transcriptCues.push({
          speakerId,
          state: 'mid',
          startSeconds: sustainEnd,
          endSeconds: word.endSeconds,
        });
      }
    }
  }

  if (transcriptCues.length > 0) {
    return transcriptCues;
  }

  return dialogueTurns.flatMap((turn) => {
    const durationSeconds = Math.max(0.16, turn.endSeconds - turn.startSeconds);
    const firstEnd = turn.startSeconds + durationSeconds * 0.32;
    const secondEnd = turn.startSeconds + durationSeconds * 0.66;
    const thirdEnd = turn.startSeconds + durationSeconds * 0.88;
    return [
      {
        speakerId,
        state: 'mid' as const,
        startSeconds: turn.startSeconds,
        endSeconds: firstEnd,
      },
      {
        speakerId,
        state: 'open' as const,
        startSeconds: firstEnd,
        endSeconds: secondEnd,
      },
      {
        speakerId,
        state: 'wide' as const,
        startSeconds: secondEnd,
        endSeconds: thirdEnd,
      },
      {
        speakerId,
        state: 'mid' as const,
        startSeconds: thirdEnd,
        endSeconds: turn.endSeconds,
      },
    ].filter((cue) => cue.endSeconds > cue.startSeconds);
  });
}

function classifyDialogueMouthState(word: string): DialogueMouthState {
  const normalized = word.toLowerCase();
  if (/[fv]/.test(normalized)) {
    return 'fv';
  }

  if (/(aa|ae|ai|ay|ea|ia)|[a]/.test(normalized)) {
    return 'wide';
  }

  if (/(oo|ou|ow|aw|uh)|[ou]/.test(normalized)) {
    return 'open';
  }

  return 'mid';
}

function buildCueExpression(cues: DialogueMouthCue[], state: DialogueMouthState): string {
  const windows = cues
    .filter((cue) => cue.state === state)
    .map(
      (cue) =>
        `between(t,${formatFilterDuration(cue.startSeconds)},${formatFilterDuration(cue.endSeconds)})`
    );
  return windows.length > 0 ? windows.join('+') : '0';
}

function buildBlinkExpression(durationSeconds: number, offsetSeconds: number): string {
  return `lt(t,${formatFilterDuration(durationSeconds)})*between(mod(t+${formatFilterDuration(
    offsetSeconds
  )},3.4),3.06,3.16)`;
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
