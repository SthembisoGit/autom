import type { GenerationJob } from '@autom/contracts';

import { conflict, notFound } from '../lib/errors.js';
import { hasPendingPublicationWork } from '../lib/job-progress.js';
import { nowIso } from '../lib/time.js';
import type { AppRepository } from '../repositories/app-repository.js';
import type { AuditService } from './audit.js';

export class ReviewsService {
  constructor(
    private readonly repository: AppRepository,
    private readonly auditService: AuditService
  ) {}

  list(): GenerationJob[] {
    return this.repository
      .listReviewJobs()
      .filter((job) => job.status !== 'publish_pending' || hasPendingPublicationWork(job.publicationResults));
  }

  approve(jobId: string, note?: string): GenerationJob {
    const job = this.repository.getJob(jobId);
    if (!job) {
      throw notFound(`Job ${jobId} not found.`);
    }

    if (job.status !== 'review_pending') {
      throw conflict(`Job ${jobId} cannot be approved from status ${job.status}.`);
    }

    const updated = this.repository.updateJob({
      ...job,
      status: 'approved',
      updatedAt: nowIso(),
    });
    this.auditService.info(jobId, `Review approved.${note ? ` ${note}` : ''}`);
    return updated;
  }

  reject(jobId: string, note?: string): GenerationJob {
    const job = this.repository.getJob(jobId);
    if (!job) {
      throw notFound(`Job ${jobId} not found.`);
    }

    if (!['review_pending', 'approved', 'publish_pending'].includes(job.status)) {
      throw conflict(`Job ${jobId} cannot be rejected from status ${job.status}.`);
    }

    const updated = this.repository.updateJob({
      ...job,
      status: 'drafting',
      errorMessage: note ?? 'Rejected during review.',
      updatedAt: nowIso(),
    });
    this.auditService.warn(jobId, `Review rejected.${note ? ` ${note}` : ''}`);
    return updated;
  }
}
