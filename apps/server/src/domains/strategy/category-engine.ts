import type { ContentCategory, ContentProfile } from '@autom/contracts';

import { scoreCountryTargets } from './country-priority.js';
import {
  buildCategoryTopicCandidates,
  chooseTopicCandidate,
  normalizeTopicText,
  topicContainsPhrase,
} from './topic-candidate-ranker.js';

export { buildCategoryTopicCandidates, chooseTopicCandidate };

export function getEnabledCategories(profile: ContentProfile): ContentCategory[] {
  return profile.contentCategories.filter((category) => category.enabled);
}

export function chooseCategory(
  profile: ContentProfile,
  seedValue: string,
  recentTopics: string[] = []
): ContentCategory | null {
  const orderedCategories = chooseCategoryOrder(profile, seedValue, recentTopics);
  return orderedCategories[0] ?? null;
}

export function scoreCategory(category: ContentCategory): number {
  const goalWeight =
    category.goal === 'revenue'
      ? 36
      : category.goal === 'hybrid'
        ? 26
        : category.goal === 'reach'
          ? 20
          : 16;
  const platformWeight =
    category.platformFit === 'meta' ? 26 : category.platformFit === 'both' ? 24 : 12;
  const countryWeight = Math.min(22, scoreCountryTargets(category.countryTargets));
  const longformWeight = category.lengthStrategy.longformEligible ? 6 : 0;
  const newsBiasWeight =
    category.contentTypeBias === 'recent_news' ||
    category.contentTypeBias === 'product_or_tool_demo'
      ? 10
      : category.contentTypeBias === 'historical_topic'
        ? 4
        : 8;

  return goalWeight + platformWeight + countryWeight + longformWeight + newsBiasWeight;
}

export function buildCategoryQueries(
  profile: ContentProfile,
  limit = 4,
  seedValue = profile.id
): string[] {
  const categories = chooseCategoryOrder(profile, seedValue);
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

export function buildTopicSelectionSeed(profile: ContentProfile, scheduledFor: Date): string {
  return `${profile.id}:${scheduledFor.toISOString()}`;
}

function chooseCategoryOrder(
  profile: ContentProfile,
  seedValue: string,
  recentTopics: string[] = []
): ContentCategory[] {
  const remaining = getEnabledCategories(profile).map((category) => ({
    category,
    weight: buildCategorySelectionWeight(category, recentTopics),
  }));
  const ordered: ContentCategory[] = [];
  const rng = createSeededRandom(`${seedValue}:${profile.id}:category-order`);

  while (remaining.length > 0) {
    const picked = pickWeightedItem(remaining, (entry) => entry.weight, rng);
    if (!picked) {
      break;
    }

    ordered.push(picked.category);
    const pickedIndex = remaining.indexOf(picked);
    if (pickedIndex >= 0) {
      remaining.splice(pickedIndex, 1);
    } else {
      remaining.shift();
    }
  }

  return ordered;
}

function buildCategorySelectionWeight(category: ContentCategory, recentTopics: string[]): number {
  const baseWeight = Math.max(1, scoreCategory(category));
  const recencyPenalty = computeCategoryRecencyPenalty(category, recentTopics);
  return Math.max(1, baseWeight * (1 - recencyPenalty));
}

function computeCategoryRecencyPenalty(category: ContentCategory, recentTopics: string[]): number {
  if (recentTopics.length === 0) {
    return 0;
  }

  const categorySignals = [category.label, ...category.searchLenses, ...category.exampleTopics]
    .map((value) => normalizeTopicText(value))
    .filter((value) => value.length > 0);

  let hits = 0;
  for (const topic of recentTopics.slice(0, 10)) {
    const normalizedTopic = normalizeTopicText(topic);
    if (normalizedTopic.length === 0) {
      continue;
    }

    if (categorySignals.some((signal) => topicContainsPhrase(normalizedTopic, signal))) {
      hits += 1;
    }
  }

  return Math.min(0.45, hits * 0.08);
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
