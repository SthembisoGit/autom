import { copyFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { AppEnv, RuntimePaths } from '@autom/config';
import type { AssetReference, ContentProfile, ScriptPackage } from '@autom/contracts';

import { ensureJobArtifactDirectory, writeArtifactFile } from '../lib/artifacts.js';
import { createProcessRunner, type CommandRunner } from '../media/ffmpeg-renderer.js';
import type { VoiceProvider } from '../lib/types.js';

const DEEPGRAM_TTS_ENDPOINT = 'https://api.deepgram.com/v1/speak';
const DEEPGRAM_REQUEST_TIMEOUT_MS = 30_000;
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
    };

    return {
      narrationPath: null,
      assetReferences: [metadataReference],
      warnings: [],
    };
  }
}

export class DeepgramVoiceProvider implements VoiceProvider {
  private readonly runCommand: CommandRunner;
  private readonly ffmpegPath: string;
  private readonly stitchTimeoutMs: number;

  constructor(
    private readonly apiKey: string,
    options?: {
      ffmpegPath?: string;
      runCommand?: CommandRunner;
      stitchTimeoutMs?: number;
    }
  ) {
    this.ffmpegPath = options?.ffmpegPath ?? 'ffmpeg';
    this.stitchTimeoutMs = options?.stitchTimeoutMs ?? DEFAULT_STITCH_TIMEOUT_MS;
    this.runCommand = options?.runCommand ?? createProcessRunner(this.stitchTimeoutMs);
  }

  async synthesize(
    scriptPackage: ScriptPackage,
    profile: ContentProfile,
    jobId: string,
    runtimePaths: RuntimePaths
  ) {
    const narrationChunks = buildNarrationChunks(
      scriptPackage.scenes.map((scene) => scene.text),
      MAX_NARRATION_CHUNK_LENGTH
    );
    const directory = await ensureJobArtifactDirectory(runtimePaths, jobId, 'voice');
    const chunkDirectory = join(directory, 'chunks');
    await mkdir(chunkDirectory, { recursive: true });
    let lastResponse: Response | null = null;
    const chunkPaths: string[] = [];

    for (const [index, chunk] of narrationChunks.entries()) {
      const response = await fetch(
        `${DEEPGRAM_TTS_ENDPOINT}?model=${encodeURIComponent(profile.defaultVoice)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(DEEPGRAM_REQUEST_TIMEOUT_MS),
          body: JSON.stringify({
            text: chunk,
          }),
        }
      ).catch((error) => {
        if (isAbortError(error)) {
          throw new Error('Deepgram narration request timed out.');
        }

        throw error;
      });

      if (!response.ok) {
        throw new Error(`Deepgram narration failed with status ${response.status}.`);
      }

      lastResponse = response;
      const chunkPath = join(chunkDirectory, `chunk-${index + 1}.mp3`);
      await writeArtifactFile(chunkPath, Buffer.from(await response.arrayBuffer()));
      chunkPaths.push(chunkPath);
    }

    const outputPath = join(directory, 'narration.mp3');
    if (chunkPaths.length === 1) {
      await copyFile(chunkPaths[0] ?? '', outputPath);
    } else {
      await stitchNarrationChunks({
        ffmpegPath: this.ffmpegPath,
        runCommand: this.runCommand,
        stitchTimeoutMs: this.stitchTimeoutMs,
        chunkPaths,
        outputDirectory: directory,
      });
    }

    return {
      narrationPath: outputPath,
      assetReferences: [
        buildNarrationAssetReference(
          outputPath,
          lastResponse ?? new Response(null),
          profile.defaultVoice
        ),
      ],
      warnings:
        narrationChunks.length > 1
          ? [
              `Deepgram narration was split into ${narrationChunks.length} chunks to stay within request limits.`,
            ]
          : [],
    };
  }
}

export function createVoiceProvider(env: AppEnv): VoiceProvider {
  if (env.DEEPGRAM_API_KEY) {
    return new DeepgramVoiceProvider(env.DEEPGRAM_API_KEY, {
      ffmpegPath: env.FFMPEG_PATH,
      stitchTimeoutMs: env.FFMPEG_COMMAND_TIMEOUT_SECONDS * 1000,
    });
  }

  return new LocalVoiceProvider();
}

function buildNarrationAssetReference(
  outputPath: string,
  response: Response,
  voiceModel: string
): AssetReference {
  return {
    kind: 'audio',
    path: outputPath,
    label: `Deepgram narration (${voiceModel})`,
    provider: 'deepgram',
    sourceUrl: DEEPGRAM_TTS_ENDPOINT,
    mimeType: response.headers.get('content-type') ?? 'audio/mpeg',
    externalId: null,
    sceneOrder: null,
    query: null,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
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
