import type { ContentProfile } from '@autom/contracts';

import type { SearchProvider } from '../../../lib/types.js';
import type { EvidenceItem, NewsTopicContext, ProviderTaskResult } from '../../pipeline/types.js';
import { buildFallbackEvidence } from '../verification/evidence-quality.js';

export class FallbackSearchProvider implements SearchProvider {
  async collectEvidence(input: {
    profile: ContentProfile;
    topic: string;
    newsContext: NewsTopicContext | null;
  }): Promise<ProviderTaskResult<EvidenceItem[]>> {
    const evidence = buildFallbackEvidence(input.topic, input.newsContext, input.profile);
    return {
      provider: input.newsContext ? 'news' : 'none',
      data: evidence,
      warnings:
        evidence.length === 0
          ? [
              'No live search provider configured, and no trusted evidence was available for this topic.',
            ]
          : ['Using fallback evidence because Tavily is not configured.'],
      degraded: true,
    };
  }
}
