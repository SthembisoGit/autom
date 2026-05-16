import type { VisualSceneKind } from '../pipeline/types.js';

export function isExactVisualMatchRequired(sceneKind: VisualSceneKind): boolean {
  return (
    sceneKind === 'recent_news' ||
    sceneKind === 'named_person_or_event' ||
    sceneKind === 'historical_topic'
  );
}
