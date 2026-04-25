import type { ContentProfile } from '@autom/contracts';

import { buildCategoryQueries } from '../lib/content-strategy.js';
import type { NewsProvider, NewsTopicContext } from '../lib/types.js';

const GOOGLE_NEWS_SEARCH_BASE_URL = 'https://news.google.com/rss/search';
const GOOGLE_NEWS_TOP_BASE_URL = 'https://news.google.com/rss';
const DEFAULT_NEWS_LANGUAGE = 'en-US';
const DEFAULT_NEWS_REGION = 'US';
const DEFAULT_NEWS_CEID = 'US:en';
const MAX_NEWS_QUERY_COUNT = 4;
const MAX_NEWS_ITEMS_PER_QUERY = 8;
const NEWS_FETCH_TIMEOUT_MS = 12_000;

type FetchLike = typeof fetch;

export class GoogleNewsRssProvider implements NewsProvider {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = NEWS_FETCH_TIMEOUT_MS
  ) {}

  async discoverTopic(
    profile: ContentProfile,
    scheduledFor = new Date()
  ): Promise<NewsTopicContext | null> {
    const queries = this.resolveQueries(profile);
    const batches = await Promise.all(
      queries.map(async (query) => await this.fetchQueryItems(query))
    );

    const candidates = dedupeNewsItems(batches.flat()).sort(compareNewsItems);

    if (candidates.length === 0) {
      const topStories = await this.fetchTopStories();
      const filtered = dedupeNewsItems(topStories).sort(compareNewsItems);
      if (filtered.length === 0) {
        return null;
      }

      const fallbackIndex = selectStableIndex(profile.id, scheduledFor.toISOString(), filtered.length);
      return filtered[fallbackIndex] ?? null;
    }

    const index = selectStableIndex(profile.id, scheduledFor.toISOString(), candidates.length);
    return candidates[index] ?? null;
  }

  async resolveContext(profile: ContentProfile, topic: string): Promise<NewsTopicContext | null> {
    const matches = await this.fetchQueryItems(topic);
    const filtered = dedupeNewsItems(matches).sort(compareNewsItems);

    return filtered[0] ?? null;
  }

  private resolveQueries(profile: ContentProfile): string[] {
    return buildCategoryQueries(profile, MAX_NEWS_QUERY_COUNT);
  }

  private async fetchQueryItems(query: string): Promise<NewsTopicContext[]> {
    const searchTerms = `${query} when:1d`;
    const url = new URL(GOOGLE_NEWS_SEARCH_BASE_URL);
    url.searchParams.set('q', searchTerms);
    url.searchParams.set('hl', DEFAULT_NEWS_LANGUAGE);
    url.searchParams.set('gl', DEFAULT_NEWS_REGION);
    url.searchParams.set('ceid', DEFAULT_NEWS_CEID);

    return await this.fetchFeed(url.toString(), query);
  }

  private async fetchTopStories(): Promise<NewsTopicContext[]> {
    const url = new URL(GOOGLE_NEWS_TOP_BASE_URL);
    url.searchParams.set('hl', DEFAULT_NEWS_LANGUAGE);
    url.searchParams.set('gl', DEFAULT_NEWS_REGION);
    url.searchParams.set('ceid', DEFAULT_NEWS_CEID);
    return await this.fetchFeed(url.toString(), 'top stories');
  }

  private async fetchFeed(url: string, query: string): Promise<NewsTopicContext[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          'User-Agent': 'autoM/1.0',
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`News feed request timed out after ${this.timeoutMs}ms.`);
      }

      throw error;
    }

    if (!response.ok) {
      throw new Error(`News feed request failed with status ${response.status}.`);
    }

    const xml = await response.text();
    return parseGoogleNewsRss(xml, query).slice(0, MAX_NEWS_ITEMS_PER_QUERY);
  }
}

export function createNewsProvider(): NewsProvider {
  return new GoogleNewsRssProvider();
}

function parseGoogleNewsRss(xml: string, query: string): NewsTopicContext[] {
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  const items: NewsTopicContext[] = [];

  for (const match of itemMatches) {
    const itemXml = match[1] ?? '';
    const titleValue = decodeHtmlEntities(stripCdata(extractTag(itemXml, 'title') ?? '').trim());
    if (titleValue.length === 0) {
      continue;
    }

    const { headline, sourceName } = splitHeadlineAndSource(titleValue);
    const snippet = decodeHtmlEntities(
      stripHtml(stripCdata(extractTag(itemXml, 'description') ?? '').trim())
    );
    const sourceUrl = decodeHtmlEntities(stripCdata(extractTag(itemXml, 'link') ?? '').trim()) || null;
    const publishedAt = normalizePublishedAt(extractTag(itemXml, 'pubDate'));

    items.push({
      title: headline,
      sourceName,
      sourceUrl,
      publishedAt,
      snippet: snippet.length > 0 ? snippet : null,
      query,
    });
  }

  return items;
}

function extractTag(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match?.[1]?.trim() ?? null;
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}

function splitHeadlineAndSource(value: string): {
  headline: string;
  sourceName: string | null;
} {
  const separatorIndex = value.lastIndexOf(' - ');
  if (separatorIndex <= 0) {
    return {
      headline: value,
      sourceName: null,
    };
  }

  return {
    headline: value.slice(0, separatorIndex).trim(),
    sourceName: value.slice(separatorIndex + 3).trim() || null,
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function normalizePublishedAt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function dedupeNewsItems(items: NewsTopicContext[]): NewsTopicContext[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function compareNewsItems(left: NewsTopicContext, right: NewsTopicContext): number {
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
  return rightTime - leftTime;
}

function selectStableIndex(profileId: string, seedValue: string, length: number): number {
  const seed = `${profileId}:${seedValue}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash) % Math.max(1, length);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
