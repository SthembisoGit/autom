import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { RuntimePaths } from '@autom/config';
import type { AssetReference, ContentProfile, ScriptPackage } from '@autom/contracts';

import { ensureJobArtifactDirectory, writeArtifactFile } from '../lib/artifacts.js';
import {
  buildSceneNarrationTimeline,
  estimateNarrationDurationSeconds,
} from '../lib/content-quality.js';
import { DIALOGUE_HOST_A_ID, isDialogueMode } from '../lib/dialogue.js';
import type { DialogueTurnTiming, VoiceProvider } from '../lib/types.js';
import { type CommandRunner, createProcessRunner } from '../media/ffmpeg-renderer.js';

/**
 * Google Cloud Text-to-Speech provider.
 *
 * Free tier: 1,000,000 WaveNet/Neural2 characters per month.
 * No API key required for the REST endpoint when using the API key auth flow.
 * Voices are near-human quality — a significant step up from Deepgram TTS.
 *
 * Voice name format: "<language>-<variant>-<voice-id>"
 * Examples:
 *   en-US-Neural2-J  (male, clear, authoritative — good for news)
 *   en-US-Neural2-F  (female, warm, professional)
 *   en-US-Neural2-A  (female, natural conversational)
 *   en-US-Neural2-D  (male, deep, documentary feel)
 *   en-GB-Neural2-B  (male British accent)
 *   en-ZA-Standard-A (South African English — limited but available)
 */

const GOOGLE_TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const DEFAULT_LANGUAGE_CODE = 'en-US';
const DEFAULT_VOICE_NAME = 'en-US-Neural2-J';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_CHUNK_LENGTH = 4_500; // Google TTS limit is 5000 bytes; keep a buffer
const DEFAULT_STITCH_TIMEOUT_MS = 30_000;

export class GoogleTtsVoiceProvider implements VoiceProvider {
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
    const voiceName = resolveVoiceName(profile.defaultVoice);
    const synthesis = await this.synthesizeText({
      texts: scriptPackage.scenes.map((scene) => scene.text),
      voiceName,
      outputDirectory: directory,
      label: 'narration',
    });

    const durationSeconds = await probeAudioDuration(
      this.runCommand,
      this.ffprobePath,
      synthesis.outputPath,
      directory,
      this.stitchTimeoutMs
    );

    return {
      narrationPath: synthesis.outputPath,
      assetReferences: [buildAudioAssetReference(synthesis.outputPath, voiceName)],
      warnings: synthesis.warnings,
      sceneNarrationTimeline: buildSceneNarrationTimeline(
        scriptPackage.scenes.map((scene) => ({ order: scene.order, text: scene.text })),
        durationSeconds
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
      const rawVoice =
        turn.speakerId === DIALOGUE_HOST_A_ID ? profile.dialogueVoiceA : profile.dialogueVoiceB;
      const voiceName = resolveVoiceName(rawVoice);
      const turnOutputDirectory = join(turnDirectory, `turn-${turn.order}`);
      const synthesis = await this.synthesizeText({
        texts: [turn.text],
        voiceName,
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

    await stitchChunks({
      ffmpegPath: this.ffmpegPath,
      runCommand: this.runCommand,
      stitchTimeoutMs: this.stitchTimeoutMs,
      chunkPaths: turnPaths,
      outputDirectory: directory,
    });

    const outputPath = join(directory, 'narration.mp3');
    return {
      narrationPath: outputPath,
      assetReferences: [buildAudioAssetReference(outputPath, 'dialogue-mix')],
      warnings,
      sceneNarrationTimeline: buildSceneTimelineFromDialogue(dialogueTurnTimeline),
      dialogueTurnTimeline,
    };
  }

  private async synthesizeText(input: {
    texts: string[];
    voiceName: string;
    outputDirectory: string;
    label: string;
  }): Promise<{
    outputPath: string;
    warnings: string[];
    durationSeconds: number;
  }> {
    const fullText = input.texts.join(' ');
    const chunks = splitIntoChunks(fullText, MAX_CHUNK_LENGTH);
    const chunkDirectory = join(input.outputDirectory, 'chunks');
    await mkdir(chunkDirectory, { recursive: true });

    const chunkPaths: string[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const audioBase64 = await requestGoogleTts(this.apiKey, input.voiceName, chunk);
      const chunkPath = join(chunkDirectory, `chunk-${index + 1}.mp3`);
      await writeArtifactFile(chunkPath, Buffer.from(audioBase64, 'base64'));
      chunkPaths.push(chunkPath);
    }

    const outputPath = join(input.outputDirectory, 'narration.mp3');
    if (chunkPaths.length === 1 && chunkPaths[0]) {
      await copyFile(chunkPaths[0], outputPath);
    } else {
      await stitchChunks({
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
      durationSeconds,
      warnings:
        chunks.length > 1
          ? [
              `Google TTS ${input.label} split into ${chunks.length} chunks to stay within request limits.`,
            ]
          : [],
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps the profile's voice model string to a Google TTS voice name.
 * If the value already looks like a Google voice name (contains "-Neural2-" or
 * "-Standard-" or "-Wavenet-"), use it directly. Otherwise fall back to the
 * default high-quality Neural2 voice.
 */
function resolveVoiceName(rawVoiceModel: string): string {
  if (/-(Neural2|Wavenet|Standard|News|Studio)-/i.test(rawVoiceModel)) {
    return rawVoiceModel;
  }

  return DEFAULT_VOICE_NAME;
}

function inferLanguageCode(voiceName: string): string {
  // Voice names are always "<lang-REGION>-<variant>-<id>", e.g. "en-US-Neural2-J"
  const match = voiceName.match(/^([a-z]{2}-[A-Z]{2})/);
  return match?.[1] ?? DEFAULT_LANGUAGE_CODE;
}

async function requestGoogleTts(
  apiKey: string,
  voiceName: string,
  text: string
): Promise<string> {
  const languageCode = inferLanguageCode(voiceName);

  const response = await fetch(`${GOOGLE_TTS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      input: { text },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google TTS failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as { audioContent?: string };
  if (!payload.audioContent) {
    throw new Error('Google TTS returned an empty audio payload.');
  }

  return payload.audioContent;
}

function splitIntoChunks(text: string, maxLength: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;

    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = s.length <= maxLength ? s : s.slice(0, maxLength);
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildAudioAssetReference(outputPath: string, voiceName: string): AssetReference {
  return {
    kind: 'audio',
    path: outputPath,
    label: `Google TTS narration (${voiceName})`,
    provider: 'local',
    sourceUrl: GOOGLE_TTS_ENDPOINT,
    mimeType: 'audio/mpeg',
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

function buildSceneTimelineFromDialogue(turns: DialogueTurnTiming[]) {
  const byScene = new Map<number, { sceneOrder: number; startSeconds: number; endSeconds: number }>();

  for (const turn of turns) {
    const existing = byScene.get(turn.sceneOrder);
    if (!existing) {
      byScene.set(turn.sceneOrder, {
        sceneOrder: turn.sceneOrder,
        startSeconds: turn.startSeconds,
        endSeconds: turn.endSeconds,
      });
    } else {
      existing.startSeconds = Math.min(existing.startSeconds, turn.startSeconds);
      existing.endSeconds = Math.max(existing.endSeconds, turn.endSeconds);
    }
  }

  return [...byScene.values()].sort((a, b) => a.sceneOrder - b.sceneOrder);
}

async function stitchChunks(input: {
  ffmpegPath: string;
  runCommand: CommandRunner;
  stitchTimeoutMs: number;
  chunkPaths: string[];
  outputDirectory: string;
}) {
  const { relative } = await import('node:path');
  const concatListPath = join(input.outputDirectory, 'concat.txt');
  const concatContent = input.chunkPaths
    .map((p) => `file '${relative(input.outputDirectory, p).replace(/\\/g, '/')}'`)
    .join('\n');

  await writeArtifactFile(concatListPath, concatContent);

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
        '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
        '-c:a', 'libmp3lame', '-b:a', '128k', 'narration.mp3',
      ],
      input.outputDirectory,
      input.stitchTimeoutMs
    );
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
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mediaPath],
    cwd,
    timeoutMs
  );
  const duration = Number.parseFloat(probe.stdout.trim());

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Narration duration could not be measured.');
  }

  return duration;
}

// Keep estimateNarrationDurationSeconds usage consistent with Deepgram provider
void estimateNarrationDurationSeconds;
