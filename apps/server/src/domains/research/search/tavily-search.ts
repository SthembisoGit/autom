import type { ContentProfile } from '@autom/contracts';

import type { SearchProvider } from '../../../lib/types.js';
import type { EvidenceItem, NewsTopicContext, ProviderTaskResult } from '../../pipeline/types.js';
import { mergeNewsContextEvidence } from '../verification/evidence-quality.js';
import { isAbortError, normalizePublishedDate } from '../verification/freshness-check.js';

const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
  }>;
};

export class TavilySearchProvider implements SearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 12_000
  ) {}

  async collectEvidence(input: {
    profile: ContentProfile;
    topic: string;
    newsContext: NewsTopicContext | null;
  }): Promise<ProviderTaskResult<EvidenceItem[]>> {
    const query = buildSearchQuery(input.topic, input.newsContext);
    let response: Response;

    try {
      response = await fetch(TAVILY_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: 'basic',
          max_results: 6,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Tavily search timed out after ${this.timeoutMs}ms.`);
      }

      throw error;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Tavily search failed with status ${response.status}.${body ? ` ${body}` : ''}`
      );
    }

    const payload = (await response.json()) as TavilyResponse;
    const evidence = (payload.results ?? [])
      .map((item) => normalizeTavilyResult(item, query))
      .filter((item): item is EvidenceItem => item !== null);

    return {
      provider: 'tavily',
      data: mergeNewsContextEvidence(input.newsContext, evidence),
      warnings:
        evidence.length === 0
          ? ['Tavily returned no evidence; downstream steps will degrade.']
          : [],
    };
  }
}

export function buildSearchQuery(topic: string, newsContext: NewsTopicContext | null): string {
  if (newsContext) {
    return `${newsContext.title} ${newsContext.sourceName ?? ''}`.trim();
  }

  return topic;
}

function normalizeTavilyResult(
  item: { title?: string; url?: string; content?: string; published_date?: string },
  query: string
): EvidenceItem | null {
  if (!item.title?.trim()) {
    return null;
  }

  return {
    title: item.title.trim(),
    sourceUrl: item.url?.trim() || null,
    sourceName: tryReadHostname(item.url) ?? null,
    publishedAt: normalizePublishedDate(item.published_date),
    snippet: item.content?.trim() || null,
    query,
    trustTier: 'trusted',
    retrievalOrigin: 'research',
  };
}

function tryReadHostname(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
