import type { AppEnv } from '@autom/config';
import type { ContentCategory, ContentProfile } from '@autom/contracts';

import type { NewsProvider, RerankProvider, SearchProvider } from '../../lib/types.js';
import {
  autoReviewOpportunity,
  buildContentOpportunity,
  buildEditorialBrief,
  resolveOpportunityContentType,
  stressTestOpportunity,
} from '../ideation/opportunity-engine.js';
import { buildStoryAngle } from '../editorial/story-angle-planner.js';
import {
  ResearchEvidenceService,
  createResearchEvidenceService,
} from '../research/evidence-service.js';
import { buildTopicSelectionSeed, chooseCategory } from '../strategy/category-engine.js';
import { buildMonetizationScore } from '../strategy/monetization-planner.js';
import type { ContentBrief, EvidenceItem, NewsTopicContext } from './types.js';

export class ContentPipelineOrchestrator {
  constructor(private readonly evidenceService: ResearchEvidenceService) {}

  async buildBrief(profile: ContentProfile, topic: string): Promise<ContentBrief> {
    const research = await this.evidenceService.collect(profile, topic);
    const keyEntities = extractKeyEntities([
      topic,
      research.newsContext?.title ?? '',
      ...research.evidence.items.map((item) => item.title),
    ]);

    const category = chooseCategory(
      profile,
      `${buildTopicSelectionSeed(profile, new Date())}:${topic}:${research.newsContext?.title ?? ''}`
    );
    const baseContentType = inferContentType(
      profile,
      topic,
      research.newsContext,
      keyEntities,
      category
    );
    const contentType = resolveOpportunityContentType({
      baseContentType,
      topic,
      category,
      newsContext: research.newsContext,
      evidence: research.evidence.items,
      visualLeadCount: keyEntities.length,
    });
    const exactEvidenceRequired = isExactEvidenceRequired(contentType);
    const monetizationScore = buildMonetizationScore(
      category,
      research.newsContext,
      research.evidence.items.length,
      exactEvidenceRequired
    );
    const storyAngle = buildStoryAngle(
      topic,
      category,
      contentType,
      research.evidence.items.map((item) => item.title),
      research.newsContext
    );
    const desiredVisuals = buildDesiredVisuals(topic, research.newsContext, keyEntities);
    const opportunity = buildContentOpportunity({
      topic,
      category,
      contentType,
      evidence: research.evidence.items,
      newsContext: research.newsContext,
      monetizationScore,
      storyAngle,
      keyEntities,
      desiredVisuals,
    });
    const opportunityStressTest = stressTestOpportunity(opportunity);
    const editorialBrief = buildEditorialBrief({
      topic,
      contentType,
      opportunity,
      stressTest: opportunityStressTest,
      storyAngle,
      desiredVisuals,
      callToActionStyle: profile.callToActionStyle,
    });
    const autoReview = autoReviewOpportunity({
      opportunity,
      stressTest: opportunityStressTest,
      editorialBrief,
      verificationStatus: research.verificationStatus,
      exactEvidenceRequired,
    });

    return {
      topic,
      category,
      contentType,
      angle: buildAngle(topic, research.newsContext, research.evidence.items, storyAngle),
      factualClaims: buildFactualClaims(research.newsContext, research.evidence.items),
      allowedSources: Array.from(
        new Set(
          research.evidence.items
            .map((item) => item.sourceName || tryReadHostname(item.sourceUrl))
            .filter((value): value is string => Boolean(value))
        )
      ),
      keyEntities,
      desiredVisuals,
      toneGuidance: buildToneGuidance(profile, research.newsContext, category, storyAngle),
      evidence: research.evidence,
      monetizationScore,
      storyAngle,
      topicCandidate: category
        ? {
            title: topic,
            categoryId: category.id,
            categoryLabel: category.label,
            timeliness: research.newsContext ? 30 : 10,
            platformFit: monetizationScore.platformFit,
            countryFit: monetizationScore.countryFit,
            evidenceStrength: monetizationScore.evidenceStrength,
            visualAvailability: monetizationScore.visualAvailability,
            monetizationScore: monetizationScore.total,
            reasoning: category.topicGenerationRules,
          }
        : null,
      opportunity,
      opportunityStressTest,
      editorialBrief,
      autoReview,
      verificationStatus: research.verificationStatus,
      exactEvidenceRequired,
      searchProvider: research.searchProvider,
      rerankProvider: research.rerankProvider,
      warnings: research.warnings,
    };
  }
}

export {
  CohereRerankProvider,
  FallbackSearchProvider,
  HeuristicRerankProvider,
  TavilySearchProvider,
} from '../research/evidence-service.js';

export class ContentOrchestrator extends ContentPipelineOrchestrator {
  constructor(
    newsProvider: NewsProvider | undefined,
    searchProvider: SearchProvider,
    rerankProvider: RerankProvider
  ) {
    super(new ResearchEvidenceService(newsProvider, searchProvider, rerankProvider));
  }
}

export function createContentOrchestrator(
  env: AppEnv,
  newsProvider?: NewsProvider
): ContentOrchestrator {
  const evidenceService = createResearchEvidenceService(env, newsProvider);
  return new ContentOrchestrator(
    evidenceService.getNewsProvider(),
    evidenceService.getSearchProvider(),
    evidenceService.getRerankProvider()
  );
}

function inferContentType(
  profile: ContentProfile,
  topic: string,
  newsContext: NewsTopicContext | null,
  keyEntities: string[],
  category: ContentCategory | null
): ContentBrief['contentType'] {
  if (newsContext) {
    return 'recent_news';
  }

  if (category && category.contentTypeBias !== 'mixed') {
    return category.contentTypeBias;
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

  return 'generic_business_or_lifestyle';
}

function isExactEvidenceRequired(contentType: ContentBrief['contentType']): boolean {
  return (
    contentType === 'recent_news' ||
    contentType === 'named_person_or_event' ||
    contentType === 'historical_topic' ||
    contentType === 'current_shift' ||
    contentType === 'specific_person_or_event' ||
    contentType === 'hidden_number' ||
    contentType === 'myth_reversal'
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

function buildFactualClaims(
  newsContext: NewsTopicContext | null,
  evidence: EvidenceItem[]
): string[] {
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
  return Array.from(new Set([topic, newsContext?.title ?? '', ...entities].filter(Boolean))).slice(
    0,
    6
  );
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
    guidance.push(
      `Aim for ${category.platformFit}-first packaging with strong hold in the first 10 to 20 seconds.`
    );
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
