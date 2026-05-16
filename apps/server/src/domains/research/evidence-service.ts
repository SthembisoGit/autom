import type { AppEnv } from '@autom/config';
import type { ContentProfile } from '@autom/contracts';

import type { NewsProvider, RerankProvider, SearchProvider } from '../../lib/types.js';
import type {
  ContentBrief,
  EvidenceItem,
  NewsTopicContext,
  ProviderTaskResult,
  RankedEvidenceSet,
} from '../pipeline/types.js';
import { CohereRerankProvider, HeuristicRerankProvider } from './rerank/cohere-rerank.js';
import { FallbackSearchProvider } from './search/fallback-search.js';
import { TavilySearchProvider } from './search/tavily-search.js';
import {
  normalizeRerankProvider,
  normalizeSearchProvider,
  resolveVerificationStatus,
} from './verification/evidence-quality.js';

export type ResearchEvidenceResult = {
  newsContext: NewsTopicContext | null;
  evidence: RankedEvidenceSet;
  verificationStatus: ContentBrief['verificationStatus'];
  searchProvider: ContentBrief['searchProvider'];
  rerankProvider: ContentBrief['rerankProvider'];
  warnings: string[];
};

export class ResearchEvidenceService {
  constructor(
    private readonly newsProvider: NewsProvider | undefined,
    private readonly searchProvider: SearchProvider,
    private readonly rerankProvider: RerankProvider
  ) {}

  getSearchProvider(): SearchProvider {
    return this.searchProvider;
  }

  getRerankProvider(): RerankProvider {
    return this.rerankProvider;
  }

  getNewsProvider(): NewsProvider | undefined {
    return this.newsProvider;
  }

  async collect(profile: ContentProfile, topic: string): Promise<ResearchEvidenceResult> {
    const newsContext = await resolveNewsContext(this.newsProvider, profile, topic);
    const searchResult = await this.searchProvider.collectEvidence({
      profile,
      topic,
      newsContext,
    });
    const rerankResult = await this.rerankProvider.rankEvidence({
      profile,
      topic,
      newsContext,
      evidence: searchResult.data,
    });

    return {
      newsContext,
      evidence: rerankResult.data,
      verificationStatus: resolveVerificationStatus(searchResult, rerankResult),
      searchProvider: normalizeSearchProvider(searchResult.provider),
      rerankProvider: normalizeRerankProvider(rerankResult.provider),
      warnings: [...searchResult.warnings, ...rerankResult.warnings],
    };
  }
}

export {
  CohereRerankProvider,
  FallbackSearchProvider,
  HeuristicRerankProvider,
  TavilySearchProvider,
};

export function createResearchEvidenceService(
  env: AppEnv,
  newsProvider?: NewsProvider
): ResearchEvidenceService {
  const searchProvider = env.TAVILY_API_KEY
    ? new TavilySearchProvider(env.TAVILY_API_KEY)
    : new FallbackSearchProvider();
  const rerankProvider = env.COHERE_API_KEY
    ? new CohereRerankProvider(env.COHERE_API_KEY)
    : new HeuristicRerankProvider();

  return new ResearchEvidenceService(newsProvider, searchProvider, rerankProvider);
}

async function resolveNewsContext(
  newsProvider: NewsProvider | undefined,
  profile: ContentProfile,
  topic: string
): Promise<NewsTopicContext | null> {
  if (!newsProvider || profile.topicSource !== 'daily_news') {
    return null;
  }

  try {
    return await newsProvider.resolveContext(profile, topic);
  } catch {
    return null;
  }
}
