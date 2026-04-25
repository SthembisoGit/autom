import type { AppEnv } from '@autom/config';
import type { ContentProfile } from '@autom/contracts';

import {
  buildMonetizationScore,
  buildStoryAngle,
  buildTopicSelectionSeed,
  chooseCategory,
} from '../lib/content-strategy.js';
import type {
  ContentBrief,
  EvidenceItem,
  NewsProvider,
  NewsTopicContext,
  ProviderTaskResult,
  RankedEvidenceSet,
  RerankProvider,
  SearchProvider,
} from '../lib/types.js';

const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';
const COHERE_RERANK_ENDPOINT = 'https://api.cohere.com/v2/rerank';

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
  }>;
};

type CohereRerankResponse = {
  results?: Array<{
    index?: number;
    relevance_score?: number;
  }>;
};

export class ContentOrchestrator {
  constructor(
    private readonly newsProvider: NewsProvider | undefined,
    private readonly searchProvider: SearchProvider,
    private readonly rerankProvider: RerankProvider
  ) {}

  async buildBrief(profile: ContentProfile, topic: string): Promise<ContentBrief> {
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

    const warnings = [...searchResult.warnings, ...rerankResult.warnings];
    const verificationStatus =
      rerankResult.data.items.length === 0
        ? 'unverified'
        : searchResult.provider === 'tavily' && rerankResult.provider === 'cohere' && !rerankResult.data.degraded
          ? 'verified'
          : 'degraded';

    const keyEntities = extractKeyEntities([
      topic,
      newsContext?.title ?? '',
      ...rerankResult.data.items.map((item) => item.title),
    ]);

    const category = chooseCategory(
      profile,
      `${buildTopicSelectionSeed(profile, new Date())}:${topic}:${newsContext?.title ?? ''}`
    );
    const contentType = inferContentType(profile, topic, newsContext, keyEntities, category);
    const exactEvidenceRequired = isExactEvidenceRequired(contentType);
    const monetizationScore = buildMonetizationScore(
      category,
      newsContext,
      rerankResult.data.items.length,
      exactEvidenceRequired
    );
    const storyAngle = buildStoryAngle(
      topic,
      category,
      contentType,
      rerankResult.data.items.map((item) => item.title),
      newsContext
    );

    return {
      topic,
      category,
      contentType,
      angle: buildAngle(topic, newsContext, rerankResult.data.items, storyAngle),
      factualClaims: buildFactualClaims(newsContext, rerankResult.data.items),
      allowedSources: Array.from(
        new Set(
          rerankResult.data.items
            .map((item) => item.sourceName || tryReadHostname(item.sourceUrl))
            .filter((value): value is string => Boolean(value))
        )
      ),
      keyEntities,
      desiredVisuals: buildDesiredVisuals(topic, newsContext, keyEntities),
      toneGuidance: buildToneGuidance(profile, newsContext, category, storyAngle),
      evidence: rerankResult.data,
      monetizationScore,
      storyAngle,
      topicCandidate: category
        ? {
            title: topic,
            categoryId: category.id,
            categoryLabel: category.label,
            timeliness: newsContext ? 30 : 10,
            platformFit: monetizationScore.platformFit,
            countryFit: monetizationScore.countryFit,
            evidenceStrength: monetizationScore.evidenceStrength,
            visualAvailability: monetizationScore.visualAvailability,
            monetizationScore: monetizationScore.total,
            reasoning: category.topicGenerationRules,
          }
        : null,
      verificationStatus,
      exactEvidenceRequired,
      searchProvider: normalizeSearchProvider(searchResult.provider),
      rerankProvider: normalizeRerankProvider(rerankResult.provider),
      warnings,
    };
  }
}

export class TavilySearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string, private readonly timeoutMs = 12_000) {}

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
      throw new Error(`Tavily search failed with status ${response.status}.${body ? ` ${body}` : ''}`);
    }

    const payload = (await response.json()) as TavilyResponse;
    const evidence = (payload.results ?? [])
      .map((item) => normalizeTavilyResult(item, query))
      .filter((item): item is EvidenceItem => item !== null);

    return {
      provider: 'tavily',
      data: mergeNewsContextEvidence(input.newsContext, evidence),
      warnings: evidence.length === 0 ? ['Tavily returned no evidence; downstream steps will degrade.'] : [],
    };
  }
}

export class FallbackSearchProvider implements SearchProvider {
  async collectEvidence(input: {
    profile: ContentProfile;
    topic: string;
    newsContext: NewsTopicContext | null;
  }): Promise<ProviderTaskResult<EvidenceItem[]>> {
    const contentType = inferContentType(
      input.profile,
      input.topic,
      input.newsContext,
      extractKeyEntities([input.topic, input.newsContext?.title ?? '']),
      null
    );
    const evidence = buildFallbackEvidence(input.topic, input.newsContext, contentType);
    return {
      provider: input.newsContext ? 'news' : 'none',
      data: evidence,
      warnings:
        evidence.length === 0
          ? ['No live search provider configured, and no trusted evidence was available for this topic.']
          : ['Using fallback evidence because Tavily is not configured.'],
      degraded: true,
    };
  }
}

export class CohereRerankProvider implements RerankProvider {
  constructor(private readonly apiKey: string, private readonly timeoutMs = 10_000) {}

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
            [item.title, item.snippet, item.sourceName, item.publishedAt].filter(Boolean).join(' | ')
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
      throw new Error(`Cohere rerank failed with status ${response.status}.${body ? ` ${body}` : ''}`);
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
        items: rankedItems.length > 0 ? rankedItems : heuristicRankEvidence(input.topic, input.newsContext, input.evidence),
        degraded: rankedItems.length === 0,
      },
      warnings: rankedItems.length === 0 ? ['Cohere returned no ranking results; heuristic ranking was used.'] : [],
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
      warnings: input.evidence.length > 0 ? ['Using heuristic evidence ranking because Cohere is not configured.'] : [],
      degraded: true,
    };
  }
}

export function createContentOrchestrator(
  env: AppEnv,
  newsProvider?: NewsProvider
): ContentOrchestrator {
  const searchProvider = env.TAVILY_API_KEY
    ? new TavilySearchProvider(env.TAVILY_API_KEY)
    : new FallbackSearchProvider();
  const rerankProvider = env.COHERE_API_KEY
    ? new CohereRerankProvider(env.COHERE_API_KEY)
    : new HeuristicRerankProvider();

  return new ContentOrchestrator(newsProvider, searchProvider, rerankProvider);
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

function mergeNewsContextEvidence(
  newsContext: NewsTopicContext | null,
  evidence: EvidenceItem[]
): EvidenceItem[] {
  if (!newsContext) {
    return evidence;
  }

  return [buildEvidenceFromNewsContext(newsContext), ...evidence].slice(0, 8);
}

function buildFallbackEvidence(
  topic: string,
  newsContext: NewsTopicContext | null,
  contentType: ContentBrief['contentType']
): EvidenceItem[] {
  if (newsContext) {
    return [buildEvidenceFromNewsContext(newsContext)];
  }

  if (isExactEvidenceRequired(contentType)) {
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
    publishedAt: normalizeDate(item.published_date),
    snippet: item.content?.trim() || null,
    query,
    trustTier: 'trusted',
    retrievalOrigin: 'research',
  };
}

function heuristicRankEvidence(
  topic: string,
  newsContext: NewsTopicContext | null,
  evidence: EvidenceItem[]
): EvidenceItem[] {
  const queryTokens = tokenize([topic, newsContext?.title ?? '', newsContext?.snippet ?? ''].join(' '));
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

function inferContentType(
  profile: ContentProfile,
  topic: string,
  newsContext: NewsTopicContext | null,
  keyEntities: string[],
  category: ContentBrief['category']
): ContentBrief['contentType'] {
  if (newsContext) {
    return 'recent_news';
  }

  if (category && category.contentTypeBias !== 'mixed') {
    return category.contentTypeBias;
  }

  if (/\b(today|latest|breaking|update|announced|commission|election|minister|court|shares|earnings|tariff|outage|deal)\b/i.test(topic)) {
    return 'recent_news';
  }

  if (/\btool|software|app|platform|crm|dashboard|automation|workflow|seo\b/i.test(topic)) {
    return 'product_or_tool_demo';
  }

  if (keyEntities.length > 0 && /\b(history|historical|legacy|president|mandela|war|empire)\b/i.test(topic)) {
    return 'historical_topic';
  }

  if (keyEntities.length > 0) {
    return 'named_person_or_event';
  }

  return 'generic_business_or_lifestyle';
}

function isExactEvidenceRequired(contentType: ContentBrief['contentType']): boolean {
  return (
    contentType === 'recent_news' ||
    contentType === 'named_person_or_event' ||
    contentType === 'historical_topic'
  );
}

function buildAngle(
  topic: string,
  newsContext: NewsTopicContext | null,
  evidence: EvidenceItem[],
  storyAngle: ContentBrief['storyAngle']
): string {
  const anchor = evidence[0]?.title ?? newsContext?.title ?? topic;
  if (storyAngle) {
    return `${storyAngle.coreHook} ${storyAngle.highStakesAngle} ${storyAngle.twistOrPayoff}`;
  }

  if (newsContext) {
    return `Explain the latest development around "${anchor}" in plain language and why it matters now.`;
  }

  return `Turn "${anchor}" into a practical, specific explainer with one clear use case and one real takeaway.`;
}

function buildFactualClaims(newsContext: NewsTopicContext | null, evidence: EvidenceItem[]): string[] {
  const claims = evidence
    .slice(0, 4)
    .map((item) => [item.title, item.snippet].filter(Boolean).join(': '))
    .filter((item) => item.length > 0);

  if (newsContext && claims.length === 0) {
    claims.push(newsContext.title);
  }

  return claims;
}

function buildDesiredVisuals(
  topic: string,
  newsContext: NewsTopicContext | null,
  entities: string[]
): string[] {
  return Array.from(new Set([topic, newsContext?.title ?? '', ...entities].filter(Boolean))).slice(0, 6);
}

function buildToneGuidance(
  profile: ContentProfile,
  newsContext: NewsTopicContext | null,
  category: ContentBrief['category'],
  storyAngle: ContentBrief['storyAngle']
): string[] {
  const guidance = [
    `Keep the tone aligned with ${profile.tone}.`,
    'Use short, spoken sentences and avoid robotic transitions.',
    'Start with a strong hook instead of a slow generic introduction.',
    'Build scene-to-scene escalation so each beat adds a fresh angle, proof point, or payoff.',
    'Avoid template explainer filler that could fit any topic.',
  ];

  if (category) {
    guidance.push(`Aim for ${category.platformFit}-first packaging with strong hold in the first 10 to 20 seconds.`);
  }

  if (storyAngle) {
    guidance.push(`Core hook: ${storyAngle.coreHook}`);
    guidance.push(`Curiosity gap: ${storyAngle.curiosityGap}`);
    guidance.push(`Concrete implication: ${storyAngle.concreteImplication}`);
  }

  if (profile.contentMode === 'dialogue') {
    guidance.push('Let one host explain while the other host reacts or asks clarifying questions.');
    guidance.push('Use natural filler words sparingly, not in every turn.');
  }

  if (newsContext) {
    guidance.push('Keep opinions clearly framed as reactions, not facts.');
    guidance.push('Do not invent details that are not supported by the evidence list.');
  }

  return guidance;
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

function buildSearchQuery(topic: string, newsContext: NewsTopicContext | null): string {
  if (newsContext) {
    return `${newsContext.title} ${newsContext.sourceName ?? ''}`.trim();
  }

  return topic;
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

function normalizeDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
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

function normalizeSearchProvider(provider: string): ContentBrief['searchProvider'] {
  if (provider === 'tavily') {
    return 'tavily';
  }

  if (provider === 'news') {
    return 'news';
  }

  return 'none';
}

function normalizeRerankProvider(provider: string): ContentBrief['rerankProvider'] {
  if (provider === 'cohere') {
    return 'cohere';
  }

  if (provider === 'heuristic') {
    return 'heuristic';
  }

  return 'none';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
