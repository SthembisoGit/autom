import type { ContentProfile } from '@autom/contracts';

import type { RerankProvider } from '../../../lib/types.js';
import type {
  EvidenceItem,
  NewsTopicContext,
  ProviderTaskResult,
  RankedEvidenceSet,
} from '../../pipeline/types.js';
import { buildSearchQuery } from '../search/tavily-search.js';
import { isAbortError } from '../verification/freshness-check.js';

const COHERE_RERANK_ENDPOINT = 'https://api.cohere.com/v2/rerank';

type CohereRerankResponse = {
  results?: Array<{
    index?: number;
    relevance_score?: number;
  }>;
};

export class CohereRerankProvider implements RerankProvider {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 10_000
  ) {}

  async rankEvidence(input: {
    profile: ContentProfile;
    topic: string;
    newsContext: NewsTopicContext | null;
    evidence: EvidenceItem[];
  }): Promise<ProviderTaskResult<RankedEvidenceSet>> {
    if (input.evidence.length === 0) {
      return {
        provider: 'cohere',
        data: { items: [], degraded: true },
        warnings: ['No evidence available to rerank.'],
        degraded: true,
      };
    }

    let response: Response;
    try {
      response = await fetch(COHERE_RERANK_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'rerank-v3.5',
          query: buildSearchQuery(input.topic, input.newsContext),
          documents: input.evidence.map((item) =>
            [item.title, item.snippet, item.sourceName, item.publishedAt]
              .filter(Boolean)
              .join(' | ')
          ),
          top_n: Math.min(5, input.evidence.length),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Cohere rerank timed out after ${this.timeoutMs}ms.`);
      }

      throw error;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Cohere rerank failed with status ${response.status}.${body ? ` ${body}` : ''}`
      );
    }

    const payload = (await response.json()) as CohereRerankResponse;
    const rankedIndexes = (payload.results ?? [])
      .map((result) => result.index)
      .filter((index): index is number => Number.isInteger(index));

    const rankedItems = rankedIndexes
      .map((index) => input.evidence[index])
      .filter((item): item is EvidenceItem => Boolean(item));

    return {
      provider: 'cohere',
      data: {
        items:
          rankedItems.length > 0
            ? rankedItems
            : heuristicRankEvidence(input.topic, input.newsContext, input.evidence),
        degraded: rankedItems.length === 0,
      },
      warnings:
        rankedItems.length === 0
          ? ['Cohere returned no ranking results; heuristic ranking was used.']
          : [],
      degraded: rankedItems.length === 0,
    };
  }
}

export class HeuristicRerankProvider implements RerankProvider {
  async rankEvidence(input: {
    profile: ContentProfile;
    topic: string;
    newsContext: NewsTopicContext | null;
    evidence: EvidenceItem[];
  }): Promise<ProviderTaskResult<RankedEvidenceSet>> {
    return {
      provider: 'heuristic',
      data: {
        items: heuristicRankEvidence(input.topic, input.newsContext, input.evidence),
        degraded: true,
      },
      warnings:
        input.evidence.length > 0
          ? ['Using heuristic evidence ranking because Cohere is not configured.']
          : [],
      degraded: true,
    };
  }
}

function heuristicRankEvidence(
  topic: string,
  newsContext: NewsTopicContext | null,
  evidence: EvidenceItem[]
): EvidenceItem[] {
  const queryTokens = tokenize(
    [topic, newsContext?.title ?? '', newsContext?.snippet ?? ''].join(' ')
  );
  return [...evidence]
    .sort((left, right) => scoreEvidence(right, queryTokens) - scoreEvidence(left, queryTokens))
    .slice(0, 5);
}

function scoreEvidence(item: EvidenceItem, queryTokens: Set<string>): number {
  const haystack = `${item.title} ${item.snippet ?? ''} ${item.sourceName ?? ''}`.toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += 3;
    }
  }

  if (item.publishedAt) {
    score += 1;
  }

  if (item.trustTier === 'trusted') {
    score += 2;
  }

  if (item.retrievalOrigin === 'news') {
    score += 2;
  }

  return score;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}
