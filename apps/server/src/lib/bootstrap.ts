import { getEnabledPublisherPlatforms, loadEnv } from '@autom/config';
import type { Platform } from '@autom/contracts';

import { cleanupJobArtifacts } from '../lib/artifacts.js';
import { FfmpegRenderer, StubRenderer, createProcessRunner } from '../media/ffmpeg-renderer.js';
import { ArtifactsService } from '../modules/artifacts.js';
import { AuditService } from '../modules/audit.js';
import { JobsService } from '../modules/jobs.js';
import { ProfilesService } from '../modules/profiles.js';
import { PublicationsService } from '../modules/publications.js';
import { ReviewsService } from '../modules/reviews.js';
import { SchedulerService } from '../modules/scheduler.js';
import { WorkflowService } from '../modules/workflow.js';
import { createVoiceProvider } from '../providers/deepgram-provider.js';
import { createScriptProvider } from '../providers/gemini-provider.js';
import { createVisualProvider } from '../providers/pexels-provider.js';
import { FacebookPublisher } from '../publishers/facebook.js';
import { LocalPublisher } from '../publishers/local.js';
import { TikTokPublisher } from '../publishers/tiktok.js';
import { YoutubePublisher } from '../publishers/youtube.js';
import { AppRepository } from '../repositories/app-repository.js';
import { SqliteDatabase } from '../repositories/sqlite.js';
import {
  createDefaultProfile,
  isLegacyDefaultProfile,
  migrateLegacyDefaultProfile,
} from './default-profile.js';
import { ensureRuntimePaths, resolveDatabasePath } from './runtime.js';
import type {
  MediaRenderer,
  Publisher,
  ScriptProvider,
  VisualProvider,
  VoiceProvider,
} from './types.js';

export type AppServices = ReturnType<typeof createServices>;

type BootstrapOptions = {
  env?: NodeJS.ProcessEnv;
  mediaRenderer?: MediaRenderer;
  publishers?: Publisher[];
  scriptProvider?: ScriptProvider;
  voiceProvider?: VoiceProvider;
  visualProvider?: VisualProvider;
};

export async function bootstrap(options?: BootstrapOptions) {
  const env = loadEnv(options?.env ?? process.env);
  const runtimePaths = await ensureRuntimePaths(env);
  const database = new SqliteDatabase(resolveDatabasePath(env.DATABASE_URL));
  const repository = new AppRepository(database);
  const services = createServices(env, runtimePaths, repository, options);

  if (services.profilesService.list().length === 0) {
    repository.upsertProfile(createDefaultProfile(['local']));
  } else {
    const defaultProfile = repository.getProfile('profile_default');
    if (defaultProfile && isLegacyDefaultProfile(defaultProfile)) {
      repository.upsertProfile(
        migrateLegacyDefaultProfile(defaultProfile, defaultProfile.targetPlatforms)
      );
    }
  }

  const recoveredJobCount = await recoverInterruptedJobs(
    runtimePaths,
    repository,
    services.auditService
  );
  const recoveredSchedulerRunCount = await recoverInterruptedSchedulerRuns(
    repository,
    services.auditService
  );

  if (recoveredJobCount + recoveredSchedulerRunCount > 0) {
    const state = repository.getSchedulerState();
    const recoveredParts = [
      recoveredJobCount > 0 ? `${recoveredJobCount} interrupted job(s)` : null,
      recoveredSchedulerRunCount > 0
        ? `${recoveredSchedulerRunCount} interrupted scheduler run(s)`
        : null,
    ].filter((value): value is string => Boolean(value));

    repository.upsertSchedulerState({
      ...state,
      lastTickMessage: `Recovered ${recoveredParts.join(' and ')} after restart.`,
    });
  }

  return {
    env,
    runtimePaths,
    repository,
    ...services,
  };
}

function createServices(
  env: ReturnType<typeof loadEnv>,
  runtimePaths: Awaited<ReturnType<typeof ensureRuntimePaths>>,
  repository: AppRepository,
  options?: BootstrapOptions
) {
  const enabledPlatforms = options?.publishers
    ? uniquePlatforms(options.publishers.map((publisher) => publisher.platform))
    : getEnabledPublisherPlatforms(env);
  if (enabledPlatforms.length === 0) {
    throw new Error('At least one publisher platform must be enabled.');
  }

  const auditService = new AuditService(repository);
  const artifactsService = new ArtifactsService(repository, runtimePaths);
  const profilesService = new ProfilesService(repository, enabledPlatforms);
  const reviewsService = new ReviewsService(repository, auditService);
  const publishers =
    options?.publishers ?? createDefaultPublishers(env, runtimePaths, repository, enabledPlatforms);
  const publicationsService = new PublicationsService(
    repository,
    auditService,
    publishers,
    enabledPlatforms
  );
  const workflowService = new WorkflowService(
    env,
    runtimePaths,
    repository,
    profilesService,
    auditService,
    options?.scriptProvider ?? createScriptProvider(env),
    options?.voiceProvider ?? createVoiceProvider(env),
    options?.visualProvider ?? createVisualProvider(env),
    options?.mediaRenderer ??
      (env.NODE_ENV === 'test'
        ? new StubRenderer()
        : new FfmpegRenderer(createProcessRunner(env.FFMPEG_COMMAND_TIMEOUT_SECONDS * 1000)))
  );
  const schedulerService = new SchedulerService(
    env,
    repository,
    profilesService,
    workflowService,
    auditService
  );
  const jobsService = new JobsService(repository, auditService, workflowService);

  return {
    auditService,
    artifactsService,
    profilesService,
    jobsService,
    reviewsService,
    publicationsService,
    schedulerService,
    workflowService,
  };
}

function createDefaultPublishers(
  env: ReturnType<typeof loadEnv>,
  runtimePaths: Awaited<ReturnType<typeof ensureRuntimePaths>>,
  repository: AppRepository,
  enabledPlatforms: Platform[]
): Publisher[] {
  const publisherFactories: Record<Platform, () => Publisher> = {
    local: () => new LocalPublisher(runtimePaths),
    youtube: () => new YoutubePublisher(env, repository),
    tiktok: () => new TikTokPublisher(env, repository),
    facebook: () => new FacebookPublisher(env, repository),
  };

  return enabledPlatforms.map((platform) => publisherFactories[platform]());
}

function uniquePlatforms(platforms: Platform[]): Platform[] {
  return Array.from(new Set(platforms));
}

async function recoverInterruptedJobs(
  runtimePaths: Awaited<ReturnType<typeof ensureRuntimePaths>>,
  repository: AppRepository,
  auditService: AuditService
): Promise<number> {
  const interruptedJobs = repository
    .listJobs()
    .filter((job) => ['drafting', 'publish_pending'].includes(job.status));

  if (interruptedJobs.length === 0) {
    return 0;
  }

  for (const job of interruptedJobs) {
    const message =
      job.status === 'drafting'
        ? 'Draft job was interrupted by a server restart and was marked failed.'
        : 'Publish job was interrupted by a server restart and was marked failed.';

    await cleanupJobArtifacts(runtimePaths, job.id);
    auditService.error(job.id, message);
    repository.updateJob({
      ...job,
      status: 'failed',
      errorMessage: message,
    });
  }

  return interruptedJobs.length;
}

async function recoverInterruptedSchedulerRuns(
  repository: AppRepository,
  auditService: AuditService
): Promise<number> {
  const interruptedRuns = repository.listRunningSchedulerRuns();

  if (interruptedRuns.length === 0) {
    return 0;
  }

  for (const run of interruptedRuns) {
    const message = run.createdJobId
      ? `Scheduler run was interrupted by a server restart after creating job ${run.createdJobId} and was marked failed.`
      : 'Scheduler run was interrupted by a server restart and was marked failed.';

    repository.failSchedulerRun(run.id, message);
    auditService.error(null, message);
  }

  return interruptedRuns.length;
}
