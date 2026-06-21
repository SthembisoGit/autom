import type { AssetReference, ContentCategory } from '@autom/contracts';

export type NewsTopicContext = {
  title: string;
  sourceUrl: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  snippet: string | null;
  query: string;
};

export type EvidenceItem = {
  title: string;
  sourceUrl: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  snippet: string | null;
  query: string;
  trustTier: 'trusted' | 'context' | 'fallback';
  retrievalOrigin: 'news' | 'entity' | 'archive' | 'stock' | 'demo' | 'research';
};

export type RankedEvidenceSet = {
  items: EvidenceItem[];
  degraded: boolean;
};

export type MonetizationScore = {
  total: number;
  advertiserFriendly: number;
  countryFit: number;
  retentionPotential: number;
  evidenceStrength: number;
  visualAvailability: number;
  platformFit: number;
};

export type StoryAngle = {
  coreHook: string;
  curiosityGap: string;
  highStakesAngle: string;
  concreteImplication: string;
  twistOrPayoff: string;
  visualMoments: string[];
  hookStyle: string;
};

export type TopicCandidate = {
  title: string;
  categoryId: string;
  categoryLabel: string;
  timeliness: number;
  platformFit: number;
  countryFit: number;
  evidenceStrength: number;
  visualAvailability: number;
  monetizationScore: number;
  reasoning: string;
};

export type ContentType =
  | 'recent_news'
  | 'named_person_or_event'
  | 'historical_topic'
  | 'place_or_institution'
  | 'generic_business_or_lifestyle'
  | 'product_or_tool_demo'
  | 'current_shift'
  | 'specific_person_or_event'
  | 'money_work_tools'
  | 'local_to_global'
  | 'hidden_number'
  | 'myth_reversal'
  | 'visual_story';

export type ContentOpportunity = {
  categoryId: string | null;
  categoryLabel: string | null;
  title: string;
  audience: string;
  whyNow: string;
  specificLens: string;
  originalityClaim: string;
  evidenceStrength: number;
  visualConfidence: number;
  monetizationScore: number;
  platformFit: 'meta' | 'youtube' | 'both' | null;
  riskFlags: string[];
  recommendationReason: string;
};

export type OpportunityStressTest = {
  specificityScore: number;
  evidenceScore: number;
  originalityScore: number;
  visualScore: number;
  retentionScore: number;
  rejectionReasons: string[];
};

export type EditorialBrief = {
  hook: string;
  firstTenSeconds: string;
  storyBeats: string[];
  scenePlan: string[];
  voiceRules: string[];
  visualPromise: string;
  packagingPlan: {
    titleAngle: string;
    captionAngle: string;
    hashtagStrategy: string;
    ctaStyle: string;
  };
};

export type AutoReviewScore = {
  totalScore: number;
  passed: boolean;
  blockingIssues: string[];
  warningIssues: string[];
  publishRecommendation: 'auto_publish' | 'hold_for_review' | 'reject';
};

export type ContentBrief = {
  topic: string;
  category: ContentCategory | null;
  contentType: ContentType;
  angle: string;
  factualClaims: string[];
  allowedSources: string[];
  keyEntities: string[];
  desiredVisuals: string[];
  toneGuidance: string[];
  evidence: RankedEvidenceSet;
  monetizationScore: MonetizationScore | null;
  storyAngle: StoryAngle | null;
  topicCandidate: TopicCandidate | null;
  opportunity: ContentOpportunity | null;
  opportunityStressTest: OpportunityStressTest | null;
  editorialBrief: EditorialBrief | null;
  autoReview: AutoReviewScore | null;
  verificationStatus: 'unverified' | 'verified' | 'degraded';
  exactEvidenceRequired: boolean;
  searchProvider: 'none' | 'news' | 'tavily';
  rerankProvider: 'none' | 'heuristic' | 'cohere';
  warnings: string[];
};

export type VisualSceneKind = ContentType;

export type VisualProviderFamily =
  | 'news_context'
  | 'wikimedia'
  | 'pixabay'
  | 'unsplash'
  | 'pexels'
  | 'internet_archive'
  | 'nasa'
  | 'demo';

export type VisualScenePlan = {
  sceneOrder: number;
  sceneKind: VisualSceneKind;
  queries: string[];
  keyEntities: string[];
  preferredProviders: VisualProviderFamily[];
  exactMatchRequired: boolean;
  allowStockFallback: boolean;
};

export type VisualCandidate = {
  asset: AssetReference;
  score: number;
  providerFamily: VisualProviderFamily;
  exactEntityMatch: boolean;
  matchedTerms: string[];
};

export type ProviderTaskResult<T> = {
  provider: string;
  data: T;
  warnings: string[];
  degraded?: boolean;
};
