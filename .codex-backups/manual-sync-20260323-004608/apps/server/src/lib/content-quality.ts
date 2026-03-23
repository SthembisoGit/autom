type SubtitleScene = {
  text: string;
  durationSeconds: number;
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

export function buildSubtitleCues(
  scenes: SubtitleScene[],
  timelineDurationSeconds: number
): SubtitleCue[] {
  if (scenes.length === 0) {
    return [];
  }

  const sourceDurationSeconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const durationScale =
    sourceDurationSeconds > 0 ? timelineDurationSeconds / sourceDurationSeconds : 1;

  const cues: SubtitleCue[] = [];
  let elapsedSeconds = 0;

  for (const scene of scenes) {
    const sceneDurationSeconds = Math.max(0.5, scene.durationSeconds * durationScale);
    const sceneCues = buildSceneSubtitleCues(scene.text, sceneDurationSeconds);
    let sceneElapsedSeconds = elapsedSeconds;

    for (const cue of sceneCues) {
      cues.push({
        startSeconds: sceneElapsedSeconds,
        endSeconds: sceneElapsedSeconds + cue.durationSeconds,
        text: cue.text,
      });
      sceneElapsedSeconds += cue.durationSeconds;
    }

    elapsedSeconds += sceneDurationSeconds;
  }

  return cues;
}

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
