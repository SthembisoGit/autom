import type { ContentProfile } from '@autom/contracts';

import type {
  ContentBrief,
  EvidenceItem,
  NewsTopicContext,
  ProviderTaskResult,
  RankedEvidenceSet,
} from '../../pipeline/types.js';

export function resolveVerificationStatus(
  searchResult: ProviderTaskResult<EvidenceItem[]>,
  rerankResult: ProviderTaskResult<RankedEvidenceSet>
): ContentBrief['verificationStatus'] {
  if (rerankResult.data.items.length === 0) {
    return 'unverified';
  }

  if (
    searchResult.provider === 'tavily' &&
    rerankResult.provider === 'cohere' &&
    !rerankResult.data.degraded
  ) {
    return 'verified';
  }

  return 'degraded';
}

export function normalizeSearchProvider(provider: string): ContentBrief['searchProvider'] {
  if (provider === 'tavily') {
    return 'tavily';
  }

  if (provider === 'news') {
    return 'news';
  }

  return 'none';
}

export function normalizeRerankProvider(provider: string): ContentBrief['rerankProvider'] {
  if (provider === 'cohere') {
    return 'cohere';
  }

  if (provider === 'heuristic') {
    return 'heuristic';
  }

  return 'none';
}

export function mergeNewsContextEvidence(
  newsContext: NewsTopicContext | null,
  evidence: EvidenceItem[]
): EvidenceItem[] {
  if (!newsContext) {
    return evidence;
  }

  return [buildEvidenceFromNewsContext(newsContext), ...evidence].slice(0, 8);
}

export function buildFallbackEvidence(
  topic: string,
  newsContext: NewsTopicContext | null,
  profile: ContentProfile
): EvidenceItem[] {
  if (newsContext) {
    return [buildEvidenceFromNewsContext(newsContext)];
  }

  if (isExactEvidenceRequired(inferFallbackContentType(profile, topic, newsContext))) {
    return [];
  }

  return [
    {
      title: topic,
      sourceUrl: null,
      sourceName: null,
      publishedAt: null,
      snippet: `General evergreen context for ${topic}.`,
      query: topic,
      trustTier: 'fallback',
      retrievalOrigin: 'research',
    },
  ];
}

function buildEvidenceFromNewsContext(newsContext: NewsTopicContext): EvidenceItem {
  return {
    title: newsContext.title,
    sourceUrl: newsContext.sourceUrl,
    sourceName: newsContext.sourceName,
    publishedAt: newsContext.publishedAt,
    snippet: newsContext.snippet,
    query: newsContext.query,
    trustTier: 'trusted',
    retrievalOrigin: 'news',
  };
}

function inferFallbackContentType(
  profile: ContentProfile,
  topic: string,
  newsContext: NewsTopicContext | null
): ContentBrief['contentType'] {
  const keyEntities = extractKeyEntities([topic, newsContext?.title ?? '']);

  if (newsContext) {
    return 'recent_news';
  }

  if (
    /\b(today|latest|breaking|update|announced|commission|election|minister|court|shares|earnings|tariff|outage|deal)\b/i.test(
      topic
    )
  ) {
    return 'recent_news';
  }

  if (/\btool|software|app|platform|crm|dashboard|automation|workflow|seo\b/i.test(topic)) {
    return 'product_or_tool_demo';
  }

  if (
    keyEntities.length > 0 &&
    /\b(history|historical|legacy|president|mandela|war|empire)\b/i.test(topic)
  ) {
    return 'historical_topic';
  }

  if (keyEntities.length > 0) {
    return 'named_person_or_event';
  }

  return profile.topicSource === 'daily_news' ? 'recent_news' : 'generic_business_or_lifestyle';
}

function isExactEvidenceRequired(contentType: ContentBrief['contentType']): boolean {
  return (
    contentType === 'recent_news' ||
    contentType === 'named_person_or_event' ||
    contentType === 'historical_topic'
  );
}

function extractKeyEntities(values: string[]): string[] {
  const seen = new Set<string>();
  const entities: string[] = [];

  for (const value of values) {
    const matches = value.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g) ?? [];
    for (const match of matches) {
      const normalized = match.trim();
      if (normalized.length < 3 || seen.has(normalized.toLowerCase())) {
        continue;
      }

      seen.add(normalized.toLowerCase());
      entities.push(normalized);
    }
  }

  return entities.slice(0, 6);
}
