import type { ContentCategory } from '@autom/contracts';

import type {
  AutoReviewScore,
  ContentBrief,
  ContentOpportunity,
  ContentType,
  EditorialBrief,
  EvidenceItem,
  MonetizationScore,
  NewsTopicContext,
  OpportunityStressTest,
  StoryAngle,
} from '../pipeline/types.js';

export function resolveOpportunityContentType(input: {
  baseContentType: ContentType;
  topic: string;
  category: ContentCategory | null;
  newsContext: NewsTopicContext | null;
  evidence: EvidenceItem[];
  visualLeadCount: number;
}): ContentType {
  const text = [input.topic, input.newsContext?.title ?? '', ...input.evidence.map((item) => item.title)]
    .join(' ')
    .toLowerCase();

  if (input.newsContext || /\b(latest|announced|reported|shares|earnings|tariff|deal|outage|update)\b/.test(text)) {
    return 'current_shift';
  }

  if (/\b(rate|price|cost|percent|billion|million|ranking|revenue|profit|valuation|\$?\d)/i.test(text)) {
    return 'hidden_number';
  }

  if (input.baseContentType === 'historical_topic' || /\b(myth|actually|record|history|mandela|war|empire)\b/.test(text)) {
    return 'myth_reversal';
  }

  if (input.baseContentType === 'named_person_or_event') {
    return 'specific_person_or_event';
  }

  if (input.baseContentType === 'product_or_tool_demo' || /\b(tool|software|workflow|dashboard|automation|crm|seo)\b/.test(text)) {
    return 'money_work_tools';
  }

  if (input.category?.localContextRequired) {
    return 'local_to_global';
  }

  if (input.visualLeadCount >= 3) {
    return 'visual_story';
  }

  return input.baseContentType;
}

export function buildContentOpportunity(input: {
  topic: string;
  category: ContentCategory | null;
  contentType: ContentType;
  evidence: EvidenceItem[];
  newsContext: NewsTopicContext | null;
  monetizationScore: MonetizationScore | null;
  storyAngle: StoryAngle | null;
  keyEntities: string[];
  desiredVisuals: string[];
}): ContentOpportunity {
  const strongestEvidence = input.evidence[0];
  const concreteAnchor = strongestEvidence?.title ?? input.newsContext?.title ?? input.topic;
  const audience = buildAudience(input.category);
  const evidenceStrength = scoreEvidenceStrength(input.evidence, input.newsContext);
  const visualConfidence = scoreVisualConfidence(input.desiredVisuals, input.keyEntities, input.contentType);
  const riskFlags = buildRiskFlags(input.contentType, evidenceStrength, visualConfidence, input.evidence);

  return {
    categoryId: input.category?.id ?? null,
    categoryLabel: input.category?.label ?? null,
    title: input.topic,
    audience,
    whyNow: input.newsContext
      ? `This is tied to a current report from ${input.newsContext.sourceName ?? 'a current source'}.`
      : `This topic can be made timely by explaining the decision or consequence around ${concreteAnchor}.`,
    specificLens: buildSpecificLens(input.contentType, concreteAnchor, input.keyEntities, audience),
    originalityClaim: buildOriginalityClaim(input.contentType, concreteAnchor, input.storyAngle),
    evidenceStrength,
    visualConfidence,
    monetizationScore: input.monetizationScore?.total ?? 0,
    platformFit: input.category?.platformFit ?? 'meta',
    riskFlags,
    recommendationReason: buildRecommendationReason(input.contentType, evidenceStrength, visualConfidence),
  };
}

export function stressTestOpportunity(opportunity: ContentOpportunity): OpportunityStressTest {
  const specificityScore = scoreSpecificity(opportunity.specificLens, opportunity.title);
  const evidenceScore = opportunity.evidenceStrength;
  const originalityScore = scoreSpecificity(opportunity.originalityClaim, opportunity.title);
  const visualScore = opportunity.visualConfidence;
  const retentionScore = Math.min(
    100,
    Math.round((specificityScore * 0.3) + (originalityScore * 0.25) + (visualScore * 0.2) + (opportunity.monetizationScore * 0.25))
  );
  const rejectionReasons: string[] = [];

  if (specificityScore < 45) rejectionReasons.push('Opportunity is too broad or generic.');
  if (evidenceScore < 35) rejectionReasons.push('Evidence is too weak for a factual video.');
  if (originalityScore < 40) rejectionReasons.push('Originality claim is not strong enough.');
  if (visualScore < 35) rejectionReasons.push('Visual confidence is too low.');
  if (opportunity.riskFlags.length > 0) rejectionReasons.push(...opportunity.riskFlags);

  return {
    specificityScore,
    evidenceScore,
    originalityScore,
    visualScore,
    retentionScore,
    rejectionReasons: Array.from(new Set(rejectionReasons)),
  };
}

export function buildEditorialBrief(input: {
  topic: string;
  contentType: ContentType;
  opportunity: ContentOpportunity;
  stressTest: OpportunityStressTest;
  storyAngle: StoryAngle | null;
  desiredVisuals: string[];
  callToActionStyle: string;
}): EditorialBrief {
  const hook = input.storyAngle?.coreHook ?? `${input.topic} has one detail worth stopping for.`;
  const firstTenSeconds = `${hook} Then show the specific consequence before any background.`;
  const storyBeats = [
    'Disruption: open with the specific change, number, contradiction, or visual proof.',
    'Evidence stack: add concrete details that escalate instead of repeating.',
    'Reframe: end with the one takeaway that changes how the viewer sees the topic.',
  ];

  return {
    hook,
    firstTenSeconds,
    storyBeats,
    scenePlan: buildScenePlan(input.contentType, input.desiredVisuals),
    voiceRules: [
      'Smart friend voice: plain, specific, lightly opinionated, never corporate.',
      'Use concrete nouns and short spoken sentences.',
      'No generic AI phrasing or slow background setup.',
    ],
    visualPromise: input.desiredVisuals.length > 0
      ? `Show ${input.desiredVisuals.slice(0, 3).join(', ')} as specific visual anchors.`
      : 'Use exact or strongly relevant visuals before generic stock.',
    packagingPlan: {
      titleAngle: input.opportunity.specificLens,
      captionAngle: input.opportunity.whyNow,
      hashtagStrategy: 'Use category tags, one entity tag, and one current-context tag only when relevant.',
      ctaStyle: input.callToActionStyle,
    },
  };
}

export function autoReviewOpportunity(input: {
  opportunity: ContentOpportunity;
  stressTest: OpportunityStressTest;
  editorialBrief: EditorialBrief;
  verificationStatus: ContentBrief['verificationStatus'];
  exactEvidenceRequired: boolean;
}): AutoReviewScore {
  const blockingIssues = [...input.stressTest.rejectionReasons];
  const warningIssues: string[] = [];

  if (input.verificationStatus !== 'verified') {
    const message = `Verification is ${input.verificationStatus}.`;
    if (input.exactEvidenceRequired) {
      blockingIssues.push(message);
    } else {
      warningIssues.push(message);
    }
  }

  if (!input.editorialBrief.firstTenSeconds || input.editorialBrief.firstTenSeconds.length < 40) {
    blockingIssues.push('First 10 seconds are not defined strongly enough.');
  }

  const totalScore = Math.min(
    100,
    Math.round(
      input.stressTest.specificityScore * 0.18 +
        input.stressTest.evidenceScore * 0.18 +
        input.stressTest.originalityScore * 0.18 +
        input.stressTest.visualScore * 0.18 +
        input.stressTest.retentionScore * 0.18 +
        input.opportunity.monetizationScore * 0.1
    )
  );
  const passed = blockingIssues.length === 0 && totalScore >= 72;

  return {
    totalScore,
    passed,
    blockingIssues: Array.from(new Set(blockingIssues)),
    warningIssues: Array.from(new Set(warningIssues)),
    publishRecommendation: passed ? 'auto_publish' : blockingIssues.length > 0 ? 'reject' : 'hold_for_review',
  };
}

function buildAudience(category: ContentCategory | null): string {
  const countries = category?.countryTargets.length ? category.countryTargets.join(', ') : 'US, UK, CA, AU';
  return `Global English earners in ${countries} who want useful context fast.`;
}

function buildSpecificLens(contentType: ContentType, anchor: string, entities: string[], audience: string): string {
  const entity = entities[0] ?? anchor;
  if (contentType === 'current_shift') return `Explain what changed in ${entity} and the first practical consequence for ${audience}.`;
  if (contentType === 'hidden_number') return `Use the number or measurable shift inside ${anchor} to reframe the whole story.`;
  if (contentType === 'money_work_tools') return `Show the exact workflow, screen, or money decision affected by ${entity}.`;
  if (contentType === 'myth_reversal') return `Start with the common belief about ${entity}, then show what the record changes.`;
  if (contentType === 'visual_story') return `Let the strongest available visuals carry the story around ${entity}.`;
  return `Use ${entity} as the concrete anchor so the video is not a generic explainer.`;
}

function buildOriginalityClaim(contentType: ContentType, anchor: string, storyAngle: StoryAngle | null): string {
  if (storyAngle) return `${storyAngle.curiosityGap} ${storyAngle.twistOrPayoff}`;
  if (contentType === 'local_to_global') return `Connect ${anchor} to a global pattern through one specific local example.`;
  return `The video adds value by making ${anchor} specific, visual, and consequence-led.`;
}

function buildRecommendationReason(contentType: ContentType, evidenceStrength: number, visualConfidence: number): string {
  return `${contentType} scored ${evidenceStrength} for evidence and ${visualConfidence} for visual confidence, so it can become a specific video instead of a broad explainer.`;
}

function buildRiskFlags(
  contentType: ContentType,
  evidenceStrength: number,
  visualConfidence: number,
  evidence: EvidenceItem[]
): string[] {
  const risks: string[] = [];
  const factual = ['current_shift', 'specific_person_or_event', 'hidden_number', 'myth_reversal', 'recent_news', 'named_person_or_event', 'historical_topic'].includes(contentType);
  if (factual && evidenceStrength < 45) risks.push('Factual topic needs stronger evidence.');
  if (factual && evidence.length === 0) risks.push('No evidence items available.');
  if (visualConfidence < 35) risks.push('Visual plan may fall back to generic media.');
  return risks;
}

function scoreEvidenceStrength(evidence: EvidenceItem[], newsContext: NewsTopicContext | null): number {
  const trusted = evidence.filter((item) => item.trustTier === 'trusted').length;
  return Math.min(100, Math.round(evidence.length * 18 + trusted * 12 + (newsContext ? 18 : 0)));
}

function scoreVisualConfidence(visuals: string[], entities: string[], contentType: ContentType): number {
  const base = Math.min(70, visuals.length * 12 + entities.length * 10);
  const factualBonus = ['current_shift', 'specific_person_or_event', 'myth_reversal', 'historical_topic'].includes(contentType) ? 10 : 0;
  return Math.min(100, base + factualBonus);
}

function scoreSpecificity(value: string, topic: string): number {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3);
  const topicTokens = new Set(topic.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3));
  const unique = new Set(tokens);
  const topicOverlap = tokens.filter((token) => topicTokens.has(token)).length;
  return Math.min(100, Math.round(unique.size * 7 + topicOverlap * 8));
}

function buildScenePlan(contentType: ContentType, visuals: string[]): string[] {
  const visualAnchor = visuals[0] ?? 'the strongest exact visual available';
  if (contentType === 'current_shift') {
    return ['Show the update immediately.', 'Explain the first consequence.', 'Close with what to watch next.'];
  }
  if (contentType === 'money_work_tools') {
    return ['Show the before workflow.', 'Show the tool or decision point.', 'Show the practical payoff.'];
  }
  return [`Open on ${visualAnchor}.`, 'Stack the strongest proof points.', 'End with the reframe payoff.'];
}
