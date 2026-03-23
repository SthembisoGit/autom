import type { AppEnv, RuntimePaths } from '@autom/config';
import type { CreateJobRequest, GenerationJob } from '@autom/contracts';

import { cleanupJobArtifacts } from '../lib/artifacts.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
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
}
