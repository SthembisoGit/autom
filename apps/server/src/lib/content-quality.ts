import type { TranscriptWordTiming } from './types.js';

type SubtitleScene = {
  order: number;
  text: string;
  durationSeconds: number;
};

export type SceneNarrationTiming = {
  sceneOrder: number;
  startSeconds: number;
  endSeconds: number;
};

type SubtitleCue = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

type SubtitleCueDraft = SubtitleCue & {
  durationSeconds: number;
};

const MAX_SUBTITLE_LINE_LENGTH = 32;
const MAX_SUBTITLE_LINES = 2;
const MAX_SUBTITLE_CUE_DURATION_SECONDS = 4;
const NARRATION_WORDS_PER_SECOND = 2.2;
const NARRATION_OVERSHOOT_RATIO = 0.15;
const NARRATION_OVERSHOOT_MIN_SECONDS = 5;

export type { SubtitleCue };

export function estimateNarrationDurationSeconds(texts: string[]): number {
  const normalized = texts.join(' ').replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return 0;
  }

  const words = normalized.match(/[\p{L}\p{N}'-]+/gu) ?? [];
  return Math.max(1, words.length / NARRATION_WORDS_PER_SECOND);
}

export function getNarrationOvershootAllowanceSeconds(targetSeconds: number): number {
  return Math.max(
    NARRATION_OVERSHOOT_MIN_SECONDS,
    Math.round(targetSeconds * NARRATION_OVERSHOOT_RATIO)
  );
}

export function buildSceneNarrationTimeline(
  scenes: Array<{ order: number; text: string }>,
  totalNarrationDurationSeconds: number
): SceneNarrationTiming[] {
  if (scenes.length === 0 || totalNarrationDurationSeconds <= 0) {
    return [];
  }

  const weighted = scenes.map((scene) => {
    const words = (scene.text.match(/[\p{L}\p{N}'-]+/gu) ?? []).length;
    return {
      scene,
      words: Math.max(1, words),
    };
  });
  const totalWords = weighted.reduce((sum, item) => sum + item.words, 0);

  let elapsedSeconds = 0;
  return weighted.map((item, index) => {
    const proportionalDuration = (totalNarrationDurationSeconds * item.words) / totalWords;
    const durationSeconds =
      index === weighted.length - 1
        ? Math.max(0, totalNarrationDurationSeconds - elapsedSeconds)
        : Math.max(0.25, proportionalDuration);
    const startSeconds = elapsedSeconds;
    const endSeconds = startSeconds + durationSeconds;
    elapsedSeconds = endSeconds;

    return {
      sceneOrder: item.scene.order,
      startSeconds,
      endSeconds:
        index === weighted.length - 1
          ? totalNarrationDurationSeconds
          : Math.min(endSeconds, totalNarrationDurationSeconds),
    };
  });
}

export function buildSubtitleCues(
  scenes: SubtitleScene[],
  timelineDurationSeconds: number,
  sceneTimeline?: SceneNarrationTiming[] | null,
  transcriptWords?: TranscriptWordTiming[] | null,
): SubtitleCue[] {
  if (scenes.length === 0) {
    return [];
  }

  if (transcriptWords && transcriptWords.length > 0) {
    const transcriptCues = buildTranscriptSubtitleCues(
      transcriptWords,
      timelineDurationSeconds,
      null
    );
    if (transcriptCues.length > 0) {
      return transcriptCues;
    }
  }

  const timelineBySceneOrder = new Map(
    (sceneTimeline ?? []).map((timing) => [timing.sceneOrder, timing] as const)
  );
  const sourceDurationSeconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const fallbackScale = sourceDurationSeconds > 0 ? timelineDurationSeconds / sourceDurationSeconds : 1;

  const cues: SubtitleCue[] = [];
  let elapsedSeconds = 0;

  for (const scene of scenes) {
    const explicitTiming = timelineBySceneOrder.get(scene.order);
    const sceneStartSeconds = explicitTiming?.startSeconds ?? elapsedSeconds;
    const sceneEndSeconds =
      explicitTiming?.endSeconds ??
      Math.min(timelineDurationSeconds, elapsedSeconds + scene.durationSeconds * fallbackScale);
    const sceneDurationSeconds = Math.max(0.25, sceneEndSeconds - sceneStartSeconds);
    const sceneCues = buildSceneSubtitleCues(scene.text, sceneDurationSeconds);
    let sceneElapsedSeconds = sceneStartSeconds;

    for (const cue of sceneCues) {
      const cueStartSeconds = sceneElapsedSeconds;
      const cueEndSeconds = Math.min(sceneEndSeconds, cueStartSeconds + cue.durationSeconds);
      cues.push({
        startSeconds: cueStartSeconds,
        endSeconds: Math.max(cueStartSeconds + 0.1, cueEndSeconds),
        text: cue.text,
      });
      sceneElapsedSeconds = cueEndSeconds;
    }

    elapsedSeconds = sceneEndSeconds;
  }

  return cues;
}

function buildTranscriptSubtitleCues(
  transcriptWords: TranscriptWordTiming[],
  timelineDurationSeconds: number,
  dialogueTurnTimeline: null
): SubtitleCue[] {
  const words = transcriptWords
    .filter((word) => word.endSeconds > word.startSeconds)
    .map((word) => ({
      ...word,
      startSeconds: Math.max(0, word.startSeconds),
      endSeconds: Math.min(timelineDurationSeconds, word.endSeconds),
    }))
    .filter((word) => word.endSeconds > word.startSeconds);

  if (words.length === 0) {
    return [];
  }

  const cues: SubtitleCue[] = [];
  let currentChunk: TranscriptWordTiming[] = [];
  let activeTurnOrder: number | null = null;

  for (const word of words) {
    const candidate = [...currentChunk, word];
    const candidateDuration = candidate[candidate.length - 1].endSeconds - candidate[0].startSeconds;
    const candidateLines = wrapSubtitleLines(candidate.map((item) => item.word));
    const nextTurnOrder = null;
    const shouldFlush =
      currentChunk.length > 0 &&
      (candidateDuration > MAX_SUBTITLE_CUE_DURATION_SECONDS ||
        candidateLines.length > MAX_SUBTITLE_LINES ||
        (activeTurnOrder !== null && nextTurnOrder !== null && activeTurnOrder !== nextTurnOrder) ||
        isHardSubtitleBoundary(currentChunk[currentChunk.length - 1], word, candidateDuration));

    if (shouldFlush) {
      const cue = finalizeTranscriptCue(currentChunk);
      if (cue) {
        cues.push(cue);
      }
      currentChunk = [word];
      activeTurnOrder = nextTurnOrder;
      continue;
    }

    currentChunk = candidate;
    activeTurnOrder ??= nextTurnOrder;
  }

  const lastCue = finalizeTranscriptCue(currentChunk);
  if (lastCue) {
    cues.push(lastCue);
  }

  return cues;
}

export function formatSrtTimestamp(totalSeconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000)
    .toString()
    .padStart(2, '0');
  const milliseconds = (totalMilliseconds % 1000).toString().padStart(3, '0');

  return `${hours}:${minutes}:${seconds},${milliseconds}`;
}

function buildSceneSubtitleCues(text: string, durationSeconds: number): SubtitleCueDraft[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ').filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  let cueCount = Math.max(
    1,
    Math.ceil(durationSeconds / MAX_SUBTITLE_CUE_DURATION_SECONDS),
    Math.ceil(words.length / 12)
  );
  cueCount = Math.min(cueCount, words.length);

  let chunks = splitWordsIntoBalancedChunks(words, cueCount);
  while (
    cueCount < words.length &&
    chunks.some((chunk) => wrapSubtitleLines(chunk).length > MAX_SUBTITLE_LINES)
  ) {
    cueCount += 1;
    chunks = splitWordsIntoBalancedChunks(words, cueCount);
  }

  const totalWords = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  let sceneElapsedSeconds = 0;

  return chunks.map((chunk) => {
    const chunkDurationSeconds =
      totalWords > 0 ? durationSeconds * (chunk.length / totalWords) : durationSeconds / chunks.length;
    const startSeconds = sceneElapsedSeconds;
    const endSeconds = startSeconds + chunkDurationSeconds;
    sceneElapsedSeconds = endSeconds;

    return {
      startSeconds,
      endSeconds,
      text: wrapSubtitleLines(chunk).join('\n'),
      durationSeconds: chunkDurationSeconds,
    } as SubtitleCueDraft;
  });
}

function splitWordsIntoBalancedChunks(words: string[], chunkCount: number): string[][] {
  const boundedChunkCount = Math.max(1, Math.min(chunkCount, words.length));
  const baseSize = Math.floor(words.length / boundedChunkCount);
  let remainder = words.length % boundedChunkCount;
  let cursor = 0;

  return Array.from({ length: boundedChunkCount }, () => {
    const size = baseSize + (remainder > 0 ? 1 : 0);
    if (remainder > 0) {
      remainder -= 1;
    }
    const chunkSize = Math.max(1, size);
    const chunk = words.slice(cursor, cursor + chunkSize);
    cursor += chunkSize;
    return chunk;
  }).filter((chunk) => chunk.length > 0);
}

function wrapSubtitleLines(words: string[]): string[] {
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
      continue;
    }

    const candidate = `${currentLine} ${word}`;
    if (candidate.length <= MAX_SUBTITLE_LINE_LENGTH) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > MAX_SUBTITLE_LINES ? lines.slice(0, MAX_SUBTITLE_LINES) : lines;
}

function finalizeTranscriptCue(words: TranscriptWordTiming[]): SubtitleCue | null {
  if (words.length === 0) {
    return null;
  }

  return {
    startSeconds: words[0].startSeconds,
    endSeconds: Math.max(words[0].startSeconds + 0.1, words[words.length - 1].endSeconds),
    text: wrapSubtitleLines(words.map((word) => word.word)).join('\n'),
  };
}

function isHardSubtitleBoundary(
  previousWord: TranscriptWordTiming,
  nextWord: TranscriptWordTiming,
  candidateDuration: number
): boolean {
  if (nextWord.startSeconds - previousWord.endSeconds >= 0.55) {
    return true;
  }

  if (candidateDuration < 1.2) {
    return false;
  }

  return /[.!?,:;]$/.test(previousWord.word);
}
