import type {
  DashboardSummary,
  GenerationJob,
  JobDetailResponse,
  JobMonitorResponse,
} from '@autom/contracts';
import { JobDetailResponseSchema, JobMonitorResponseSchema } from '@autom/contracts';

import { conflict, notFound } from '../lib/errors.js';
import {
  createJobMonitorEntry,
  deriveJobProgress,
  hasPendingPublicationWork,
} from '../lib/job-progress.js';
import type { AppRepository } from '../repositories/app-repository.js';
import type { AuditService } from './audit.js';
import type { WorkflowService } from './workflow.js';
import { nowIso } from '../lib/time.js';

export class JobsService {
  constructor(
    private readonly repository: AppRepository,
    private readonly auditService: AuditService,
    private readonly workflowService: WorkflowService
  ) {}

  get(jobId: string): GenerationJob | null {
    return this.repository.getJob(jobId);
  }

  getDetail(jobId: string): JobDetailResponse | null {
    const job = this.repository.getJob(jobId);
    if (!job) {
      return null;
    }

    const audit = this.auditService.list(jobId);
    return JobDetailResponseSchema.parse({
      job,
      audit,
      progress: deriveJobProgress(job, audit),
    });
  }

  getMonitor(): JobMonitorResponse {
    const jobs = this.repository.listJobs();
    const active = jobs
      .filter((job) =>
        ['drafting', 'cancelling', 'review_pending', 'approved'].includes(job.status) ||
        (job.status === 'publish_pending' && hasPendingPublicationWork(job.publicationResults))
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 8)
      .map((job) => createJobMonitorEntry(job, this.auditService.list(job.id)));
    const failed = jobs
      .filter((job) => job.status === 'failed')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 5)
      .map((job) => createJobMonitorEntry(job, this.auditService.list(job.id)));

    return JobMonitorResponseSchema.parse({
      active,
      failed,
    });
  }

  listHistory(): GenerationJob[] {
    return this.repository.listHistory();
  }

  getDashboardSummary(): DashboardSummary {
    return this.repository.getDashboardSummary();
  }

  async retry(jobId: string): Promise<GenerationJob> {
    const job = this.repository.getJob(jobId);
    if (!job) {
      throw notFound(`Job ${jobId} not found.`);
    }

    if (job.status !== 'failed') {
      throw conflict(`Job ${jobId} can only be retried from failed status.`);
    }

    const progress = deriveJobProgress(job, this.auditService.list(jobId));
    if (!progress.retryable) {
      throw conflict(`Job ${jobId} is not marked retryable.`);
    }

    this.auditService.info(jobId, 'Retry requested. Starting a fresh generation run.');
    const retryJob = await this.workflowService.generate({
      profileId: job.profileId,
      topic: job.topic,
    });
    this.auditService.info(jobId, `Retry started as job ${retryJob.id}.`);
    return retryJob;
  }

  cancel(jobId: string): GenerationJob {
    const job = this.repository.getJob(jobId);
    if (!job) {
      throw notFound(`Job ${jobId} not found.`);
    }

    if (job.status === 'cancelling' || job.status === 'cancelled') {
      return job;
    }

    if (job.status === 'drafting') {
      this.auditService.warn(jobId, 'Cancel requested. The run will stop after the current safe step.');
      return this.repository.updateJob({
        ...job,
        status: 'cancelling',
        errorMessage: 'Cancel requested by operator.',
        updatedAt: nowIso(),
      });
    }

    if (job.status === 'publish_pending') {
      this.auditService.warn(
        jobId,
        'Cancel requested. Further publication work will stop and the run is being closed.'
      );
      this.auditService.info(jobId, 'Cancellation completed. Run marked as cancelled.');
      return this.repository.updateJob({
        ...job,
        status: 'cancelled',
        errorMessage: 'Cancelled by operator.',
        updatedAt: nowIso(),
      });
    }

    throw conflict(`Job ${jobId} cannot be cancelled from ${job.status} status.`);
  }

  archive(jobId: string): GenerationJob {
    const job = this.repository.getJob(jobId);
    if (!job) {
      throw notFound(`Job ${jobId} not found.`);
    }

    if (job.archivedAt) {
      return job;
    }

    if (!['failed', 'published', 'cancelled'].includes(job.status)) {
      throw conflict(`Job ${jobId} can only be removed from lists after it is finished.`);
    }

    this.auditService.info(jobId, 'Archive requested from ops console.');
    this.auditService.info(jobId, 'Run archived from normal ops views.');
    return this.repository.updateJob({
      ...job,
      archivedAt: nowIso(),
      archivedReason: 'Archived from ops console.',
      updatedAt: nowIso(),
    });
  }
}
