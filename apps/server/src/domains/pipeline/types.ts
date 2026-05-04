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
  | 'product_or_tool_demo';

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
