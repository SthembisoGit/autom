import type { AppEnv, RuntimePaths } from '@autom/config';
import type {
  AssetReference,
  ContentProfile,
  ContentMode,
  GenerationJob,
  Platform,
  PlatformConnection,
  PublicationResult,
  ReviewPackage,
  ScriptGenerationMetadata,
  ScriptPackage,
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

export interface NewsProvider {
  discoverTopic(profile: ContentProfile, scheduledFor?: Date): Promise<NewsTopicContext | null>;
  resolveContext(profile: ContentProfile, topic: string): Promise<NewsTopicContext | null>;
}

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
  }>;
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
