import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { AppEnv } from '@autom/config';
import type { AssetReference } from '@autom/contracts';

import { ensureJobArtifactDirectory, writeArtifactFile } from '../../lib/artifacts.js';
import type { TranscriptWordTiming, TranscriptionProvider } from '../../lib/types.js';

const GROQ_TRANSCRIPTION_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

type GroqTranscriptWord = {
  word?: unknown;
  start?: unknown;
  end?: unknown;
  confidence?: unknown;
};

type GroqTranscriptSegment = {
  words?: GroqTranscriptWord[];
};

type GroqVerboseTranscript = {
  words?: GroqTranscriptWord[];
  segments?: GroqTranscriptSegment[];
  text?: string;
};

export class NullTranscriptionProvider implements TranscriptionProvider {
  async transcribe() {
    return {
      transcriptWords: null,
      assetReferences: [],
      warnings: [],
    };
  }
}

export class GroqTranscriptionProvider implements TranscriptionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number
  ) {}

  async transcribe(input: Parameters<TranscriptionProvider['transcribe']>[0]) {
    if (!input.narrationPath) {
      return {
        transcriptWords: null,
        assetReferences: [],
        warnings: [],
      };
    }

    const audioBytes = await readFile(input.narrationPath);
    const form = new FormData();
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
    form.append(
      'file',
      new Blob([audioBytes], { type: 'audio/mpeg' }),
      basename(input.narrationPath)
    );

    let response: Response;
    try {
      response = await fetch(GROQ_TRANSCRIPTION_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Groq transcription timed out after ${this.timeoutMs}ms.`);
      }

      throw error;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Groq transcription failed with status ${response.status}.${body ? ` ${body}` : ''}`
      );
    }

    const payload = (await response.json()) as GroqVerboseTranscript;
    const transcriptWords = normalizeTranscriptWords(payload);
    const artifactDirectory = await ensureJobArtifactDirectory(
      input.runtimePaths,
      input.jobId,
      'transcript'
    );
    const transcriptPath = join(artifactDirectory, 'groq-transcript.json');
    await writeArtifactFile(transcriptPath, JSON.stringify(payload, null, 2));

    const warnings =
      transcriptWords.length === 0
        ? ['Groq transcription returned no usable word timestamps, so subtitle timing fell back.']
        : [];

    return {
      transcriptWords: transcriptWords.length > 0 ? transcriptWords : null,
      assetReferences: [buildTranscriptReference(transcriptPath, this.model)],
      warnings,
    };
  }
}

export function createTranscriptionProvider(env: AppEnv): TranscriptionProvider {
  if (env.GROQ_API_KEY) {
    return new GroqTranscriptionProvider(
      env.GROQ_API_KEY,
      env.GROQ_TRANSCRIPTION_MODEL,
      env.GROQ_TRANSCRIPTION_TIMEOUT_SECONDS * 1000
    );
  }

  return new NullTranscriptionProvider();
}

function buildTranscriptReference(path: string, model: string): AssetReference {
  return {
    kind: 'metadata',
    path,
    label: `Groq transcript (${model})`,
    provider: 'groq',
    sourceUrl: GROQ_TRANSCRIPTION_ENDPOINT,
    mimeType: 'application/json',
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

function normalizeTranscriptWords(payload: GroqVerboseTranscript): TranscriptWordTiming[] {
  const rawWords = [
    ...(payload.words ?? []),
    ...(payload.segments ?? []).flatMap((segment) => segment.words ?? []),
  ];

  const normalized = rawWords
    .map((word) => normalizeTranscriptWord(word))
    .filter((word): word is TranscriptWordTiming => word !== null)
    .sort((left, right) => left.startSeconds - right.startSeconds);

  return dedupeTranscriptWords(normalized);
}

function normalizeTranscriptWord(word: GroqTranscriptWord): TranscriptWordTiming | null {
  const value = typeof word.word === 'string' ? word.word.trim() : '';
  const startSeconds = toFiniteNumber(word.start);
  const endSeconds = toFiniteNumber(word.end);

  if (!value || startSeconds === null || endSeconds === null) {
    return null;
  }

  return {
    word: value,
    startSeconds,
    endSeconds: Math.max(startSeconds + 0.05, endSeconds),
    confidence: toFiniteNumber(word.confidence),
  };
}

function dedupeTranscriptWords(words: TranscriptWordTiming[]): TranscriptWordTiming[] {
  const unique: TranscriptWordTiming[] = [];

  for (const word of words) {
    const previous = unique[unique.length - 1];
    if (
      previous &&
      previous.word === word.word &&
      Math.abs(previous.startSeconds - word.startSeconds) < 0.01 &&
      Math.abs(previous.endSeconds - word.endSeconds) < 0.01
    ) {
      continue;
    }

    unique.push(word);
  }

  return unique;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
