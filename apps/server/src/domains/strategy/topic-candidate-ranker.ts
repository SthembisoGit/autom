import type { ContentCategory, ContentProfile } from '@autom/contracts';

import type { NewsTopicContext, TopicCandidate } from '../pipeline/types.js';
import { chooseCategory, scoreCategory } from './category-engine.js';
import { scoreCountryTargets } from './country-priority.js';

const TOPIC_SIMILARITY_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'because',
  'by',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'the',
  'that',
  'their',
  'this',
  'to',
  'too',
  'up',
  'via',
  'what',
  'when',
  'where',
  'why',
  'with',
  'without',
  'you',
  'your',
]);
const TOPIC_OPENERS: Record<ContentCategory['contentTypeBias'], string[]> = {
  recent_news: ['What changed at', 'Why', 'How', 'The move that hit', 'The update on'],
  named_person_or_event: [
    'Why',
    'How',
    'The decision that changed',
    'What changed for',
    'The moment that shaped',
  ],
  place_or_institution: ['Why', 'How', 'Inside', 'What changed at', 'The decision inside'],
  product_or_tool_demo: ['Why', 'How', 'The tool that', 'The workflow that', 'What changes when'],
  historical_topic: [
    'Why',
    'The turning point in',
    'What changed in',
    'The moment that changed',
    'The decision inside',
  ],
  generic_business_or_lifestyle: [
    'Why',
    'How',
    'The simple fix for',
    'The easier way to handle',
    'What changes when',
  ],
  mixed: ['Why', 'How', 'What changed in', 'The move behind', 'The decision that changed'],
};
const TOPIC_SUFFIXES: Record<ContentCategory['contentTypeBias'], string[]> = {
  recent_news: [
    'this week',
    'right now',
    'after the latest move',
    'for the people affected',
    'and what changes next',
  ],
  named_person_or_event: [
    'that changed the outcome',
    'at the key moment',
    'and why it still matters',
    'under pressure',
    'behind the headline',
  ],
  place_or_institution: [
    'for the people affected',
    'behind the scenes',
    'and what changed',
    'in the bigger picture',
    'after the shift',
  ],
  product_or_tool_demo: [
    'for real workflows',
    'without the extra tabs',
    'for small teams',
    'in a real setup',
    'and why it matters',
  ],
  historical_topic: [
    'that changed the outcome',
    'in the bigger story',
    'after the turning point',
    'and why it still matters',
    'when the pressure hit',
  ],
  generic_business_or_lifestyle: [
    'that saves time',
    'without the fluff',
    'for a simpler workflow',
    'in the real world',
    'when the old way breaks',
  ],
  mixed: [
    'that matters now',
    'without the fluff',
    'in the real world',
    'after the shift',
    'for the people affected',
  ],
};

export function buildCategoryTopicCandidates(
  profile: ContentProfile,
  category: ContentCategory | null,
  newsContext: NewsTopicContext | null,
  scheduledForSeed: string,
  recentTopics: string[] = []
): TopicCandidate[] {
  const activeCategory = category ?? chooseCategory(profile, scheduledForSeed, recentTopics);
  if (!activeCategory) {
    return [];
  }

  if (newsContext) {
    return [
      {
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
      },
    ];
  }

  const candidateTitles = buildCandidateTopicTitles(
    activeCategory,
    scheduledForSeed,
    recentTopics,
    4
  );
  return candidateTitles.map((title, index) => {
    const freshnessBonus = computeTopicFreshnessBonus(title, recentTopics);
    const baseMonetizationScore =
      scoreCategory(activeCategory) +
      computeTopicRelevanceBonus(activeCategory, title) +
      freshnessBonus +
      index;

    return {
      title,
      categoryId: activeCategory.id,
      categoryLabel: activeCategory.label,
      timeliness: activeCategory.contentTypeBias === 'recent_news' ? 18 : 8,
      platformFit: activeCategory.platformFit === 'youtube' ? 12 : 22,
      countryFit: scoreCountryTargets(activeCategory.countryTargets),
      evidenceStrength:
        activeCategory.contentTypeBias === 'generic_business_or_lifestyle' ? 10 : 14,
      visualAvailability: activeCategory.contentTypeBias === 'historical_topic' ? 12 : 16,
      monetizationScore: Math.min(100, Math.max(1, baseMonetizationScore)),
      reasoning: activeCategory.topicGenerationRules,
    };
  });
}

export function chooseTopicCandidate(
  candidates: TopicCandidate[],
  seedValue: string,
  recentTopics: string[] = []
): TopicCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const eligibleCandidates = candidates.filter(
    (candidate) => !isTopicTooSimilarToRecent(candidate.title, recentTopics)
  );
  const pool = eligibleCandidates.length > 0 ? eligibleCandidates : candidates;
  const rng = createSeededRandom(seedValue);

  return pickWeightedItem(pool, (candidate) => Math.max(1, candidate.monetizationScore), rng);
}

export function isTopicTooSimilarToRecent(candidate: string, recentTopics: string[]): boolean {
  return recentTopics.some((topic) => isTopicTooSimilar(topic, candidate));
}

export function topicContainsPhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) {
    return false;
  }

  return normalizeTopicText(haystack).includes(normalizeTopicText(needle));
}

export function normalizeTopicText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCandidateTopicTitles(
  category: ContentCategory,
  seedValue: string,
  recentTopics: string[],
  count: number
): string[] {
  const titles = new Set<string>();
  const maxAttempts = Math.max(count * 4, 8);

  for (let attempt = 0; attempt < maxAttempts && titles.size < count; attempt += 1) {
    const candidate = buildGeneratedTopicTitle(category, seedValue, attempt);
    if (!candidate) {
      continue;
    }

    if (isTopicTooSimilarToRecent(candidate, recentTopics)) {
      continue;
    }

    if (Array.from(titles).some((existing) => isTopicTooSimilar(existing, candidate))) {
      continue;
    }

    titles.add(candidate);
  }

  if (titles.size === 0) {
    const fallback = buildGeneratedTopicTitle(category, `${seedValue}:fallback`, 0);
    if (fallback) {
      titles.add(fallback);
    }
  }

  return Array.from(titles);
}

function buildGeneratedTopicTitle(
  category: ContentCategory,
  seedValue: string,
  variationIndex: number
): string {
  const rng = createSeededRandom(`${seedValue}:${category.id}:${variationIndex}`);

  // If exampleTopics are defined, use them as primary seed material.
  // Pick one and apply a hook formula transformation to create a fresh variant —
  // rather than copying the example verbatim or ignoring it entirely.
  if (category.exampleTopics.length > 0) {
    const baseExample = pickFromList(category.exampleTopics, rng);
    const opener = pickFromList(TOPIC_OPENERS[category.contentTypeBias], rng);
    const suffix = pickFromList(TOPIC_SUFFIXES[category.contentTypeBias], rng);
    // Use the example topic as the core subject — strip any existing opener
    const cleanedBase = stripLeadingOpener(baseExample);
    // 50% chance to use the example directly (it may already be a great title),
    // 50% chance to wrap it with opener+suffix to create a variation.
    const useVariation = rng() > 0.5;
    if (useVariation) {
      return cleanTopicTitle(`${opener} ${cleanedBase} ${suffix}`);
    }
    return cleanTopicTitle(baseExample);
  }

  // Fallback: no exampleTopics defined — generate from searchLenses
  const opener = pickFromList(TOPIC_OPENERS[category.contentTypeBias], rng);
  const suffix = pickFromList(TOPIC_SUFFIXES[category.contentTypeBias], rng);
  const focus = pickTopicFocus(category, rng);
  const toneModifier = pickToneModifier(category, rng);
  return cleanTopicTitle(`${opener} ${focus} ${toneModifier} ${suffix}`);
}

function stripLeadingOpener(title: string): string {
  // Remove common opener words if already present so we don't double them
  return title.replace(/^(Why|How|The|What|When|Where|Who|Inside|Behind)\s+/i, '').trim();
}

function pickTopicFocus(category: ContentCategory, rng: () => number): string {
  const focusPool = [
    ...category.searchLenses,
    category.label,
    normalizeSearchLens(category.label),
  ].filter((value) => value.trim().length > 0);

  const rawFocus = pickFromList(focusPool, rng);
  return normalizeSearchLens(rawFocus);
}

function normalizeSearchLens(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toLowerCase());
}

function pickToneModifier(category: ContentCategory, rng: () => number): string {
  const modifiers: Record<ContentCategory['contentTypeBias'], string[]> = {
    recent_news: [
      'people are watching',
      'the update that changed the story',
      'the shift hitting people now',
      'the part that matters next',
    ],
    named_person_or_event: [
      'at the key moment',
      'that changed the direction',
      'that still gets debated',
      'under real pressure',
    ],
    place_or_institution: [
      'behind the scenes',
      'that shaped the outcome',
      'that people overlook',
      'inside the bigger system',
    ],
    product_or_tool_demo: [
      'for a real workflow',
      'without extra friction',
      'for smaller teams',
      'in a practical setup',
    ],
    historical_topic: [
      'that changed everything',
      'behind the turning point',
      'in the bigger story',
      'when the pressure hit',
    ],
    generic_business_or_lifestyle: [
      'for a simpler workflow',
      'that saves time',
      'without the usual fluff',
      'in the real world',
    ],
    mixed: [
      'that matters now',
      'without the usual fluff',
      'in the real world',
      'for the people affected',
    ],
  };

  return pickFromList(modifiers[category.contentTypeBias], rng);
}

function computeTopicRelevanceBonus(category: ContentCategory, title: string): number {
  const normalizedTitle = normalizeTopicText(title);
  let bonus = 0;

  for (const lens of category.searchLenses) {
    const normalizedLens = normalizeTopicText(lens);
    if (normalizedLens.length === 0) {
      continue;
    }

    if (topicContainsPhrase(normalizedTitle, normalizedLens)) {
      bonus += 2;
    }
  }

  if (category.topicGenerationRules.length > 0) {
    bonus += 1;
  }

  return bonus;
}

function computeTopicFreshnessBonus(title: string, recentTopics: string[]): number {
  if (recentTopics.length === 0) {
    return 3;
  }

  let bestSimilarity = 0;
  for (const recentTopic of recentTopics.slice(0, 10)) {
    bestSimilarity = Math.max(bestSimilarity, topicSimilarity(title, recentTopic));
  }

  if (bestSimilarity >= 0.8) {
    return -12;
  }

  if (bestSimilarity >= 0.6) {
    return -5;
  }

  if (bestSimilarity >= 0.35) {
    return 0;
  }

  return 4;
}

function pickFromList<T>(items: T[], rng: () => number): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty list.');
  }

  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function pickWeightedItem<T>(
  items: T[],
  weightSelector: (item: T) => number,
  rng: () => number
): T | null {
  if (items.length === 0) {
    return null;
  }

  const weights = items.map((item) => Math.max(0, weightSelector(item)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    return items[0] ?? null;
  }

  const threshold = rng() * totalWeight;
  let runningTotal = 0;

  for (let index = 0; index < items.length; index += 1) {
    runningTotal += weights[index] ?? 0;
    if (threshold <= runningTotal) {
      return items[index] ?? null;
    }
  }

  return items[items.length - 1] ?? null;
}

function createSeededRandom(seedValue: string): () => number {
  let state = hashSeed(seedValue);
  if (state === 0) {
    state = 0x6d2b79f5;
  }

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 0x1_0000_0000) / 0x1_0000_0000;
  };
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function topicSimilarity(left: string, right: string): number {
  const leftTokens = tokenizeTopicText(left);
  const rightTokens = tokenizeTopicText(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? intersection / union : 0;
}

function tokenizeTopicText(value: string): string[] {
  return normalizeTopicText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !TOPIC_SIMILARITY_STOPWORDS.has(token));
}

function isTopicTooSimilar(left: string, right: string): boolean {
  const normalizedLeft = normalizeTopicText(left);
  const normalizedRight = normalizeTopicText(right);

  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return true;
  }

  const similarity = topicSimilarity(normalizedLeft, normalizedRight);
  return (
    similarity >= 0.6 &&
    tokenizeTopicText(normalizedLeft).length >= 2 &&
    tokenizeTopicText(normalizedRight).length >= 2
  );
}

function cleanTopicTitle(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}
