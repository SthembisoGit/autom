import type { AssetReference } from '@autom/contracts';

import type { VisualCandidate, VisualScenePlan } from '../pipeline/types.js';

export function chooseBestVisualCandidate(
  candidates: VisualCandidate[],
  plan: VisualScenePlan,
  usedCandidateKeys: Set<string>
): (VisualCandidate & { forcedReuse: boolean; reuseBlockedCount: number }) | null {
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const uniqueCandidates = sorted.filter(
    (candidate) => !usedCandidateKeys.has(buildCandidateReuseKey(candidate.asset))
  );
  const duplicateCount = sorted.length - uniqueCandidates.length;
  const candidatePool = uniqueCandidates.length > 0 ? uniqueCandidates : sorted;
  const forcedReuse = uniqueCandidates.length === 0 && sorted.length > 0;

  const exact = candidatePool.find((candidate) => candidate.exactEntityMatch);
  if (exact) {
    return {
      ...exact,
      asset: {
        ...exact.asset,
        matchQuality: 'exact',
        reuseStatus: forcedReuse ? 'forced_reuse' : 'unique',
      },
      forcedReuse,
      reuseBlockedCount: duplicateCount,
    };
  }

  if (plan.exactMatchRequired) {
    const relevantFallback = candidatePool.find(
      (candidate) =>
        candidate.score >= 14 &&
        (candidate.providerFamily === 'wikimedia' ||
          candidate.providerFamily === 'news_context' ||
          candidate.matchedTerms.length >= 2)
    );
    return relevantFallback
      ? {
          ...relevantFallback,
          asset: {
            ...relevantFallback.asset,
            matchQuality: 'relevant',
            reuseStatus: forcedReuse ? 'forced_reuse' : 'unique',
          },
          forcedReuse,
          reuseBlockedCount: duplicateCount,
        }
      : null;
  }

  const fallback = candidatePool[0] ?? null;
  return fallback
    ? {
        ...fallback,
        asset: {
          ...fallback.asset,
          matchQuality: fallback.score >= 14 ? 'relevant' : 'fallback',
          reuseStatus: forcedReuse ? 'forced_reuse' : 'unique',
        },
        forcedReuse,
        reuseBlockedCount: duplicateCount,
      }
    : null;
}

export function scoreVisualCandidate(
  input: {
    title: string;
    snippet: string;
    query: string;
    retrievalOrigin: AssetReference['retrievalOrigin'];
    mimeType: string | null;
    sourceProvider?: string | null;
  },
  plan: VisualScenePlan
): number {
  const haystack = `${input.title} ${input.snippet} ${input.query}`.toLowerCase();
  let score = 0;

  for (const query of plan.queries) {
    for (const token of tokenize(query)) {
      if (haystack.includes(token)) {
        score += 3;
      }
    }
  }

  for (const entity of plan.keyEntities) {
    if (haystack.includes(entity.toLowerCase())) {
      score += 6;
    }
  }

  if (input.retrievalOrigin === 'entity' || input.retrievalOrigin === 'news') {
    score += 4;
  }

  if (input.retrievalOrigin === 'stock') {
    score += plan.allowStockFallback ? 1 : -2;
  }

  if (input.mimeType?.startsWith('video/')) {
    score += 2;
  }

  if (plan.sceneKind === 'recent_news' && input.retrievalOrigin === 'news') {
    score += 3;
  }

  if (
    ['recent_news', 'named_person_or_event', 'historical_topic'].includes(plan.sceneKind) &&
    input.retrievalOrigin === 'stock'
  ) {
    score -= 2;
  }

  // Prefer archival/documentary sources over generic stock for historical and news scenes.
  // Internet Archive and NASA both set retrievalOrigin: 'entity'. When the sourceProvider
  // is explicitly one of the archival providers, add a decisive preference bonus so they
  // beat Wikimedia images and generic stock in tie-breaks.
  if (['historical_topic', 'recent_news'].includes(plan.sceneKind)) {
    if (input.retrievalOrigin === 'entity') {
      score += plan.sceneKind === 'historical_topic' ? 3 : 1;
    }
    // Extra bonus for explicitly identified archival providers
    if (
      input.sourceProvider === 'internet_archive' ||
      input.sourceProvider === 'nasa'
    ) {
      score += 2;
    }
  }

  return score;
}

export function buildCandidateReuseKey(asset: AssetReference): string {
  return [asset.provider, asset.externalId ?? '', asset.sourceUrl ?? ''].join('|');
}

export function hasExactEntityMatch(haystack: string, entities: string[]): boolean {
  const lowerHaystack = haystack.toLowerCase();
  return entities.some((entity) => lowerHaystack.includes(entity.toLowerCase()));
}

export function matchTerms(haystack: string, queries: string[]): string[] {
  const lowerHaystack = haystack.toLowerCase();
  return Array.from(
    new Set(
      queries.flatMap((query) => tokenize(query).filter((token) => lowerHaystack.includes(token)))
    )
  );
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}
