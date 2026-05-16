import type { AppEnv, RuntimePaths } from '@autom/config';
import type { CreateJobRequest, GenerationJob } from '@autom/contracts';

import { cleanupJobArtifacts } from '../lib/artifacts.js';
import { withExponentialBackoff } from '../lib/retry.js';
import { conflict, notFound } from '../lib/errors.js';
import { WARNING_CODE, readWarningCode } from '../lib/warning-codes.js';
import type {
  MediaRenderer,
  ScriptProvider,
  TranscriptionProvider,
  VisualProvider,
  VoiceProvider,
} from '../lib/types.js';
import type { AppRepository } from '../repositories/app-repository.js';
import type { AuditService } from './audit.js';
import type { ProfilesService } from './profiles.js';

class OperatorCancelledError extends Error {
  constructor(message = 'Cancelled by operator.') {
    super(message);
    this.name = 'OperatorCancelledError';
  }
}

export class WorkflowService {
  constructor(
    private readonly env: AppEnv,
    private readonly runtimePaths: RuntimePaths,
    private readonly repository: AppRepository,
    private readonly profilesService: ProfilesService,
    private readonly auditService: AuditService,
    private readonly scriptProvider: ScriptProvider,
    private readonly voiceProvider: VoiceProvider,
    private readonly transcriptionProvider: TranscriptionProvider,
    private readonly visualProvider: VisualProvider,
    private readonly mediaRenderer: MediaRenderer
  ) {}

  async generate(input: CreateJobRequest): Promise<GenerationJob> {
    const profile = this.profilesService.get(input.profileId);
    if (!profile) {
      throw notFound(`Profile ${input.profileId} not found.`);
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
      this.assertNotCancelled(job.id);
      this.auditService.info(job.id, 'Script generation started.');
      const { scriptPackage, scriptMetadata } = await withExponentialBackoff(
        () => this.scriptProvider.generate(profile, input.topic),
        { maxAttempts: 2, baseDelayMs: 5_000, label: `script generation job ${job.id}` }
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
      this.auditService.info(
        job.id,
        `Research stack: search=${scriptMetadata.searchProvider}, rerank=${scriptMetadata.rerankProvider}, evidence=${scriptMetadata.evidenceSourceCount}, verification=${scriptMetadata.verificationStatus}.`
      );
      if (this.env.GEMINI_API_KEY && scriptMetadata.provider !== 'gemini') {
        this.auditService.warn(
          job.id,
          `Primary Gemini script generation fell back to ${scriptMetadata.provider}.`
        );
      }
      for (const warning of scriptMetadata.warnings) {
        this.auditService.warn(job.id, warning);
      }
      if (scriptMetadata.repaired || scriptMetadata.attemptCount > 1) {
        this.auditService.warn(
          job.id,
          `Script generation required ${scriptMetadata.attemptCount} attempt(s)${
            scriptMetadata.repaired ? ' with repair handling' : ''
          }.`
        );
      }

      this.assertNotCancelled(job.id);
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

      this.assertNotCancelled(job.id);
      this.auditService.info(job.id, 'Subtitle timing transcription started.');
      const transcriptResult = await this.transcriptionProvider.transcribe({
        scriptPackage,
        profile,
        jobId: job.id,
        runtimePaths: this.runtimePaths,
        narrationPath: narrationResult.narrationPath,
      });
      this.auditService.info(
        job.id,
        transcriptResult.transcriptWords
          ? `Transcript timing captured with ${transcriptResult.transcriptWords.length} word timestamps.`
          : 'Transcript timing unavailable; renderer will use fallback subtitle timing.'
      );
      for (const warning of transcriptResult.warnings) {
        this.auditService.warn(job.id, warning);
      }

      this.assertNotCancelled(job.id);
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
      const unresolvedFactualVisuals = visualSelection.warnings.filter((warning) =>
        readWarningCode(warning) === WARNING_CODE.VISUAL_EXACT_NOT_FOUND ||
        /could not find an exact factual visual match/i.test(warning)
      );
      if (unresolvedFactualVisuals.length > 0) {
        this.auditService.warn(
          job.id,
          `[${WARNING_CODE.VISUAL_EXACT_NOT_FOUND}] Visual selection missed exact factual media for ${unresolvedFactualVisuals.length} scene(s); proceeding with degraded visuals.`
        );
      }

      this.assertNotCancelled(job.id);
      this.auditService.info(job.id, 'Render assembly started.');
      const reviewPackage = await this.mediaRenderer.render({
        env: this.env,
        profile,
        job,
        scriptPackage,
        selectedVisualQueries: visualSelection.selectedVisualQueries,
        assetReferences: [
          ...narrationResult.assetReferences,
          ...transcriptResult.assetReferences,
          ...visualSelection.assetReferences,
        ],
        warnings: [
          ...narrationResult.warnings,
          ...transcriptResult.warnings,
          ...visualSelection.warnings,
        ],
        narrationPath: narrationResult.narrationPath,
        sceneNarrationTimeline: narrationResult.sceneNarrationTimeline ?? null,
        dialogueTurnTimeline: narrationResult.dialogueTurnTimeline ?? null,
        transcriptWords: transcriptResult.transcriptWords ?? null,
        contentMode: profile.contentMode,
        runtimePaths: this.runtimePaths,
        onProgress: (message) => {
          this.auditService.info(job.id, message);
        },
      });
      const reviewPackageWithSelectionOutcomes = {
        ...reviewPackage,
        visualSelectionOutcomes: visualSelection.visualSelectionOutcomes,
      };
      this.auditService.info(job.id, 'Review package rendered.');
      this.assertNotCancelled(job.id);

      return this.repository.updateJob({
        ...workingJob,
        status: 'review_pending',
        manualClipBundle: null,
        reviewPackage: reviewPackageWithSelectionOutcomes,
        errorMessage: null,
      });
    } catch (error) {
      if (error instanceof OperatorCancelledError) {
        await cleanupJobArtifacts(this.runtimePaths, job.id);
        this.auditService.info(job.id, 'Cancellation completed. Run marked as cancelled.');
        return this.repository.updateJob({
          ...workingJob,
          status: 'cancelled',
          manualClipBundle: null,
          errorMessage: error.message,
        });
      }

      const message = error instanceof Error ? error.message : 'Unknown workflow error.';
      await cleanupJobArtifacts(this.runtimePaths, job.id);
      this.auditService.error(job.id, message);
      return this.repository.updateJob({
        ...workingJob,
        status: 'failed',
        manualClipBundle: null,
        errorMessage: message,
      });
    }
  }

  private assertNotCancelled(jobId: string): void {
    const current = this.repository.getJob(jobId);
    if (!current) {
      throw new OperatorCancelledError();
    }

    if (current.status === 'cancelling' || current.status === 'cancelled') {
      throw new OperatorCancelledError();
    }
  }
}
