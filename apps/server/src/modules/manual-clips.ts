import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppEnv, RuntimePaths } from '@autom/config';
import type { GenerationJob } from '@autom/contracts';

import { writeArtifactFile } from '../lib/artifacts.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import {
  probeVideoMetadata,
  validateManualClipMetadata,
} from '../lib/manual-clips.js';
import { nowIso } from '../lib/time.js';
import type { CommandRunner } from '../media/ffmpeg-renderer.js';
import type { AppRepository } from '../repositories/app-repository.js';
import type { AuditService } from './audit.js';
import type { WorkflowService } from './workflow.js';

const ALLOWED_MANUAL_CLIP_CONTENT_TYPES = new Set(['application/octet-stream', 'video/mp4']);
const MANUAL_CLIP_RECONCILE_INTERVAL_SECONDS = 15;
const MANUAL_CLIP_VALIDATION_TIMEOUT_MS = 30_000;

export class ManualClipsService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly inFlightResumes = new Set<string>();

  constructor(
    private readonly env: AppEnv,
    private readonly runtimePaths: RuntimePaths,
    private readonly repository: AppRepository,
    private readonly auditService: AuditService,
    private readonly workflowService: WorkflowService,
    private readonly runCommand: CommandRunner
  ) {}

  start(): void {
    if (this.timer || this.env.NODE_ENV === 'test') {
      return;
    }

    this.timer = setInterval(() => {
      void this.reconcileWaitingJobs();
    }, MANUAL_CLIP_RECONCILE_INTERVAL_SECONDS * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async uploadManualClip(input: {
    jobId: string;
    sceneOrder: number;
    contentType: string | null;
    originalFileName: string | null;
    body: Buffer;
  }): Promise<GenerationJob> {
    const job = this.repository.getJob(input.jobId);
    if (!job) {
      throw notFound(`Job ${input.jobId} not found.`);
    }

    if (job.status !== 'waiting_for_manual_clip') {
      throw conflict(`Job ${job.id} is not waiting for a manual clip upload.`);
    }

    const bundle = job.manualClipBundle;
    const request = bundle?.requests.find((candidate) => candidate.sceneOrder === input.sceneOrder);
    if (!bundle || !request) {
      throw notFound(`Manual clip scene ${input.sceneOrder} was not requested for this job.`);
    }

    if (request.status === 'uploaded') {
      throw conflict(`Manual clip for scene ${input.sceneOrder} has already been uploaded.`);
    }

    if (!isAllowedManualClipContentType(input.contentType)) {
      throw badRequest('Manual clip upload must be an MP4 video.');
    }

    if (input.body.byteLength === 0) {
      throw badRequest('Manual clip upload cannot be empty.');
    }

    const outputPath = join(this.runtimePaths.manualClipDirectory, job.id, `scene-${input.sceneOrder}.mp4`);
    await mkdir(join(this.runtimePaths.manualClipDirectory, job.id), { recursive: true });
    await writeArtifactFile(outputPath, input.body);

    try {
      const metadata = await probeVideoMetadata(
        this.runCommand,
        this.env.FFPROBE_PATH,
        outputPath,
        this.runtimePaths.manualClipDirectory
      );
      validateManualClipMetadata({
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        request,
      });

      const updatedJob = this.repository.updateJob({
        ...job,
        manualClipBundle: updateManualClipBundle(job, {
          sceneOrder: request.sceneOrder,
          status: 'uploaded',
          assetPath: outputPath,
          contentType: input.contentType,
          originalFileName: input.originalFileName,
          measuredDurationSeconds: metadata.durationSeconds,
          uploadedAt: nowIso(),
          validatedAt: nowIso(),
          errorMessage: null,
        }),
        errorMessage: null,
      });

      this.auditService.info(
        job.id,
        `Manual clip uploaded for scene ${input.sceneOrder} and validated at ${metadata.durationSeconds.toFixed(
          2
        )}s.`
      );

      await this.resumeIfReady(job.id);
      return this.repository.getJob(job.id) ?? updatedJob;
    } catch (error) {
      await rm(outputPath, { force: true });
      const message = error instanceof Error ? error.message : 'Manual clip validation failed.';
      this.auditService.error(job.id, message);
      throw error;
    }
  }

  async resumeIfReady(
    jobId: string,
    options?: {
      allowDrafting?: boolean;
    }
  ): Promise<void> {
    if (this.inFlightResumes.has(jobId)) {
      return;
    }

    const job = this.repository.getJob(jobId);
    if (!job || !job.manualClipBundle) {
      return;
    }

    const canResume =
      job.status === 'waiting_for_manual_clip' ||
      (options?.allowDrafting === true && job.status === 'drafting');
    if (!canResume) {
      return;
    }

    const bundle = job.manualClipBundle;
    const now = Date.now();
    const allUploaded = bundle.requests.every((request) => request.status === 'uploaded');
    const expiredRequests = bundle.requests.filter((request) => {
      const expiresAt = Date.parse(request.expiresAt);
      return request.status === 'pending' && Number.isFinite(expiresAt) && expiresAt <= now;
    });

    if (!allUploaded && expiredRequests.length === 0) {
      return;
    }

    this.inFlightResumes.add(jobId);
    try {
      const nextJob = this.repository.updateJob({
        ...job,
        status: 'drafting',
        manualClipBundle:
          expiredRequests.length > 0
            ? updateManualClipBundle(job, {
                expiredSceneOrders: expiredRequests.map((request) => request.sceneOrder),
              })
            : job.manualClipBundle,
        errorMessage: null,
      });

      if (expiredRequests.length > 0) {
        this.auditService.warn(
          jobId,
          `Manual clip wait window expired for scene${expiredRequests.length === 1 ? '' : 's'} ${expiredRequests
            .map((request) => request.sceneOrder)
            .join(', ')}. Falling back to Pexels.`
        );
      } else {
        this.auditService.info(jobId, 'All manual clips uploaded. Resuming workflow.');
      }

      await this.workflowService.resumeManualClipJob(nextJob.id);
    } finally {
      this.inFlightResumes.delete(jobId);
    }
  }

  private async reconcileWaitingJobs(): Promise<void> {
    const waitingJobs = this.repository
      .listJobs()
      .filter((job) => job.status === 'waiting_for_manual_clip' && job.manualClipBundle);

    for (const job of waitingJobs) {
      await this.resumeIfReady(job.id);
    }
  }

  async resumeInterruptedJobs(): Promise<void> {
    const interruptedJobs = this.repository
      .listJobs()
      .filter(
        (job) =>
          job.manualClipBundle &&
          (job.status === 'waiting_for_manual_clip' || job.status === 'drafting')
      );

    for (const job of interruptedJobs) {
      await this.resumeIfReady(job.id, { allowDrafting: true });
    }
  }
}

function isAllowedManualClipContentType(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    ALLOWED_MANUAL_CLIP_CONTENT_TYPES.has(normalized) || normalized.startsWith('video/')
  );
}

function updateManualClipBundle(
  job: GenerationJob,
  patch: {
    sceneOrder?: number;
    status?: 'pending' | 'uploaded' | 'expired';
    assetPath?: string | null;
    contentType?: string | null;
    originalFileName?: string | null;
    measuredDurationSeconds?: number | null;
    uploadedAt?: string | null;
    validatedAt?: string | null;
    errorMessage?: string | null;
    expiredSceneOrders?: number[];
  }
) {
  const bundle = job.manualClipBundle;
  if (!bundle) {
    return null;
  }

  const now = nowIso();
  const nextRequests = bundle.requests.map((request) => {
    if (patch.sceneOrder !== undefined && request.sceneOrder !== patch.sceneOrder) {
      return request;
    }

    if (
      patch.expiredSceneOrders &&
      !patch.expiredSceneOrders.includes(request.sceneOrder) &&
      patch.sceneOrder === undefined
    ) {
      return request;
    }

    if (patch.expiredSceneOrders?.includes(request.sceneOrder)) {
      return {
        ...request,
        status: 'expired' as const,
        errorMessage: patch.errorMessage ?? 'Manual clip wait window expired.',
      };
    }

    return {
      ...request,
      status: patch.status ?? request.status,
      assetPath: patch.assetPath ?? request.assetPath,
      contentType: patch.contentType ?? request.contentType,
      originalFileName: patch.originalFileName ?? request.originalFileName,
      measuredDurationSeconds:
        patch.measuredDurationSeconds ?? request.measuredDurationSeconds,
      uploadedAt: patch.uploadedAt ?? request.uploadedAt,
      validatedAt: patch.validatedAt ?? request.validatedAt,
      errorMessage: patch.errorMessage ?? request.errorMessage,
    };
  });

  return {
    ...bundle,
    requests: nextRequests,
    updatedAt: now,
  };
}
