export { createVisualProvider } from '../../providers/pexels-provider.js';
export { CompositeVisualProvider, LocalVisualProvider } from './visual-selection-service.js';
export { GoogleNewsContextVisualProvider } from './providers/news-context-provider.js';
export { PexelsVisualProvider } from './providers/pexels-provider.js';
export { PixabayVisualProvider } from './providers/pixabay-provider.js';
export { UnsplashPhotoProvider } from './providers/unsplash-provider.js';
export { WikimediaCommonsProvider } from './providers/wikimedia-provider.js';
export { isExactVisualMatchRequired } from './visual-coverage.js';
export {
  buildCandidateReuseKey,
  chooseBestVisualCandidate,
  hasExactEntityMatch,
  matchTerms,
  scoreVisualCandidate,
} from './visual-ranking.js';
export {
  buildVisualScenePlan,
  classifySceneKind,
  extractCapitalizedEntities,
} from './visual-source-planner.js';
