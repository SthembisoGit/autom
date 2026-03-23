import type { AppEnv, RuntimePaths } from '@autom/config';
import type { CreateJobRequest, GenerationJob } from '@autom/contracts';

import { cleanupJobArtifacts } from '../lib/artifacts.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import {
  buildManualClipAssetReferences,
  buildManualClipBundle,
} from '../lib/manual-clips.js';
import type { MediaRenderer, ScriptProvider, VisualProvider, VoiceProvider } from '../lib/types.js';
import type { AppRepository } from '../repositories/app-repository.js';
import type { AuditService } from './audit.js';
import type { ProfilesService } from './profiles.js';

export class WorkflowService {
  constructor(
    private readonly env: AppEnv,
    private readonly runtimePaths: RuntimePaths,
    private readonly repository: AppRepository,
    private readonly profilesService: ProfilesService,
    private readonly auditService: AuditService,
    private readonly scriptProvider: ScriptProvider,
    private readonly voiceProvider: VoiceProvider,
    private readonly visualProvider: VisualProvider,
    private readonly mediaRenderer: MediaRenderer
  ) {}

  async generate(input: CreateJobRequest): Promise<GenerationJob> {
    const profile = this.profilesService.get(input.profileId);
    if (!profile) {
      throw notFound(`Profile ${input.profileId} not found.`);
    }

    const policyViolation = this.profilesService.topicViolatesPolicy(profile, input.topic);
    if (policyViolation) {
      throw badRequest(`Requested topic violates profile policy. ${policyViolation}`);
    }

    const duplicateJob = this.repository.findActiveJob(profile.id, input.topic);
    if (duplicateJob) {
      throw conflict(`An active job already exists for "${input.topic}" as ${duplicateJob.id}.`);
    }

    const job = this.repository.createJob({
      profileId: profile.id,
      topic: input.topic,
    });
    let workingJob = job;
    this.auditService.info(job.id, `Job created for topic "${input.topic}".`);

    try {
      this.auditService.info(job.id, 'Script generation started.');
      const { scriptPackage, scriptMetadata } = await this.scriptProvider.generate(
        profile,
        input.topic
      );
      workingJob = {
        ...workingJob,
        scriptPackage,
        scriptMetadata,
        errorMessage: null,
      };
      this.auditService.info(
        job.id,
        `Script package created via ${scriptMetadata.provider} (${scriptMetadata.mode}) using prompt ${scriptMetadata.promptVersion}.`
      );
      if (scriptMetadata.repaired || scriptMetadata.attemptCount > 1) {
        this.auditService.warn(
          job.id,
          `Script generation required ${scriptMetadata.attemptCount} attempt(s)${
            scriptMetadata.repaired ? ' with repair handling' : ''
          }.`
        );
      }

      const manualClipBundle = buildManualClipBundle(
        profile,
        scriptPackage,
        this.env.MANUAL_CLIP_WAIT_SECONDS
      );

      if (manualClipBundle) {
        const pausedJob = this.repository.updateJob({
          ...workingJob,
          status: 'waiting_for_manual_clip',
          manualClipBundle,
          errorMessage: null,
        });
        const requestedScenes = manualClipBundle.requests.map((request) => request.sceneOrder).join(', ');
        this.auditService.info(
          job.id,
          `Manual clip upload requested for scene${manualClipBundle.requests.length === 1 ? '' : 's'} ${requestedScenes}.`
        );
        return pausedJob;
      }

      this.auditService.info(job.id, 'Narration synthesis started.');
      const narrationResult = await this.voiceProvider.synthesize(
        scriptPackage,
        profile,
        job.id,
        this.runtimePaths
      );
      this.auditService.info(
        job.id,
        narrationResult.narrationPath
          ? 'Narration asset created.'
          : 'Narration skipped or deferred.'
      );
      for (const warning of narrationResult.warnings) {
        this.auditService.warn(job.id, warning);
      }

      this.auditService.info(job.id, 'Visual selection started.');
      const visualSelection = await this.visualProvider.select({
        scriptPackage,
        profile,
        jobId: job.id,
        runtimePaths: this.runtimePaths,
      });
      this.auditService.info(job.id, 'Visual selection completed.');
      for (const warning of visualSelection.warnings) {
        this.auditService.warn(job.id, warning);
      }

      this.auditService.info(job.id, 'Render assembly started.');
      const reviewPackage = await this.mediaRenderer.render({
        env: this.env,
        profile,
        job,
        scriptPackage,
        selectedVisualQueries: visualSelection.selectedVisualQueries,
        assetReferences: [...narrationResult.assetReferences, ...visualSelection.assetReferences],
        warnings: [...narrationResult.warnings, ...visualSelection.warnings],
        narrationPath: narrationResult.narrationPath,
        sceneNarrationTimeline: narrationResult.sceneNarrationTimeline ?? null,
        runtimePaths: this.runtimePaths,
        onProgress: (message) => {
          this.auditService.info(job.id, message);
        },
      });
      this.auditService.info(job.id, 'Review package rendered.');

      return this.repository.updateJob({
        ...workingJob,
        status: 'review_pending',
        reviewPackage,
        errorMessage: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown workflow error.';
      await cleanupJobArtifacts(this.runtimePaths, job.id);
      this.auditService.error(job.id, message);
      return this.repository.updateJob({
        ...workingJob,
        status: 'failed',
        errorMessage: message,
      });
    }
  }

  async resumeManualClipJob(jobId: string): Promise<GenerationJob> {
    const job = this.repository.getJob(jobId);
    if (!job) {
      throw notFound(`Job ${jobId} not found.`);
    }

    const resumedJob =
      job.status === 'drafting'
        ? job
        : this.repository.updateJob({
            ...job,
            status: 'drafting',
            errorMessage: null,
          });

    try {
      const profile = this.profilesService.get(job.profileId);
      if (!profile) {
        throw notFound(`Profile ${job.profileId} not found.`);
      }

      if (!job.scriptPackage || !job.scriptMetadata || !job.manualClipBundle) {
        throw conflict(`Job ${jobId} cannot resume without script and manual clip data.`);
      }

      this.auditService.info(job.id, 'Manual clip assets accepted. Resuming workflow.');
      const uploadedManualClips = buildManualClipAssetReferences(resumedJob);
      const uploadedSceneOrders = uploadedManualClips
        .map((reference) => reference.sceneOrder)
        .filter((value): value is number => value !== null);

      this.auditService.info(job.id, 'Narration synthesis resumed after manual clip upload.');
      const narrationResult = await this.voiceProvider.synthesize(
        job.scriptPackage,
        profile,
        job.id,
        this.runtimePaths
      );
      this.auditService.info(
        job.id,
        narrationResult.narrationPath
          ? 'Narration asset created.'
          : 'Narration skipped or deferred.'
      );
      for (const warning of narrationResult.warnings) {
        this.auditService.warn(job.id, warning);
      }

      this.auditService.info(job.id, 'Visual selection resumed.');
      const visualSelection = await this.visualProvider.select({
        scriptPackage: job.scriptPackage,
        profile,
        jobId: job.id,
        runtimePaths: this.runtimePaths,
        excludeSceneOrders: uploadedSceneOrders,
      });
      this.auditService.info(job.id, 'Visual selection completed.');
      for (const warning of visualSelection.warnings) {
        this.auditService.warn(job.id, warning);
      }

      this.auditService.info(job.id, 'Render assembly resumed.');
      const reviewPackage = await this.mediaRenderer.render({
        env: this.env,
        profile,
        job: resumedJob,
        scriptPackage: job.scriptPackage,
        selectedVisualQueries: visualSelection.selectedVisualQueries,
        assetReferences: [
          ...narrationResult.assetReferences,
          ...uploadedManualClips,
          ...visualSelection.assetReferences,
        ],
        warnings: [...narrationResult.warnings, ...visualSelection.warnings],
        narrationPath: narrationResult.narrationPath,
        sceneNarrationTimeline: narrationResult.sceneNarrationTimeline ?? null,
        runtimePaths: this.runtimePaths,
        onProgress: (message) => {
          this.auditService.info(job.id, message);
        },
      });
      this.auditService.info(job.id, 'Review package rendered.');

      return this.repository.updateJob({
        ...resumedJob,
        status: 'review_pending',
        reviewPackage,
        errorMessage: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown workflow error.';
      await cleanupJobArtifacts(this.runtimePaths, job.id);
      this.auditService.error(job.id, message);
      return this.repository.updateJob({
        ...resumedJob,
        status: 'failed',
        errorMessage: message,
      });
    }
  }
}
