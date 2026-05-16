import type { AssetReference } from '@autom/contracts';

import {
  type SceneNarrationTiming,
  buildSubtitleCues,
  formatSrtTimestamp,
} from '../../lib/content-quality.js';
import type { TranscriptWordTiming } from '../../lib/types.js';

export type SubtitleTrack = {
  srt: string;
  cueCount: number;
  timingSource: 'voice_timeline' | 'scene_duration' | 'groq_word_timestamps';
};

export function buildSrt(
  scenes: Array<{ order: number; text: string; durationSeconds: number }>,
  timelineDurationSeconds: number,
  sceneNarrationTimeline: SceneNarrationTiming[] | null,
  transcriptWords: TranscriptWordTiming[] | null
): SubtitleTrack {
  const normalizedTimeline =
    sceneNarrationTimeline && sceneNarrationTimeline.length > 0 ? sceneNarrationTimeline : null;
  const cues = buildSubtitleCues(
    scenes,
    timelineDurationSeconds,
    normalizedTimeline,
    transcriptWords
  );

  return {
    cueCount: cues.length,
    timingSource: transcriptWords?.length
      ? 'groq_word_timestamps'
      : normalizedTimeline
        ? 'voice_timeline'
        : 'scene_duration',
    srt: cues
      .map((cue, index) => {
        const start = formatSrtTimestamp(cue.startSeconds);
        const end = formatSrtTimestamp(cue.endSeconds);
        return `${index + 1}\n${start} --> ${end}\n${cue.text}\n`;
      })
      .join('\n'),
  };
}

export function buildAssetBundleReferences(
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
      retrievalOrigin: null,
      licenseLabel: null,
      rightsSummary: null,
      attributionRequired: false,
      entityLabel: null,
      matchQuality: null,
      reuseStatus: null,
    },
  ];
}
