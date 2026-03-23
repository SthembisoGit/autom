import { nanoid } from 'nanoid';

import type {
  AuditEvent,
  ContentProfile,
  DashboardSummary,
  GenerationJob,
  JobStatus,
  Platform,
  PublicationResult,
  SchedulerRun,
  SchedulerRunStatus,
} from '@autom/contracts';
import {
  AuditEventSchema,
  ContentProfileSchema,
  DashboardSummarySchema,
  ManualClipBundleSchema,
  GenerationJobSchema,
  ReviewPackageSchema,
  SchedulerRunSchema,
  ScriptGenerationMetadataSchema,
  ScriptPackageSchema,
} from '@autom/contracts';

import { nowIso } from '../lib/time.js';
import type { SqliteDatabase } from './sqlite.js';

type JobRecord = {
  id: string;
  profile_id: string;
  topic: string;
  status: JobStatus;
  script_json: string | null;
  script_metadata_json: string | null;
  manual_clip_json: string | null;
  review_json: string | null;
  publication_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type PlatformConnectionRecord = {
  platform: Platform;
  data: string;
  created_at: string;
  updated_at: string;
};

type SchedulerRunRecord = {
  id: string;
  profile_id: string;
  topic: string;
  scheduled_for: string;
  status: SchedulerRunStatus;
  attempt_count: number;
  max_attempts: number;
  created_job_id: string | null;
  error_message: string | null;
  next_retry_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type SchedulerState = {
  lastTickStartedAt: string | null;
  lastTickCompletedAt: string | null;
  lastTickMessage: string | null;
};

type SchedulerProfileStateRecord = {
  profile_id: string;
  resume_from: string;
  updated_at: string;
};

export class AppRepository {
  constructor(private readonly database: SqliteDatabase) {}

  close(): void {
    this.database.close();
  }

  listProfiles(): ContentProfile[] {
    const rows = this.database.connection
      .prepare('SELECT data FROM profiles ORDER BY updated_at DESC')
      .all() as Array<{ data: string }>;
    return rows.map((row) => ContentProfileSchema.parse(JSON.parse(row.data)));
  }

  getProfile(profileId: string): ContentProfile | null {
    const row = this.database.connection
      .prepare('SELECT data FROM profiles WHERE id = ?')
      .get(profileId) as { data: string } | undefined;

    if (!row) {
      return null;
    }

    return ContentProfileSchema.parse(JSON.parse(row.data));
  }

  upsertProfile(profile: ContentProfile): ContentProfile {
    this.database.connection
      .prepare(`
        INSERT INTO profiles (id, name, enabled, data, created_at, updated_at)
        VALUES (@id, @name, @enabled, @data, @created_at, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          enabled = excluded.enabled,
          data = excluded.data,
          updated_at = excluded.updated_at
      `)
      .run({
        id: profile.id,
        name: profile.name,
        enabled: profile.enabled ? 1 : 0,
        data: JSON.stringify(profile),
        created_at: profile.createdAt,
        updated_at: profile.updatedAt,
      });

    return profile;
  }

  createJob(input: { profileId: string; topic: string }): GenerationJob {
    const timestamp = nowIso();
    const job: GenerationJob = {
      id: nanoid(),
      profileId: input.profileId,
      topic: input.topic,
      status: 'drafting',
      scriptPackage: null,
      scriptMetadata: null,
      manualClipBundle: null,
      reviewPackage: null,
      publicationResults: [],
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.persistJob(job);
    return job;
  }

  findActiveJob(profileId: string, topic: string): GenerationJob | null {
    const row = this.database.connection
      .prepare(
        `
          SELECT * FROM jobs
          WHERE profile_id = ?
            AND lower(trim(topic)) = lower(trim(?))
            AND status IN (
              'drafting',
              'waiting_for_manual_clip',
              'review_pending',
              'approved',
              'publish_pending'
            )
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(profileId, topic) as JobRecord | undefined;

    if (!row) {
      return null;
    }

    return this.mapJob(row);
  }

  getJob(jobId: string): GenerationJob | null {
    const row = this.database.connection.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as
      | JobRecord
      | undefined;

    if (!row) {
      return null;
    }

    return this.mapJob(row);
  }

  listJobs(): GenerationJob[] {
    const rows = this.database.connection
      .prepare('SELECT * FROM jobs ORDER BY created_at DESC')
      .all() as JobRecord[];
    return rows.map((row) => this.mapJob(row));
  }

  listReviewJobs(): GenerationJob[] {
    const rows = this.database.connection
      .prepare(`
        SELECT * FROM jobs
        WHERE status IN ('review_pending', 'approved', 'publish_pending')
        ORDER BY updated_at DESC
      `)
      .all() as JobRecord[];
    return rows.map((row) => this.mapJob(row));
  }

  listHistory(): GenerationJob[] {
    const rows = this.database.connection
      .prepare(`
        SELECT * FROM jobs
        WHERE status IN ('published', 'publish_pending', 'failed')
        ORDER BY updated_at DESC
      `)
      .all() as JobRecord[];
    return rows.map((row) => this.mapJob(row));
  }

  updateJob(job: GenerationJob): GenerationJob {
    this.persistJob({
      ...job,
      updatedAt: nowIso(),
    });

    return this.getJob(job.id) ?? job;
  }

  addAudit(jobId: string | null, level: AuditEvent['level'], message: string): AuditEvent {
    const event: AuditEvent = {
      id: nanoid(),
      jobId,
      level,
      message,
      createdAt: nowIso(),
    };

    this.database.connection
      .prepare(`
        INSERT INTO audit_events (id, job_id, level, message, created_at)
        VALUES (@id, @job_id, @level, @message, @created_at)
      `)
      .run({
        id: event.id,
        job_id: event.jobId,
        level: event.level,
        message: event.message,
        created_at: event.createdAt,
      });

    return AuditEventSchema.parse(event);
  }

  listAudit(jobId?: string): AuditEvent[] {
    const query = jobId
      ? this.database.connection.prepare(
          'SELECT * FROM audit_events WHERE job_id = ? ORDER BY created_at DESC'
        )
      : this.database.connection.prepare('SELECT * FROM audit_events ORDER BY created_at DESC');

    const rows = (jobId ? query.all(jobId) : query.all()) as Array<{
      id: string;
      job_id: string | null;
      level: AuditEvent['level'];
      message: string;
      created_at: string;
    }>;

    return rows.map((row) =>
      AuditEventSchema.parse({
        id: row.id,
        jobId: row.job_id,
        level: row.level,
        message: row.message,
        createdAt: row.created_at,
      })
    );
  }

  getDashboardSummary(): DashboardSummary {
    const profiles = this.listProfiles();
    const jobs = this.listJobs();

    return DashboardSummarySchema.parse({
      totalProfiles: profiles.length,
      enabledProfiles: profiles.filter((profile) => profile.enabled).length,
      draftJobs: jobs.filter(
        (job) => job.status === 'drafting' || job.status === 'waiting_for_manual_clip'
      ).length,
      reviewPendingJobs: jobs.filter((job) => job.status === 'review_pending').length,
      publishedJobs: jobs.filter((job) => job.status === 'published').length,
    });
  }

  getPlatformConnection<T>(platform: Platform): T | null {
    const row = this.database.connection
      .prepare('SELECT data FROM platform_connections WHERE platform = ?')
      .get(platform) as { data: string } | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data) as T;
  }

  listPlatformConnections<T>(): Array<{
    platform: Platform;
    data: T;
    createdAt: string;
    updatedAt: string;
  }> {
    const rows = this.database.connection
      .prepare('SELECT * FROM platform_connections ORDER BY platform ASC')
      .all() as PlatformConnectionRecord[];

    return rows.map((row) => ({
      platform: row.platform,
      data: JSON.parse(row.data) as T,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  upsertPlatformConnection<T>(platform: Platform, data: T): void {
    const existing = this.database.connection
      .prepare('SELECT created_at FROM platform_connections WHERE platform = ?')
      .get(platform) as { created_at: string } | undefined;
    const timestamp = nowIso();

    this.database.connection
      .prepare(`
        INSERT INTO platform_connections (platform, data, created_at, updated_at)
        VALUES (@platform, @data, @created_at, @updated_at)
        ON CONFLICT(platform) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at
      `)
      .run({
        platform,
        data: JSON.stringify(data),
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      });
  }

  deletePlatformConnection(platform: Platform): void {
    this.database.connection
      .prepare('DELETE FROM platform_connections WHERE platform = ?')
      .run(platform);
  }

  getSchedulerState(): SchedulerState {
    const row = this.database.connection
      .prepare('SELECT data FROM scheduler_state WHERE id = ?')
      .get('primary') as { data: string } | undefined;

    if (!row) {
      return {
        lastTickStartedAt: null,
        lastTickCompletedAt: null,
        lastTickMessage: null,
      };
    }

    return {
      lastTickStartedAt: null,
      lastTickCompletedAt: null,
      lastTickMessage: null,
      ...(JSON.parse(row.data) as Partial<SchedulerState>),
    };
  }

  upsertSchedulerState(state: SchedulerState): void {
    const timestamp = nowIso();
    this.database.connection
      .prepare(`
        INSERT INTO scheduler_state (id, data, updated_at)
        VALUES (@id, @data, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at
      `)
      .run({
        id: 'primary',
        data: JSON.stringify(state),
        updated_at: timestamp,
      });
  }

  getSchedulerProfileResumeAt(profileId: string): string | null {
    const row = this.database.connection
      .prepare('SELECT resume_from FROM scheduler_profile_state WHERE profile_id = ?')
      .get(profileId) as SchedulerProfileStateRecord | undefined;

    return row?.resume_from ?? null;
  }

  upsertSchedulerProfileResumeAt(profileId: string, resumeAt: string): void {
    const timestamp = nowIso();
    this.database.connection
      .prepare(`
        INSERT INTO scheduler_profile_state (profile_id, resume_from, updated_at)
        VALUES (@profile_id, @resume_from, @updated_at)
        ON CONFLICT(profile_id) DO UPDATE SET
          resume_from = excluded.resume_from,
          updated_at = excluded.updated_at
      `)
      .run({
        profile_id: profileId,
        resume_from: resumeAt,
        updated_at: timestamp,
      });
  }

  ensureSchedulerRun(input: {
    profileId: string;
    topic: string;
    scheduledFor: string;
    maxAttempts: number;
  }): {
    run: SchedulerRun;
    created: boolean;
  } {
    const existing = this.database.connection
      .prepare('SELECT * FROM scheduler_runs WHERE profile_id = ? AND scheduled_for = ?')
      .get(input.profileId, input.scheduledFor) as SchedulerRunRecord | undefined;

    if (existing) {
      return {
        run: this.mapSchedulerRun(existing),
        created: false,
      };
    }

    const timestamp = nowIso();
    const run: SchedulerRun = {
      id: nanoid(),
      profileId: input.profileId,
      topic: input.topic,
      scheduledFor: input.scheduledFor,
      status: 'queued',
      attemptCount: 0,
      maxAttempts: input.maxAttempts,
      createdJobId: null,
      errorMessage: null,
      nextRetryAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.persistSchedulerRun(run);
    return {
      run,
      created: true,
    };
  }

  listDueSchedulerRuns(now: string, limit = 25): SchedulerRun[] {
    const rows = this.database.connection
      .prepare(
        `
          SELECT * FROM scheduler_runs
          WHERE
            (status = 'queued' AND scheduled_for <= @now)
            OR (status = 'retry_scheduled' AND next_retry_at IS NOT NULL AND next_retry_at <= @now)
          ORDER BY scheduled_for ASC, created_at ASC
          LIMIT @limit
        `
      )
      .all({
        now,
        limit,
      }) as SchedulerRunRecord[];

    return rows.map((row) => this.mapSchedulerRun(row));
  }

  listRecentSchedulerRuns(limit = 10): SchedulerRun[] {
    const rows = this.database.connection
      .prepare(
        `
          SELECT * FROM scheduler_runs
          ORDER BY updated_at DESC, scheduled_for DESC
          LIMIT ?
        `
      )
      .all(limit) as SchedulerRunRecord[];

    return rows.map((row) => this.mapSchedulerRun(row));
  }

  listRunningSchedulerRuns(): SchedulerRun[] {
    const rows = this.database.connection
      .prepare(
        `
          SELECT * FROM scheduler_runs
          WHERE status = 'running'
          ORDER BY updated_at DESC, scheduled_for DESC
        `
      )
      .all() as SchedulerRunRecord[];

    return rows.map((row) => this.mapSchedulerRun(row));
  }

  getSchedulerMetrics(): {
    queuedRuns: number;
    activeRuns: number;
    completedRuns24h: number;
    failedRuns24h: number;
  } {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const queuedRuns = this.database.connection
      .prepare(
        `SELECT COUNT(*) AS count FROM scheduler_runs WHERE status IN ('queued', 'retry_scheduled')`
      )
      .get() as { count: number };
    const activeRuns = this.database.connection
      .prepare(`SELECT COUNT(*) AS count FROM scheduler_runs WHERE status = 'running'`)
      .get() as { count: number };
    const completedRuns24h = this.database.connection
      .prepare(
        `SELECT COUNT(*) AS count FROM scheduler_runs WHERE status = 'completed' AND updated_at >= ?`
      )
      .get(cutoff) as { count: number };
    const failedRuns24h = this.database.connection
      .prepare(
        `SELECT COUNT(*) AS count FROM scheduler_runs WHERE status IN ('failed', 'skipped') AND updated_at >= ?`
      )
      .get(cutoff) as { count: number };

    return {
      queuedRuns: queuedRuns.count,
      activeRuns: activeRuns.count,
      completedRuns24h: completedRuns24h.count,
      failedRuns24h: failedRuns24h.count,
    };
  }

  claimSchedulerRun(runId: string): SchedulerRun | null {
    const startedAt = nowIso();
    const result = this.database.connection
      .prepare(
        `
          UPDATE scheduler_runs
          SET
            status = 'running',
            attempt_count = attempt_count + 1,
            started_at = @started_at,
            next_retry_at = NULL,
            updated_at = @started_at
          WHERE id = @id
            AND status IN ('queued', 'retry_scheduled')
        `
      )
      .run({
        id: runId,
        started_at: startedAt,
      });

    if (result.changes === 0) {
      return null;
    }

    return this.getSchedulerRun(runId);
  }

  getSchedulerRun(runId: string): SchedulerRun | null {
    const row = this.database.connection
      .prepare('SELECT * FROM scheduler_runs WHERE id = ?')
      .get(runId) as SchedulerRunRecord | undefined;

    return row ? this.mapSchedulerRun(row) : null;
  }

  completeSchedulerRun(runId: string, createdJobId: string | null): SchedulerRun | null {
    return this.updateSchedulerRunRecord(runId, {
      status: 'completed',
      created_job_id: createdJobId,
      error_message: null,
      next_retry_at: null,
      finished_at: nowIso(),
    });
  }

  skipSchedulerRun(runId: string, message: string): SchedulerRun | null {
    return this.updateSchedulerRunRecord(runId, {
      status: 'skipped',
      error_message: message,
      next_retry_at: null,
      finished_at: nowIso(),
    });
  }

  retrySchedulerRun(runId: string, message: string, nextRetryAt: string): SchedulerRun | null {
    return this.updateSchedulerRunRecord(runId, {
      status: 'retry_scheduled',
      error_message: message,
      next_retry_at: nextRetryAt,
      finished_at: null,
    });
  }

  failSchedulerRun(runId: string, message: string): SchedulerRun | null {
    return this.updateSchedulerRunRecord(runId, {
      status: 'failed',
      error_message: message,
      next_retry_at: null,
      finished_at: nowIso(),
    });
  }

  private persistJob(job: GenerationJob): void {
    this.database.connection
      .prepare(`
        INSERT INTO jobs (
          id,
          profile_id,
          topic,
          status,
          script_json,
          script_metadata_json,
          manual_clip_json,
          review_json,
          publication_json,
          error_message,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @profile_id,
          @topic,
          @status,
          @script_json,
          @script_metadata_json,
          @manual_clip_json,
          @review_json,
          @publication_json,
          @error_message,
          @created_at,
          @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          profile_id = excluded.profile_id,
          topic = excluded.topic,
          status = excluded.status,
          script_json = excluded.script_json,
          script_metadata_json = excluded.script_metadata_json,
          manual_clip_json = excluded.manual_clip_json,
          review_json = excluded.review_json,
          publication_json = excluded.publication_json,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at
      `)
      .run({
        id: job.id,
        profile_id: job.profileId,
        topic: job.topic,
        status: job.status,
        script_json: job.scriptPackage ? JSON.stringify(job.scriptPackage) : null,
        script_metadata_json: job.scriptMetadata ? JSON.stringify(job.scriptMetadata) : null,
        manual_clip_json: job.manualClipBundle ? JSON.stringify(job.manualClipBundle) : null,
        review_json: job.reviewPackage ? JSON.stringify(job.reviewPackage) : null,
        publication_json: JSON.stringify(job.publicationResults),
        error_message: job.errorMessage,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
      });
  }

  private persistSchedulerRun(run: SchedulerRun): void {
    this.database.connection
      .prepare(`
        INSERT INTO scheduler_runs (
          id,
          profile_id,
          topic,
          scheduled_for,
          status,
          attempt_count,
          max_attempts,
          created_job_id,
          error_message,
          next_retry_at,
          started_at,
          finished_at,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @profile_id,
          @topic,
          @scheduled_for,
          @status,
          @attempt_count,
          @max_attempts,
          @created_job_id,
          @error_message,
          @next_retry_at,
          @started_at,
          @finished_at,
          @created_at,
          @updated_at
        )
      `)
      .run({
        id: run.id,
        profile_id: run.profileId,
        topic: run.topic,
        scheduled_for: run.scheduledFor,
        status: run.status,
        attempt_count: run.attemptCount,
        max_attempts: run.maxAttempts,
        created_job_id: run.createdJobId,
        error_message: run.errorMessage,
        next_retry_at: run.nextRetryAt,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        created_at: run.createdAt,
        updated_at: run.updatedAt,
      });
  }

  private updateSchedulerRunRecord(
    runId: string,
    values: {
      status: SchedulerRunStatus;
      created_job_id?: string | null;
      error_message?: string | null;
      next_retry_at?: string | null;
      finished_at?: string | null;
    }
  ): SchedulerRun | null {
    const updatedAt = nowIso();
    this.database.connection
      .prepare(
        `
          UPDATE scheduler_runs
          SET
            status = @status,
            created_job_id = COALESCE(@created_job_id, created_job_id),
            error_message = @error_message,
            next_retry_at = @next_retry_at,
            finished_at = @finished_at,
            updated_at = @updated_at
          WHERE id = @id
        `
      )
      .run({
        id: runId,
        status: values.status,
        created_job_id: values.created_job_id,
        error_message: values.error_message ?? null,
        next_retry_at: values.next_retry_at ?? null,
        finished_at: values.finished_at ?? null,
        updated_at: updatedAt,
      });

    return this.getSchedulerRun(runId);
  }

  private mapJob(row: JobRecord): GenerationJob {
    const scriptPackage = row.script_json
      ? ScriptPackageSchema.parse(JSON.parse(row.script_json))
      : null;
    const scriptMetadata = row.script_metadata_json
      ? ScriptGenerationMetadataSchema.parse(JSON.parse(row.script_metadata_json))
      : null;
    const manualClipBundle = row.manual_clip_json
      ? ManualClipBundleSchema.parse(JSON.parse(row.manual_clip_json))
      : null;
    const reviewPackage = row.review_json
      ? ReviewPackageSchema.parse(JSON.parse(row.review_json))
      : null;

    return GenerationJobSchema.parse({
      id: row.id,
      profileId: row.profile_id,
      topic: row.topic,
      status: row.status,
      scriptPackage,
      scriptMetadata,
      manualClipBundle,
      reviewPackage,
      publicationResults: JSON.parse(row.publication_json) as PublicationResult[],
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private mapSchedulerRun(row: SchedulerRunRecord): SchedulerRun {
    return SchedulerRunSchema.parse({
      id: row.id,
      profileId: row.profile_id,
      topic: row.topic,
      scheduledFor: row.scheduled_for,
      status: row.status,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      createdJobId: row.created_job_id,
      errorMessage: row.error_message,
      nextRetryAt: row.next_retry_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
