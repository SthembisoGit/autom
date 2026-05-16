import type { ContentCategory } from '@autom/contracts';

import type { MonetizationScore, NewsTopicContext } from '../pipeline/types.js';
import { scoreCountryTargets } from './country-priority.js';

export function buildMonetizationScore(
  category: ContentCategory | null,
  newsContext: NewsTopicContext | null,
  evidenceCount: number,
  exactEvidenceRequired: boolean
): MonetizationScore {
  const countryFit = category ? scoreCountryTargets(category.countryTargets) : 8;
  const advertiserFriendly =
    category?.goal === 'revenue' ? 22 : category?.goal === 'hybrid' ? 18 : 12;
  const retentionPotential = newsContext
    ? 24
    : category?.contentTypeBias === 'historical_topic'
      ? 18
      : 16;
  const evidenceStrength = Math.min(18, evidenceCount * 4);
  const visualAvailability = exactEvidenceRequired ? 12 : 16;
  const platformFit =
    category?.platformFit === 'youtube' ? 12 : category?.platformFit === 'meta' ? 22 : 20;

  return {
    advertiserFriendly,
    countryFit,
    retentionPotential,
    evidenceStrength,
    visualAvailability,
    platformFit,
    total: Math.min(
      100,
      advertiserFriendly +
        countryFit +
        retentionPotential +
        evidenceStrength +
        visualAvailability +
        platformFit
    ),
  };
}
