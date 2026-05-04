import type { AppEnv, RuntimePaths } from '@autom/config';
import type {
  AssetReference,
  ContentCategory,
  ContentMode,
  ContentProfile,
  GenerationJob,
  Platform,
  PlatformConnection,
  PublicationResult,
  ReviewPackage,
  ScriptGenerationMetadata,
  ScriptPackage,
  VisualSelectionOutcome,
} from '@autom/contracts';

export type SceneNarrationTiming = {
  sceneOrder: number;
  startSeconds: number;
  endSeconds: number;
};

export type DialogueTurnTiming = {
  turnOrder: number;
  sceneOrder: number;
  speakerId: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  shotType: 'duo' | 'speaker_focus' | 'insert_demo' | 'insert_broll' | 'data_card';
};

export type TranscriptWordTiming = {
  word: string;
  startSeconds: number;
  endSeconds: number;
  confidence: number | null;
};

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

export type ContentBrief = {
  topic: string;
  category: ContentCategory | null;
  contentType:
    | 'recent_news'
    | 'named_person_or_event'
    | 'historical_topic'
    | 'place_or_institution'
    | 'generic_business_or_lifestyle'
    | 'product_or_tool_demo';
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

export type VisualSceneKind =
  | 'recent_news'
  | 'named_person_or_event'
  | 'historical_topic'
  | 'place_or_institution'
  | 'generic_business_or_lifestyle'
  | 'product_or_tool_demo';

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

export interface NewsProvider {
  discoverTopic(profile: ContentProfile, scheduledFor?: Date): Promise<NewsTopicContext | null>;
  resolveContext(profile: ContentProfile, topic: string): Promise<NewsTopicContext | null>;
}

export interface SearchProvider {
  collectEvidence(input: {
    profile: ContentProfile;
    topic: string;
    newsContext: NewsTopicContext | null;
  }): Promise<ProviderTaskResult<EvidenceItem[]>>;
}

export interface RerankProvider {
  rankEvidence(input: {
    profile: ContentProfile;
    topic: string;
    newsContext: NewsTopicContext | null;
    evidence: EvidenceItem[];
  }): Promise<ProviderTaskResult<RankedEvidenceSet>>;
}

export interface EditorialFallbackProvider extends ScriptProvider {}

export type ScriptGenerationResult = {
  scriptPackage: ScriptPackage;
  scriptMetadata: ScriptGenerationMetadata;
};

export interface ScriptProvider {
  generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult>;
}

export interface VoiceProvider {
  synthesize(
    scriptPackage: ScriptPackage,
    profile: ContentProfile,
    jobId: string,
    runtimePaths: RuntimePaths
  ): Promise<{
    narrationPath: string | null;
    assetReferences: AssetReference[];
    warnings: string[];
    sceneNarrationTimeline?: SceneNarrationTiming[] | null;
    dialogueTurnTimeline?: DialogueTurnTiming[] | null;
  }>;
}

export interface TranscriptionProvider {
  transcribe(input: {
    scriptPackage: ScriptPackage;
    profile: ContentProfile;
    jobId: string;
    runtimePaths: RuntimePaths;
    narrationPath: string | null;
  }): Promise<{
    transcriptWords: TranscriptWordTiming[] | null;
    assetReferences: AssetReference[];
    warnings: string[];
  }>;
}

export interface VisualProvider {
  select(input: {
    scriptPackage: ScriptPackage;
    profile: ContentProfile;
    jobId: string;
    runtimePaths: RuntimePaths;
    excludeSceneOrders?: number[];
  }): Promise<{
    selectedVisualQueries: string[];
    assetReferences: AssetReference[];
    warnings: string[];
    visualSelectionOutcomes: VisualSelectionOutcome[];
  }>;
}

export interface VisualSceneProvider {
  family: VisualProviderFamily;
  collectCandidates(input: {
    profile: ContentProfile;
    scene: ScriptPackage['scenes'][number];
    plan: VisualScenePlan;
    jobId: string;
    runtimePaths: RuntimePaths;
  }): Promise<ProviderTaskResult<VisualCandidate[]>>;
}

export interface MediaRenderer {
  render(input: {
    env: AppEnv;
    profile: ContentProfile;
    job: GenerationJob;
    scriptPackage: ScriptPackage;
    selectedVisualQueries: string[];
    assetReferences: AssetReference[];
    warnings: string[];
    narrationPath: string | null;
    sceneNarrationTimeline?: SceneNarrationTiming[] | null;
    dialogueTurnTimeline?: DialogueTurnTiming[] | null;
    transcriptWords?: TranscriptWordTiming[] | null;
    contentMode?: ContentMode;
    runtimePaths: RuntimePaths;
    onProgress?: (message: string) => void | Promise<void>;
  }): Promise<ReviewPackage>;
}

export interface Publisher {
  platform: Platform;
  getConnection(): Promise<PlatformConnection>;
  getAuthorizationUrl(): Promise<string>;
  completeAuthorization(input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<PlatformConnection>;
  disconnect(): Promise<PlatformConnection>;
  publish(job: GenerationJob): Promise<PublicationResult>;
}
