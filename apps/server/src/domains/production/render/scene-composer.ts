import type { SceneSpec } from '@autom/contracts';

import type { SceneNarrationTiming } from '../../../lib/content-quality.js';

export type ResolvedSceneTiming = {
  sceneOrder: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

export function scaleSceneTimeline(
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

export function resolveSceneTimings(
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
