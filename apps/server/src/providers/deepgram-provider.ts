import { copyFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { AppEnv, RuntimePaths } from '@autom/config';
import type { AssetReference, ContentProfile, ScriptPackage } from '@autom/contracts';

import { ensureJobArtifactDirectory, writeArtifactFile } from '../lib/artifacts.js';
import {
  buildSceneNarrationTimeline,
  estimateNarrationDurationSeconds,
} from '../lib/content-quality.js';
import { DIALOGUE_HOST_A_ID, isDialogueMode } from '../lib/dialogue.js';
import type { DialogueTurnTiming, VoiceProvider } from '../lib/types.js';
import { type CommandRunner, createProcessRunner } from '../media/ffmpeg-renderer.js';
import { GoogleTtsVoiceProvider } from './google-tts-provider.js';

const DEEPGRAM_TTS_ENDPOINT = 'https://api.deepgram.com/v1/speak';
const DEEPGRAM_MIN_REQUEST_TIMEOUT_MS = 60_000;
const DEEPGRAM_TIMEOUT_BUFFER_MS = 30_000;
const MAX_NARRATION_CHUNK_LENGTH = 1_200;
const DEFAULT_STITCH_TIMEOUT_MS = 30_000;

export class LocalVoiceProvider implements VoiceProvider {
  async synthesize(
    scriptPackage: ScriptPackage,
    _profile: ContentProfile,
    jobId: string,
    runtimePaths: RuntimePaths
  ) {
    const directory = await ensureJobArtifactDirectory(runtimePaths, jobId, 'voice');
    const metadataPath = join(directory, 'narration.txt');
    await writeArtifactFile(
      metadataPath,
      scriptPackage.scenes.map((scene) => scene.text).join('\n')
    );
    const metadataReference: AssetReference = {
      kind: 'metadata',
      path: metadataPath,
      label: 'Local narration transcript',
      provider: 'local',
      sourceUrl: null,
      mimeType: 'text/plain',
      externalId: null,
      sceneOrder: null,
      query: null,
      retrievalOrigin: 'research',
      licenseLabel: null,
      rightsSummary: null,
      attributionRequired: false,
      entityLabel: null,
      matchQuality: null,
      reuseStatus: null,
    };

    return {
      narrationPath: null,
      assetReferences: [metadataReference],
      warnings: [],
      sceneNarrationTimeline: null,
    };
  }
}

export class DeepgramVoiceProvider implements VoiceProvider {
  private readonly runCommand: CommandRunner;
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly stitchTimeoutMs: number;

  constructor(
    private readonly apiKey: string,
    options?: {
      ffmpegPath?: string;
      ffprobePath?: string;
      runCommand?: CommandRunner;
      stitchTimeoutMs?: number;
    }
  ) {
    this.ffmpegPath = options?.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options?.ffprobePath ?? 'ffprobe';
    this.stitchTimeoutMs = options?.stitchTimeoutMs ?? DEFAULT_STITCH_TIMEOUT_MS;
    this.runCommand = options?.runCommand ?? createProcessRunner(this.stitchTimeoutMs);
  }

  async synthesize(
    scriptPackage: ScriptPackage,
    profile: ContentProfile,
    jobId: string,
    runtimePaths: RuntimePaths
  ) {
    const directory = await ensureJobArtifactDirectory(runtimePaths, jobId, 'voice');
    if (isDialogueMode(profile) && scriptPackage.dialogue) {
      return await this.synthesizeDialogue(scriptPackage, profile, directory);
    }

    return await this.synthesizeNarration(scriptPackage, profile, directory);
  }

  private async synthesizeNarration(
    scriptPackage: ScriptPackage,
    profile: ContentProfile,
    directory: string
  ) {
    const narration = await this.synthesizeText({
      texts: scriptPackage.scenes.map((scene) => scene.text),
      voiceModel: profile.defaultVoice,
      outputDirectory: directory,
      label: 'narration',
    });

    const totalNarrationDurationSeconds = await probeAudioDuration(
      this.runCommand,
      this.ffprobePath,
      narration.outputPath,
      directory,
      this.stitchTimeoutMs
    );

    return {
      narrationPath: narration.outputPath,
      assetReferences: [
        buildNarrationAssetReference(
          narration.outputPath,
          narration.mimeType,
          profile.defaultVoice
        ),
      ],
      warnings: narration.warnings,
      sceneNarrationTimeline: buildSceneNarrationTimeline(
        scriptPackage.scenes.map((scene) => ({
          order: scene.order,
          text: scene.text,
        })),
        totalNarrationDurationSeconds
      ),
      dialogueTurnTimeline: null,
    };
  }

  private async synthesizeDialogue(
    scriptPackage: ScriptPackage,
    profile: ContentProfile,
    directory: string
  ) {
    const turns = scriptPackage.dialogue?.turns ?? [];
    const turnDirectory = join(directory, 'turns');
    await mkdir(turnDirectory, { recursive: true });

    const dialogueTurnTimeline: DialogueTurnTiming[] = [];
    const turnPaths: string[] = [];
    const warnings: string[] = [];
    let elapsedSeconds = 0;

    for (const turn of turns) {
      const voiceModel =
        turn.speakerId === DIALOGUE_HOST_A_ID ? profile.dialogueVoiceA : profile.dialogueVoiceB;
      const turnOutputDirectory = join(turnDirectory, `turn-${turn.order}`);
      const synthesis = await this.synthesizeText({
        texts: [turn.text],
        voiceModel,
        outputDirectory: turnOutputDirectory,
        label: `dialogue turn ${turn.order}`,
      });

      warnings.push(...synthesis.warnings);
      turnPaths.push(synthesis.outputPath);
      dialogueTurnTimeline.push({
        turnOrder: turn.order,
        sceneOrder: turn.sceneOrder,
        speakerId: turn.speakerId,
        startSeconds: elapsedSeconds,
        endSeconds: elapsedSeconds + synthesis.durationSeconds,
        text: turn.text,
        shotType: turn.shotType,
      });
      elapsedSeconds += synthesis.durationSeconds;
    }

    await stitchNarrationChunks({
      ffmpegPath: this.ffmpegPath,
      runCommand: this.runCommand,
      stitchTimeoutMs: this.stitchTimeoutMs,
      chunkPaths: turnPaths,
      outputDirectory: directory,
    });

    const outputPath = join(directory, 'narration.mp3');
    return {
      narrationPath: outputPath,
      assetReferences: [buildNarrationAssetReference(outputPath, 'audio/mpeg', 'dialogue-mix')],
      warnings,
      sceneNarrationTimeline: buildSceneTimelineFromDialogue(dialogueTurnTimeline),
      dialogueTurnTimeline,
    };
  }

  private async synthesizeText(input: {
    texts: string[];
    voiceModel: string;
    outputDirectory: string;
    label: string;
  }): Promise<{
    outputPath: string;
    mimeType: string;
    warnings: string[];
    durationSeconds: number;
  }> {
    const narrationChunks = buildNarrationChunks(input.texts, MAX_NARRATION_CHUNK_LENGTH);
    const chunkDirectory = join(input.outputDirectory, 'chunks');
    await mkdir(chunkDirectory, { recursive: true });
    let lastResponse: Response | null = null;
    const chunkPaths: string[] = [];

    for (const [index, chunk] of narrationChunks.entries()) {
      const response = await requestDeepgramSpeech(
        this.apiKey,
        input.voiceModel,
        chunk,
        index,
        narrationChunks.length
      );
      lastResponse = response;
      const chunkPath = join(chunkDirectory, `chunk-${index + 1}.mp3`);
      const audioBytes = await readAudioBytes(response, index, narrationChunks.length);
      await writeArtifactFile(chunkPath, Buffer.from(audioBytes));
      chunkPaths.push(chunkPath);
    }

    const outputPath = join(input.outputDirectory, 'narration.mp3');
    if (chunkPaths.length === 1) {
      await copyFile(chunkPaths[0] ?? '', outputPath);
    } else {
      await stitchNarrationChunks({
        ffmpegPath: this.ffmpegPath,
        runCommand: this.runCommand,
        stitchTimeoutMs: this.stitchTimeoutMs,
        chunkPaths,
        outputDirectory: input.outputDirectory,
      });
    }

    const durationSeconds = await probeAudioDuration(
      this.runCommand,
      this.ffprobePath,
      outputPath,
      input.outputDirectory,
      this.stitchTimeoutMs
    );

    return {
      outputPath,
      mimeType: lastResponse?.headers.get('content-type') ?? 'audio/mpeg',
      warnings:
        narrationChunks.length > 1
          ? [
              `Deepgram ${input.label} was split into ${narrationChunks.length} chunks to stay within request limits.`,
            ]
          : [],
      durationSeconds,
    };
  }
}

export function createVoiceProvider(env: AppEnv): VoiceProvider {
  // Priority order:
  // 1. Google TTS  — best free quality (Neural2, 1M chars/month free)
  //    Get key: console.cloud.google.com → APIs & Services → Cloud Text-to-Speech API
  // 2. Deepgram    — kept as fallback for users who already have a key set up
  // 3. Local       — no audio, text-only transcript fallback
  if (env.GOOGLE_TTS_API_KEY) {
    return new GoogleTtsVoiceProvider(env.GOOGLE_TTS_API_KEY, {
      ffmpegPath: env.FFMPEG_PATH,
      ffprobePath: env.FFPROBE_PATH,
      stitchTimeoutMs: env.FFMPEG_COMMAND_TIMEOUT_SECONDS * 1000,
    });
  }

  if (env.DEEPGRAM_API_KEY) {
    return new DeepgramVoiceProvider(env.DEEPGRAM_API_KEY, {
      ffmpegPath: env.FFMPEG_PATH,
      ffprobePath: env.FFPROBE_PATH,
      stitchTimeoutMs: env.FFMPEG_COMMAND_TIMEOUT_SECONDS * 1000,
    });
  }

  return new LocalVoiceProvider();
}

function buildNarrationAssetReference(
  outputPath: string,
  mimeType: string,
  voiceModel: string
): AssetReference {
  return {
    kind: 'audio',
    path: outputPath,
    label: `Deepgram narration (${voiceModel})`,
    provider: 'deepgram',
    sourceUrl: DEEPGRAM_TTS_ENDPOINT,
    mimeType,
    externalId: null,
    sceneOrder: null,
    query: null,
    retrievalOrigin: 'research',
    licenseLabel: null,
    rightsSummary: null,
    attributionRequired: false,
    entityLabel: null,
    matchQuality: null,
    reuseStatus: null,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export function buildDeepgramRequestTimeoutMs(chunkText: string): number {
  const estimatedNarrationSeconds = estimateNarrationDurationSeconds([chunkText]);

  return Math.max(
    DEEPGRAM_MIN_REQUEST_TIMEOUT_MS,
    Math.ceil(estimatedNarrationSeconds * 1000) + DEEPGRAM_TIMEOUT_BUFFER_MS
  );
}

function buildSceneTimelineFromDialogue(dialogueTurnTimeline: DialogueTurnTiming[]) {
  const timelineByScene = new Map<
    number,
    {
      sceneOrder: number;
      startSeconds: number;
      endSeconds: number;
    }
  >();

  for (const turn of dialogueTurnTimeline) {
    const existing = timelineByScene.get(turn.sceneOrder);
    if (!existing) {
      timelineByScene.set(turn.sceneOrder, {
        sceneOrder: turn.sceneOrder,
        startSeconds: turn.startSeconds,
        endSeconds: turn.endSeconds,
      });
      continue;
    }

    existing.startSeconds = Math.min(existing.startSeconds, turn.startSeconds);
    existing.endSeconds = Math.max(existing.endSeconds, turn.endSeconds);
  }

  return [...timelineByScene.values()].sort((left, right) => left.sceneOrder - right.sceneOrder);
}

async function stitchNarrationChunks(input: {
  ffmpegPath: string;
  runCommand: CommandRunner;
  stitchTimeoutMs: number;
  chunkPaths: string[];
  outputDirectory: string;
}) {
  const concatListPath = join(input.outputDirectory, 'concat.txt');
  const concatFile = input.chunkPaths
    .map((chunkPath) => `file '${relative(input.outputDirectory, chunkPath).replace(/\\/g, '/')}'`)
    .join('\n');

  await writeArtifactFile(concatListPath, concatFile);

  try {
    await input.runCommand(
      input.ffmpegPath,
      ['-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'narration.mp3'],
      input.outputDirectory,
      input.stitchTimeoutMs
    );
  } catch {
    await input.runCommand(
      input.ffmpegPath,
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        'concat.txt',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        'narration.mp3',
      ],
      input.outputDirectory,
      input.stitchTimeoutMs
    );
  }
}

function buildNarrationChunks(texts: string[], maxChunkLength: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const text of texts) {
    for (const segment of splitNarrationText(text, maxChunkLength)) {
      if (!currentChunk) {
        currentChunk = segment;
        continue;
      }

      const candidate = `${currentChunk} ${segment}`;
      if (candidate.length <= maxChunkLength) {
        currentChunk = candidate;
        continue;
      }

      chunks.push(currentChunk);
      currentChunk = segment;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

async function requestDeepgramSpeech(
  apiKey: string,
  voiceModel: string,
  chunk: string,
  index: number,
  totalChunks: number
): Promise<Response> {
  const requestTimeoutMs = buildDeepgramRequestTimeoutMs(chunk);

  try {
    const response = await fetch(
      `${DEEPGRAM_TTS_ENDPOINT}?model=${encodeURIComponent(voiceModel)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
        body: JSON.stringify({
          text: chunk,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Deepgram narration failed with status ${response.status}.`);
    }

    return response;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `Deepgram narration request timed out while synthesizing chunk ${index + 1} of ${totalChunks}.`
      );
    }

    throw error;
  }
}

async function readAudioBytes(
  response: Response,
  index: number,
  totalChunks: number
): Promise<ArrayBuffer> {
  try {
    return await response.arrayBuffer();
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `Deepgram narration response timed out while reading chunk ${index + 1} of ${totalChunks}.`
      );
    }

    throw error;
  }
}

async function probeAudioDuration(
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

function splitNarrationText(text: string, maxChunkLength: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxChunkLength) {
    return [normalized];
  }

  const sentenceGroups = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const rawSentence of sentenceGroups) {
    const sentence = rawSentence.trim();
    if (!sentence) {
      continue;
    }

    if (sentence.length <= maxChunkLength) {
      const candidate = currentChunk ? `${currentChunk} ${sentence}` : sentence;
      if (candidate.length <= maxChunkLength) {
        currentChunk = candidate;
        continue;
      }

      if (currentChunk) {
        chunks.push(currentChunk);
      }

      currentChunk = sentence;
      continue;
    }

    for (const wordChunk of splitLongSentence(sentence, maxChunkLength)) {
      const candidate = currentChunk ? `${currentChunk} ${wordChunk}` : wordChunk;
      if (candidate.length <= maxChunkLength) {
        currentChunk = candidate;
        continue;
      }

      if (currentChunk) {
        chunks.push(currentChunk);
      }

      currentChunk = wordChunk;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function splitLongSentence(text: string, maxChunkLength: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const word of words) {
    const candidate = currentChunk ? `${currentChunk} ${word}` : word;
    if (candidate.length <= maxChunkLength) {
      currentChunk = candidate;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    currentChunk = word;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
