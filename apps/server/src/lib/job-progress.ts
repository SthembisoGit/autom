import type {
  AuditEvent,
  GenerationJob,
  JobMonitorEntry,
  JobProgress,
  JobProgressStage,
  JobProgressTone,
  PublicationResult,
} from '@autom/contracts';
import { JobMonitorEntrySchema, JobProgressSchema } from '@autom/contracts';

import { isRetryableFailureMessage } from './failure.js';

type StageMarker = {
  message: string;
  stage: JobProgressStage;
  title: string;
  detail: string;
  tone: JobProgressTone;
};

const STAGE_MARKERS: StageMarker[] = [
  {
    message: 'Render assembly started.',
    stage: 'rendering_review',
    title: 'Rendering review package',
    detail: 'FFmpeg is assembling scenes, captions, narration, and thumbnail assets.',
    tone: 'info',
  },
  {
    message: 'Visual selection started.',
    stage: 'selecting_visuals',
    title: 'Selecting visuals',
    detail: 'The workflow is searching and downloading source footage for each scene.',
    tone: 'info',
  },
  {
    message: 'Narration synthesis started.',
    stage: 'generating_narration',
    title: 'Generating narration',
    detail: 'The workflow is creating voiceover audio and preparing narration assets.',
    tone: 'info',
  },
  {
    message: 'Script generation started.',
    stage: 'generating_script',
    title: 'Generating script',
    detail: 'The workflow is requesting and validating a script for this topic.',
    tone: 'info',
  },
];

export function hasPendingPublicationWork(results: PublicationResult[]): boolean {
  return results.some((result) => result.status === 'pending_processing');
}

export function summarizePublicationResults(results: PublicationResult[]): string | null {
  if (results.length === 0 || hasPendingPublicationWork(results)) {
    return null;
  }

  const published = results.filter((result) => result.status === 'published');
  const failed = results.filter((result) => result.status === 'failed');
  const pendingConfiguration = results.filter(
    (result) => result.status === 'pending_configuration'
  );

  if (published.length === 0 && failed.length === 0 && pendingConfiguration.length === 0) {
    return null;
  }

  const segments = [
    ...published.map(formatPublicationResultSummary),
    ...failed.map(formatPublicationResultSummary),
    ...pendingConfiguration.map(formatPublicationResultSummary),
  ].filter((value): value is string => value.length > 0);

  return segments.length > 0 ? segments.join(' ') : null;
}

export function deriveJobProgress(job: GenerationJob, audit: AuditEvent[]): JobProgress {
  const latestAudit = audit[0] ?? null;
  const latestErrorAudit = audit.find((entry) => entry.level === 'error') ?? null;
  const latestMarker = findLatestStageMarker(audit);
  const publicationSummary = summarizePublicationResults(job.publicationResults);
  const hasPendingPublication = hasPendingPublicationWork(job.publicationResults);
  const allPublicationResultsPublished =
    job.publicationResults.length > 0 &&
    job.publicationResults.every((result) => result.status === 'published');
  const failureMessage =
    job.errorMessage ??
    latestErrorAudit?.message ??
    publicationSummary ??
    latestAudit?.message ??
    null;
  const retryableFailure = Boolean(failureMessage && isRetryableFailureMessage(failureMessage));

  if (!hasPendingPublication && job.publicationResults.length > 0) {
    const publishedResult = job.publicationResults.find((result) => result.status === 'published');

    if (allPublicationResultsPublished && publishedResult) {
      return JobProgressSchema.parse({
        stage: 'published',
        title: 'Published',
        detail:
          publishedResult.message ??
          publicationSummary ??
          'The run was published successfully and the artifacts are available for verification.',
        tone: 'success',
        isTerminal: true,
        retryable: false,
        updatedAt: publishedResult.publishedAt ?? job.updatedAt,
      });
    }

    if (job.publicationResults.some((result) => result.status !== 'published')) {
      return JobProgressSchema.parse({
        stage: 'failed',
        title: retryableFailure ? 'Retry recommended' : 'Publication failed',
        detail:
          failureMessage ??
          'One or more publish targets failed after the final delivery attempt completed.',
        tone: 'danger',
        isTerminal: true,
        retryable: retryableFailure,
        updatedAt: job.updatedAt,
      });
    }
  }

  if (job.status === 'failed') {
    return JobProgressSchema.parse({
      stage: 'failed',
      title: retryableFailure ? 'Retry recommended' : 'Run failed',
      detail: failureMessage ?? 'The workflow failed before review or publishing was completed.',
      tone: 'danger',
      isTerminal: true,
      retryable: retryableFailure,
      updatedAt: job.updatedAt,
    });
  }

  if (job.status === 'cancelled') {
    return JobProgressSchema.parse({
      stage: 'cancelled',
      title: 'Run cancelled',
      detail:
        failureMessage ??
        latestAudit?.message ??
        'The run was cancelled from the ops console before it finished.',
      tone: 'warning',
      isTerminal: true,
      retryable: false,
      updatedAt: job.updatedAt,
    });
  }

  if (job.status === 'cancelling') {
    return JobProgressSchema.parse({
      stage: 'cancelling',
      title: 'Cancelling run',
      detail: latestAudit?.message ?? 'The run is finishing its current safe step before it stops.',
      tone: 'warning',
      isTerminal: false,
      retryable: false,
      updatedAt: latestAudit?.createdAt ?? job.updatedAt,
    });
  }

  if (job.status === 'published') {
    const publishedResult =
      job.publicationResults.find((result) => result.status === 'published') ?? null;

    return JobProgressSchema.parse({
      stage: 'published',
      title: 'Published',
      detail:
        publishedResult?.message ??
        'The run was published successfully and the artifacts are available for verification.',
      tone: 'success',
      isTerminal: true,
      retryable: false,
      updatedAt: publishedResult?.publishedAt ?? job.updatedAt,
    });
  }

  if (job.status === 'publish_pending') {
    if (!hasPendingPublication) {
      if (allPublicationResultsPublished) {
        const publishedResult =
          job.publicationResults.find((result) => result.status === 'published') ?? null;

        return JobProgressSchema.parse({
          stage: 'published',
          title: 'Published',
          detail:
            publishedResult?.message ??
            publicationSummary ??
            'The run was published successfully and the artifacts are available for verification.',
          tone: 'success',
          isTerminal: true,
          retryable: false,
          updatedAt: publishedResult?.publishedAt ?? job.updatedAt,
        });
      }

      if (job.publicationResults.some((result) => result.status !== 'published')) {
        return JobProgressSchema.parse({
          stage: 'failed',
          title: retryableFailure ? 'Retry recommended' : 'Publication failed',
          detail:
            failureMessage ??
            'One or more publish targets failed after the final delivery attempt completed.',
          tone: 'danger',
          isTerminal: true,
          retryable: retryableFailure,
          updatedAt: job.updatedAt,
        });
      }

      if (job.publicationResults.some((result) => result.status === 'published')) {
        const publishedResult =
          job.publicationResults.find((result) => result.status === 'published') ?? null;

        return JobProgressSchema.parse({
          stage: 'published',
          title: 'Published',
          detail:
            publishedResult?.message ??
            publicationSummary ??
            'The run was published successfully and the artifacts are available for verification.',
          tone: 'success',
          isTerminal: true,
          retryable: false,
          updatedAt: publishedResult?.publishedAt ?? job.updatedAt,
        });
      }
    }

    return JobProgressSchema.parse({
      stage: 'publishing',
      title: 'Publishing in progress',
      detail:
        latestAudit?.message ?? 'The run is approved and waiting for publisher delivery to finish.',
      tone: 'info',
      isTerminal: false,
      retryable: false,
      updatedAt: latestAudit?.createdAt ?? job.updatedAt,
    });
  }

  if (job.status === 'approved') {
    return JobProgressSchema.parse({
      stage: 'approved',
      title: 'Approved for publish',
      detail: 'The run is approved and ready to send to Local Archive or a connected platform.',
      tone: 'warning',
      isTerminal: false,
      retryable: false,
      updatedAt: job.updatedAt,
    });
  }

  if (job.status === 'review_pending') {
    return JobProgressSchema.parse({
      stage: 'ready_for_review',
      title: 'Ready for review',
      detail: 'The preview video, captions, and asset bundle are ready for operator review.',
      tone: 'success',
      isTerminal: false,
      retryable: false,
      updatedAt: job.reviewPackage?.generatedAt ?? job.updatedAt,
    });
  }

  if (latestMarker) {
    return JobProgressSchema.parse({
      stage: latestMarker.marker.stage,
      title: latestMarker.marker.title,
      detail: latestMarker.marker.detail,
      tone: latestMarker.marker.tone,
      isTerminal: false,
      retryable: false,
      updatedAt: latestMarker.audit.createdAt,
    });
  }

  return JobProgressSchema.parse({
    stage: 'starting',
    title: 'Starting job',
    detail:
      latestAudit?.message ?? 'The workflow was created and is waiting to begin script generation.',
    tone: 'info',
    isTerminal: false,
    retryable: false,
    updatedAt: latestAudit?.createdAt ?? job.createdAt,
  });
}

export function createJobMonitorEntry(job: GenerationJob, audit: AuditEvent[]): JobMonitorEntry {
  return JobMonitorEntrySchema.parse({
    job,
    progress: deriveJobProgress(job, audit),
    latestAudit: audit[0] ?? null,
  });
}

function findLatestStageMarker(
  audit: AuditEvent[]
): { marker: StageMarker; audit: AuditEvent } | null {
  for (const entry of audit) {
    const marker = STAGE_MARKERS.find((candidate) => entry.message.startsWith(candidate.message));
    if (marker) {
      return {
        marker,
        audit: entry,
      };
    }
  }

  return null;
}

function formatPublicationResultSummary(result: PublicationResult): string {
  const platformLabel = formatPublicationPlatform(result.platform);

  if (result.status === 'published') {
    return result.message ?? `${platformLabel} delivery is complete.`;
  }

  if (result.status === 'failed') {
    return result.message
      ? `${platformLabel} delivery failed: ${result.message}`
      : `${platformLabel} delivery failed.`;
  }

  if (result.status === 'pending_processing') {
    return result.message
      ? `${platformLabel} delivery is still processing: ${result.message}`
      : `${platformLabel} delivery is still processing.`;
  }

  if (result.status === 'pending_configuration') {
    return result.message
      ? `${platformLabel} delivery is waiting on configuration: ${result.message}`
      : `${platformLabel} delivery is waiting on configuration.`;
  }

  return result.message ?? `${platformLabel} delivery status updated.`;
}

function formatPublicationPlatform(platform: PublicationResult['platform']): string {
  if (platform === 'local') {
    return 'Local Archive';
  }

  if (platform === 'youtube') {
    return 'YouTube';
  }

  if (platform === 'tiktok') {
    return 'TikTok';
  }

  if (platform === 'facebook') {
    return 'Facebook Pages';
  }

  const normalizedPlatform = platform as string;
  return normalizedPlatform.charAt(0).toUpperCase() + normalizedPlatform.slice(1);
}
