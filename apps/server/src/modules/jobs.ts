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
        ['drafting', 'waiting_for_manual_clip', 'review_pending', 'approved'].includes(job.status) ||
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
}
