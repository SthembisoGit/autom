import type { ContentCategory, ContentProfile } from '@autom/contracts';

import type { ContentBrief, MonetizationScore, NewsTopicContext, StoryAngle, TopicCandidate } from './types.js';

const PRIMARY_COUNTRY_SET = new Set(['US', 'UK', 'CA', 'AU']);
const SECONDARY_COUNTRY_SET = new Set(['DE', 'IE', 'NL', 'NZ', 'SG']);

export function getEnabledCategories(profile: ContentProfile): ContentCategory[] {
  return profile.contentCategories.filter((category) => category.enabled);
}

export function chooseCategory(profile: ContentProfile, seedValue: string): ContentCategory | null {
  const categories = getEnabledCategories(profile);
  if (categories.length === 0) {
    return null;
  }

  const scored = categories
    .map((category) => ({
      category,
      score: scoreCategory(category) + stableSeedBonus(`${seedValue}:${category.id}`),
    }))
    .sort((left, right) => right.score - left.score);

  return scored[0]?.category ?? categories[0] ?? null;
}

export function scoreCategory(category: ContentCategory): number {
  const goalWeight =
    category.goal === 'revenue' ? 36 : category.goal === 'hybrid' ? 26 : category.goal === 'reach' ? 20 : 16;
  const platformWeight =
    category.platformFit === 'meta' ? 26 : category.platformFit === 'both' ? 24 : 12;
  const countryWeight = Math.min(22, scoreCountryTargets(category.countryTargets));
  const longformWeight = category.lengthStrategy.longformEligible ? 6 : 0;
  const newsBiasWeight =
    category.contentTypeBias === 'recent_news' || category.contentTypeBias === 'product_or_tool_demo'
      ? 10
      : category.contentTypeBias === 'historical_topic'
        ? 4
        : 8;

  return goalWeight + platformWeight + countryWeight + longformWeight + newsBiasWeight;
}

export function buildCategoryQueries(profile: ContentProfile, limit = 4): string[] {
  const categories = getEnabledCategories(profile).sort((left, right) => scoreCategory(right) - scoreCategory(left));
  const queries = new Set<string>();

  for (const category of categories) {
    for (const lens of category.searchLenses) {
      if (queries.size >= limit) {
        break;
      }
      queries.add(lens);
    }
    if (queries.size >= limit) {
      break;
    }
  }

  if (queries.size === 0) {
    queries.add(profile.niche);
  }

  return Array.from(queries);
}

export function buildCategoryTopicCandidates(
  profile: ContentProfile,
  category: ContentCategory | null,
  newsContext: NewsTopicContext | null,
  scheduledForSeed: string
): TopicCandidate[] {
  const activeCategory = category ?? chooseCategory(profile, scheduledForSeed);
  if (!activeCategory) {
    return [];
  }

  const candidates: TopicCandidate[] = [];
  if (newsContext) {
    candidates.push({
      title: newsContext.title,
      categoryId: activeCategory.id,
      categoryLabel: activeCategory.label,
      timeliness: 30,
      platformFit: activeCategory.platformFit === 'youtube' ? 10 : 24,
      countryFit: scoreCountryTargets(activeCategory.countryTargets),
      evidenceStrength: 20,
      visualAvailability: 16,
      monetizationScore: 0,
      reasoning: `${activeCategory.label} matched a current source-backed story.`,
    });
  }

  for (const exampleTopic of activeCategory.exampleTopics) {
    candidates.push({
      title: `${exampleTopic}`,
      categoryId: activeCategory.id,
      categoryLabel: activeCategory.label,
      timeliness: activeCategory.contentTypeBias === 'recent_news' ? 18 : 8,
      platformFit: activeCategory.platformFit === 'youtube' ? 12 : 22,
      countryFit: scoreCountryTargets(activeCategory.countryTargets),
      evidenceStrength: activeCategory.contentTypeBias === 'generic_business_or_lifestyle' ? 10 : 14,
      visualAvailability: activeCategory.contentTypeBias === 'historical_topic' ? 12 : 16,
      monetizationScore: 0,
      reasoning: `${activeCategory.label} evergreen topic seed.`,
    });
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      monetizationScore:
        candidate.timeliness +
        candidate.platformFit +
        candidate.countryFit +
        candidate.evidenceStrength +
        candidate.visualAvailability,
    }))
    .sort((left, right) => right.monetizationScore - left.monetizationScore);
}

export function chooseTopicCandidate(candidates: TopicCandidate[]): TopicCandidate | null {
  return candidates[0] ?? null;
}

export function buildMonetizationScore(
  category: ContentCategory | null,
  newsContext: NewsTopicContext | null,
  evidenceCount: number,
  exactEvidenceRequired: boolean
): MonetizationScore {
  const countryFit = category ? scoreCountryTargets(category.countryTargets) : 8;
  const advertiserFriendly = category?.goal === 'revenue' ? 22 : category?.goal === 'hybrid' ? 18 : 12;
  const retentionPotential = newsContext ? 24 : category?.contentTypeBias === 'historical_topic' ? 18 : 16;
  const evidenceStrength = Math.min(18, evidenceCount * 4);
  const visualAvailability = exactEvidenceRequired ? 12 : 16;
  const platformFit = category?.platformFit === 'youtube' ? 12 : category?.platformFit === 'meta' ? 22 : 20;

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

export function buildStoryAngle(
  topic: string,
  category: ContentCategory | null,
  contentType: ContentBrief['contentType'],
  evidenceTitles: string[],
  newsContext: NewsTopicContext | null
): StoryAngle {
  const anchor = evidenceTitles[0] ?? newsContext?.title ?? topic;
  const hookStyle =
    contentType === 'recent_news'
      ? 'fast-breaking explainer'
      : contentType === 'historical_topic'
        ? 'surprising reveal'
        : contentType === 'product_or_tool_demo'
          ? 'practical payoff'
          : 'curiosity-led explainer';

  return {
    coreHook:
      contentType === 'recent_news'
        ? `Here is what actually changed in ${anchor}, and why people are suddenly paying attention.`
        : `The interesting part of ${anchor} is not the obvious headline. It is the part most people miss.`,
    curiosityGap:
      category?.goal === 'revenue'
        ? 'Show the money, market, or work consequence before the full explanation lands.'
        : 'Show the hidden consequence before resolving the story.',
    highStakesAngle:
      contentType === 'recent_news'
        ? 'Frame what changes next for regular people, businesses, or markets.'
        : 'Frame the decision, reveal, or tradeoff that changes how the topic is understood.',
    concreteImplication:
      contentType === 'product_or_tool_demo'
        ? 'Show exactly what improves in a workflow, tool decision, or daily process.'
        : 'Translate the topic into one specific real-world implication.',
    twistOrPayoff:
      contentType === 'historical_topic'
        ? 'Deliver the unexpected historical consequence or misunderstood turning point.'
        : 'Deliver a contrast, payoff, or clean takeaway that feels earned.',
    visualMoments: [topic, anchor, ...(category?.searchLenses.slice(0, 2) ?? [])].filter(Boolean),
    hookStyle,
  };
}

export function buildTopicSelectionSeed(profile: ContentProfile, scheduledFor: Date): string {
  return `${profile.id}:${scheduledFor.toISOString()}`;
}

function scoreCountryTargets(countryTargets: string[]): number {
  let score = 0;
  for (const country of countryTargets) {
    if (PRIMARY_COUNTRY_SET.has(country)) {
      score += 5;
      continue;
    }

    if (SECONDARY_COUNTRY_SET.has(country)) {
      score += 3;
    }
  }

  return Math.min(24, score);
}

function stableSeedBonus(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash % 11);
}
