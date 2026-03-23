import type { AppEnv, RuntimePaths } from '@autom/config';
import type {
  AssetReference,
  ContentProfile,
  GenerationJob,
  Platform,
  PlatformConnection,
  PublicationResult,
  ReviewPackage,
  ScriptGenerationMetadata,
  ScriptPackage,
} from '@autom/contracts';

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
  }>;
}

export interface VisualProvider {
  select(input: {
    scriptPackage: ScriptPackage;
    profile: ContentProfile;
    jobId: string;
    runtimePaths: RuntimePaths;
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
