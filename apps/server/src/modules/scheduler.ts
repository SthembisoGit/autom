import { CronExpressionParser } from 'cron-parser';

import type { AppEnv } from '@autom/config';
import type { ContentProfile, SchedulerOverview, SchedulerRun } from '@autom/contracts';
import { SchedulerOverviewSchema } from '@autom/contracts';

import {
  buildCategoryTopicCandidates,
  buildTopicSelectionSeed,
  chooseCategory,
  chooseTopicCandidate,
} from '../lib/content-strategy.js';
import { normalizeCronExpression } from '../lib/cron.js';
import { AppError } from '../lib/errors.js';
import { isRetryableFailureMessage } from '../lib/failure.js';
import type { NewsProvider } from '../lib/types.js';
import type { AppRepository } from '../repositories/app-repository.js';
import type { AuditService } from './audit.js';
import type { ProfilesService } from './profiles.js';
import type { WorkflowService } from './workflow.js';

const MAX_CATCH_UP_SLOTS_PER_PROFILE = 12;
const MAX_RUNS_PER_TICK = 25;

export class SchedulerService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeTick: Promise<SchedulerOverview> | null = null;
  private started = false;

  constructor(
    private readonly env: AppEnv,
    private readonly repository: AppRepository,
    private readonly profilesService: ProfilesService,
    private readonly workflowService: WorkflowService,
    private readonly auditService: AuditService,
    private readonly newsProvider: NewsProvider
  ) {}

  start(): void {
    if (this.started || !this.env.SCHEDULER_ENABLED) {
      return;
    }

    this.started = true;
    this.scheduleNextTick(0);
    this.auditService.info(null, 'Scheduler loop started.');
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    await this.activeTick;
  }

  async runDueWork(at = new Date()): Promise<SchedulerOverview> {
    if (this.activeTick) {
      return this.activeTick;
    }

    this.activeTick = this.executeTick(at).finally(() => {
      this.activeTick = null;
    });
    return this.activeTick;
  }

  getOverview(): SchedulerOverview {
    const state = this.repository.getSchedulerState();
    const metrics = this.repository.getSchedulerMetrics();

    return SchedulerOverviewSchema.parse({
      enabled: this.env.SCHEDULER_ENABLED,
      running: this.started || this.activeTick !== null,
      pollIntervalSeconds: this.env.SCHEDULER_POLL_INTERVAL_SECONDS,
      lastTickStartedAt: state.lastTickStartedAt,
      lastTickCompletedAt: state.lastTickCompletedAt,
      lastTickMessage: state.lastTickMessage,
      queuedRuns: metrics.queuedRuns,
      activeRuns: metrics.activeRuns,
      completedRuns24h: metrics.completedRuns24h,
      failedRuns24h: metrics.failedRuns24h,
      recentRuns: this.repository.listRecentSchedulerRuns(10),
    });
  }

  cancelRun(runId: string): SchedulerRun {
    const run = this.repository.getSchedulerRun(runId);
    if (!run) {
      throw new AppError(404, `Scheduler run ${runId} not found.`);
    }

    if (run.status === 'cancelled') {
      return run;
    }

    if (!['queued', 'retry_scheduled'].includes(run.status)) {
      throw new AppError(
        409,
        `Scheduler run ${runId} cannot be cancelled from ${run.status} status.`
      );
    }

    const cancelled = this.repository.cancelSchedulerRun(
      runId,
      'Cancelled by operator before execution.'
    );
    this.auditService.info(
      null,
      `Scheduler run ${runId} for topic "${run.topic}" was cancelled from the ops console.`
    );
    return cancelled ?? run;
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.started) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.runDueWork().finally(() => {
        this.scheduleNextTick(this.env.SCHEDULER_POLL_INTERVAL_SECONDS * 1000);
      });
    }, delayMs);
  }

  private async executeTick(at: Date): Promise<SchedulerOverview> {
    const state = this.repository.getSchedulerState();
    this.repository.upsertSchedulerState({
      ...state,
      lastTickStartedAt: at.toISOString(),
      lastTickMessage: 'Scheduler tick in progress.',
    });

    let queuedCount = 0;
    let processedCount = 0;
    let retryCount = 0;
    let failedCount = 0;

    try {
      queuedCount = await this.queueDueRuns(at, state.lastTickCompletedAt);
      const dueRuns = this.repository.listDueSchedulerRuns(at.toISOString(), MAX_RUNS_PER_TICK);

      for (const run of dueRuns) {
        processedCount += 1;
        const outcome = await this.processRun(run, at);
        if (outcome === 'retry') {
          retryCount += 1;
        } else if (outcome === 'failed') {
          failedCount += 1;
        }
      }

      this.repository.upsertSchedulerState({
        lastTickStartedAt: at.toISOString(),
        lastTickCompletedAt: new Date().toISOString(),
        lastTickMessage: `Scheduler tick finished. Queued ${queuedCount} run(s), processed ${processedCount}, retries ${retryCount}, failures ${failedCount}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scheduler failure.';
      this.repository.upsertSchedulerState({
        lastTickStartedAt: at.toISOString(),
        lastTickCompletedAt: new Date().toISOString(),
        lastTickMessage: `Scheduler tick failed: ${message}`,
      });
      this.auditService.error(null, `Scheduler tick failed: ${message}`);
    }

    return this.getOverview();
  }

  private async queueDueRuns(now: Date, lastTickCompletedAt: string | null): Promise<number> {
    const profiles = this.profilesService.list().filter((profile) => profile.enabled);
    let created = 0;

    for (const profile of profiles) {
      let dueSlots: Date[] = [];

      try {
        dueSlots = this.resolveDueSlots(
          profile,
          now,
          resolveSchedulerStartAt(
            lastTickCompletedAt,
            this.repository.getSchedulerProfileResumeAt(profile.id),
            now
          )
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid cron expression.';
        this.auditService.error(
          null,
          `Scheduler skipped profile ${profile.id} because its cron expression is invalid: ${message}`
        );
        continue;
      }

      for (const slot of dueSlots) {
        const topic = await this.resolveScheduledTopic(profile, slot);
        const result = this.repository.ensureSchedulerRun({
          profileId: profile.id,
          scheduledFor: slot.toISOString(),
          topic,
          maxAttempts: this.env.SCHEDULER_MAX_RETRIES,
        });

        if (result.created) {
          created += 1;
          this.auditService.info(
            null,
            `Scheduler queued ${profile.id} for ${slot.toISOString()} with topic "${result.run.topic}".`
          );
        }
      }
    }

    return created;
  }

  private resolveDueSlots(profile: ContentProfile, now: Date, startAt: string | null): Date[] {
    const expression = normalizeCronExpression(profile.scheduleCron);
    if (!startAt) {
      return resolveInitialDueSlots(expression, now);
    }

    const catchupInterval = CronExpressionParser.parse(expression, {
      currentDate: startAt,
      endDate: now,
      strict: true,
    });
    const slots: Date[] = [];

    while (catchupInterval.hasNext() && slots.length < MAX_CATCH_UP_SLOTS_PER_PROFILE) {
      const nextDate = catchupInterval.next().toDate();
      if (nextDate.getTime() > now.getTime()) {
        break;
      }

      slots.push(nextDate);
    }

    return slots;
  }

  private async processRun(
    queuedRun: SchedulerRun,
    currentTime: Date
  ): Promise<'completed' | 'retry' | 'failed' | 'skipped'> {
    const run = this.repository.claimSchedulerRun(queuedRun.id);
    if (!run) {
      return 'skipped';
    }

    const profile = this.profilesService.get(run.profileId);
    if (!profile || !profile.enabled) {
      this.repository.skipSchedulerRun(
        run.id,
        `Profile ${run.profileId} is unavailable or disabled for scheduled execution.`
      );
      return 'skipped';
    }

    try {
      const job = await this.workflowService.generate({
        profileId: run.profileId,
        topic: run.topic,
      });

      if (job.status === 'review_pending') {
        this.repository.completeSchedulerRun(run.id, job.id);
        this.auditService.info(
          job.id,
          `Scheduled run ${run.id} completed and created job ${job.id}.`
        );
        return 'completed';
      }

      const message = job.errorMessage ?? `Scheduled job ${job.id} failed before review.`;
      return this.handleFailedRun(run, message, currentTime);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 409) {
        this.repository.skipSchedulerRun(run.id, error.message);
        this.auditService.warn(null, `Scheduled run ${run.id} skipped: ${error.message}`);
        return 'skipped';
      }

      if (error instanceof AppError && error.statusCode < 500) {
        this.repository.failSchedulerRun(run.id, error.message);
        this.auditService.error(null, `Scheduled run ${run.id} failed: ${error.message}`);
        return 'failed';
      }

      const message =
        error instanceof Error ? error.message : 'Unknown scheduler execution failure.';
      return this.handleFailedRun(run, message, currentTime);
    }
  }

  private handleFailedRun(
    run: SchedulerRun,
    message: string,
    currentTime: Date
  ): 'retry' | 'failed' {
    if (!isRetryableFailureMessage(message) || run.attemptCount >= run.maxAttempts) {
      this.repository.failSchedulerRun(run.id, message);
      this.auditService.error(null, `Scheduled run ${run.id} failed permanently: ${message}`);
      return 'failed';
    }

    const nextRetryAt = new Date(
      currentTime.getTime() +
        this.env.SCHEDULER_RETRY_BASE_SECONDS * 1000 * Math.max(1, run.attemptCount)
    ).toISOString();
    this.repository.retrySchedulerRun(run.id, message, nextRetryAt);
    this.auditService.warn(
      null,
      `Scheduled run ${run.id} failed and will retry at ${nextRetryAt}: ${message}`
    );
    return 'retry';
  }

  private async resolveScheduledTopic(
    profile: ContentProfile,
    scheduledFor: Date
  ): Promise<string> {
    const category = chooseCategory(profile, buildTopicSelectionSeed(profile, scheduledFor));

    if (profile.topicSource !== 'daily_news') {
      const topicSeed = buildTopicSelectionSeed(profile, scheduledFor);
      const candidate = chooseTopicCandidate(
        buildCategoryTopicCandidates(
          profile,
          category,
          null,
          topicSeed
        ),
        `${topicSeed}:candidate`
      );
      return candidate?.title ?? profile.niche;
    }

    try {
      const newsTopic = await this.newsProvider.discoverTopic(profile, scheduledFor);
      if (newsTopic?.title) {
        this.auditService.info(
          null,
          `News topic selected for ${profile.id}: "${newsTopic.title}"${
            newsTopic.sourceName ? ` via ${newsTopic.sourceName}` : ''
          }.`
        );
        return newsTopic.title;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown news topic resolution failure.';
      this.auditService.warn(
        null,
        `Daily news topic lookup failed for ${profile.id}; falling back to category seeds. ${message}`
      );
    }

    const fallbackSeed = buildTopicSelectionSeed(profile, scheduledFor);
    const fallbackCandidate = chooseTopicCandidate(
      buildCategoryTopicCandidates(
        profile,
        category,
        null,
        fallbackSeed
      ),
      `${fallbackSeed}:candidate`
    );
    return fallbackCandidate?.title ?? profile.niche;
  }
}

function resolveSchedulerStartAt(
  lastTickCompletedAt: string | null,
  profileResumeAt: string | null,
  now: Date
): string | null {
  if (!profileResumeAt || profileResumeAt > now.toISOString()) {
    return lastTickCompletedAt;
  }

  if (!lastTickCompletedAt) {
    return profileResumeAt;
  }

  return profileResumeAt > lastTickCompletedAt ? profileResumeAt : lastTickCompletedAt;
}

function resolveInitialDueSlots(expression: string, now: Date): Date[] {
  const inclusiveInterval = CronExpressionParser.parse(expression, {
    currentDate: new Date(now.getTime() - 1000),
    endDate: now,
    strict: true,
  });
  if (inclusiveInterval.hasNext()) {
    return [inclusiveInterval.next().toDate()];
  }

  const previousInterval = CronExpressionParser.parse(expression, {
    currentDate: now,
    strict: true,
  });
  return [previousInterval.prev().toDate()];
}
