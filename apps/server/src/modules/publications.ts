import type {
  GenerationJob,
  Platform,
  PlatformConnection,
  PublicationResult,
} from '@autom/contracts';

import { badRequest, conflict, notFound } from '../lib/errors.js';
import { hasPendingPublicationWork, summarizePublicationResults } from '../lib/job-progress.js';
import { nowIso } from '../lib/time.js';
import type { Publisher } from '../lib/types.js';
import type { AppRepository } from '../repositories/app-repository.js';
import type { AuditService } from './audit.js';

export class PublicationsService {
  private readonly publishers = new Map<Platform, Publisher>();
  private readonly enabledPlatforms = new Set<Platform>();

  constructor(
    private readonly repository: AppRepository,
    private readonly auditService: AuditService,
    publishers: Publisher[],
    enabledPlatforms: Platform[]
  ) {
    for (const publisher of publishers) {
      this.publishers.set(publisher.platform, publisher);
    }

    for (const platform of enabledPlatforms) {
      this.enabledPlatforms.add(platform);
    }
  }

  async listConnections(): Promise<PlatformConnection[]> {
    return Promise.all(
      Array.from(this.publishers.values()).map((publisher) => publisher.getConnection())
    );
  }

  async getAuthorizationUrl(platform: Platform): Promise<string> {
    return this.getPublisher(platform).getAuthorizationUrl();
  }

  async completeAuthorization(
    platform: Platform,
    input: {
      code?: string;
      state?: string;
      error?: string;
      errorDescription?: string;
    }
  ): Promise<PlatformConnection> {
    const connection = await this.getPublisher(platform).completeAuthorization(input);
    this.auditService.info(
      null,
      `${platform} account connected${connection.accountLabel ? ` (${connection.accountLabel})` : ''}.`
    );
    return connection;
  }

  async disconnect(platform: Platform): Promise<PlatformConnection> {
    const connection = await this.getPublisher(platform).disconnect();
    this.auditService.info(null, `${platform} connection removed.`);
    return connection;
  }

  async publish(jobId: string, targets?: Platform[]): Promise<GenerationJob> {
    const job = this.repository.getJob(jobId);
    if (!job) {
      throw notFound(`Job ${jobId} not found.`);
    }

    if (
      job.status !== 'approved' &&
      job.status !== 'publish_pending' &&
      !(job.status === 'failed' && job.reviewPackage && job.publicationResults.length > 0)
    ) {
      throw conflict(`Job ${jobId} must be approved before publishing.`);
    }

    const profileTargets = this.repository.getProfile(job.profileId)?.targetPlatforms ?? [];
    const configuredTargets = uniquePlatforms(targets?.length ? targets : profileTargets);
    const disabledTargets = configuredTargets.filter(
      (platform) => !this.enabledPlatforms.has(platform)
    );
    if (targets?.length && disabledTargets.length > 0) {
      throw badRequest(
        `Publish target${disabledTargets.length === 1 ? '' : 's'} ${disabledTargets.join(', ')} ${
          disabledTargets.length === 1 ? 'is' : 'are'
        } not enabled for this deployment.`
      );
    }

    const requestedTargets = configuredTargets.filter((platform) =>
      this.enabledPlatforms.has(platform)
    );
    if (requestedTargets.length === 0) {
      throw conflict(`Job ${jobId} has no enabled publish targets configured.`);
    }

    const existingResults = indexPublicationResults(job.publicationResults);
    const targetsToAttempt = requestedTargets.filter(
      (platform) => existingResults.get(platform)?.status !== 'published'
    );
    const results: PublicationResult[] = [];

    for (const platform of targetsToAttempt) {
      const latestJob = this.repository.getJob(jobId);
      if (latestJob?.status === 'cancelling' || latestJob?.status === 'cancelled') {
        this.auditService.info(
          jobId,
          'Cancellation completed. Further publication attempts were stopped.'
        );
        return this.repository.updateJob({
          ...job,
          status: 'cancelled',
          errorMessage: 'Cancelled by operator.',
          publicationResults: mergePublicationResults(job.publicationResults, results),
          updatedAt: nowIso(),
        });
      }

      const publisher = this.publishers.get(platform);
      if (!publisher) {
        results.push({
          platform,
          status: 'failed',
          externalId: null,
          publishedAt: null,
          message: 'No publisher registered for this platform.',
          connectorMode: 'stub',
        });
        continue;
      }

      results.push(await publisher.publish(job));
    }

    const mergedResults = mergePublicationResults(job.publicationResults, results);
    const mergedResultsByPlatform = indexPublicationResults(mergedResults);
    const allPublished = requestedTargets.every(
      (platform) => mergedResultsByPlatform.get(platform)?.status === 'published'
    );
    const hasPendingPublication = hasPendingPublicationWork(mergedResults);
    const finalStatus = allPublished ? 'published' : hasPendingPublication ? 'publish_pending' : 'failed';
    const errorMessage = finalStatus === 'failed' ? summarizePublicationResults(mergedResults) : null;
    const updated = this.repository.updateJob({
      ...job,
      status: finalStatus,
      publicationResults: mergedResults,
      errorMessage,
      updatedAt: nowIso(),
    });

    this.auditService.info(
      jobId,
      targetsToAttempt.length > 0
        ? finalStatus === 'failed'
          ? `Publish attempted for ${targetsToAttempt.join(', ')} but one or more targets failed.`
          : finalStatus === 'publish_pending'
            ? `Publish attempted for ${targetsToAttempt.join(', ')} and delivery is still in progress.`
            : `Publish attempted for ${targetsToAttempt.join(', ')}.`
        : `Publish skipped because ${requestedTargets.join(', ')} already succeeded.`
    );
    if (finalStatus === 'failed' && errorMessage) {
      this.auditService.error(jobId, errorMessage);
    }
    return updated;
  }

  private getPublisher(platform: Platform): Publisher {
    if (!this.enabledPlatforms.has(platform)) {
      throw badRequest(`${platform} publishing is not enabled for this deployment.`);
    }

    const publisher = this.publishers.get(platform);
    if (!publisher) {
      throw badRequest(`No publisher is registered for ${platform}.`);
    }

    return publisher;
  }
}

function indexPublicationResults(results: PublicationResult[]): Map<Platform, PublicationResult> {
  return new Map(results.map((result) => [result.platform, result]));
}

function mergePublicationResults(
  existingResults: PublicationResult[],
  latestResults: PublicationResult[]
): PublicationResult[] {
  const merged = indexPublicationResults(existingResults);

  for (const result of latestResults) {
    merged.set(result.platform, result);
  }

  return Array.from(merged.values());
}

function uniquePlatforms(platforms: Platform[]): Platform[] {
  return Array.from(new Set(platforms));
}
