import { access, readFile, stat } from 'node:fs/promises';

import type {
  GenerationJob,
  Platform,
  PlatformConnection,
  PlatformConnectionStatus,
  PublicationResult,
} from '@autom/contracts';

import { conflict } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';

export function createConnectionSummary(input: {
  platform: Platform;
  status: PlatformConnectionStatus;
  configured: boolean;
  connected: boolean;
  accountLabel?: string | null;
  connectedAt?: string | null;
  expiresAt?: string | null;
  message?: string | null;
}): PlatformConnection {
  return {
    platform: input.platform,
    status: input.status,
    configured: input.configured,
    connected: input.connected,
    accountLabel: input.accountLabel ?? null,
    connectedAt: input.connectedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    connectorMode: 'live',
    message: input.message ?? null,
  };
}

export function createPendingConfigurationResult(
  platform: Platform,
  message: string
): PublicationResult {
  return {
    platform,
    status: 'pending_configuration',
    externalId: null,
    publishedAt: null,
    message,
    connectorMode: 'live',
  };
}

export function createFailedPublicationResult(
  platform: Platform,
  message: string,
  externalId: string | null = null
): PublicationResult {
  return {
    platform,
    status: 'failed',
    externalId,
    publishedAt: null,
    message,
    connectorMode: 'live',
  };
}

export function createPendingProcessingResult(
  platform: Platform,
  externalId: string,
  message: string
): PublicationResult {
  return {
    platform,
    status: 'pending_processing',
    externalId,
    publishedAt: null,
    message,
    connectorMode: 'live',
  };
}

export function createPublishedResult(
  platform: Platform,
  externalId: string,
  message: string
): PublicationResult {
  return {
    platform,
    status: 'published',
    externalId,
    publishedAt: nowIso(),
    message,
    connectorMode: 'live',
  };
}

export function ensurePublishableArtifacts(job: GenerationJob): {
  videoPath: string;
  thumbnailPath: string | null;
} {
  const outputVideoPath = job.reviewPackage?.renderBundle.outputVideoPath;
  if (!outputVideoPath) {
    throw conflict(`Job ${job.id} does not have a rendered video available for publishing.`);
  }

  return {
    videoPath: outputVideoPath,
    thumbnailPath: job.reviewPackage?.renderBundle.thumbnailPath ?? null,
  };
}

export async function fileExists(path: string | null | undefined): Promise<boolean> {
  if (!path) {
    return false;
  }

  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readFileBuffer(path: string): Promise<Buffer> {
  return readFile(path);
}

export async function getFileSize(path: string): Promise<number> {
  const details = await stat(path);
  return details.size;
}

export async function readResponseMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string; code?: string };
      message?: string;
      error_description?: string;
      data?: { error_code?: string; description?: string };
    };

    return (
      payload.error?.message ??
      payload.error_description ??
      payload.message ??
      payload.data?.description ??
      payload.data?.error_code ??
      fallbackMessage
    );
  } catch {
    const text = await response.text().catch(() => '');
    return text.trim().length > 0 ? text.trim() : fallbackMessage;
  }
}

export function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function buildShortCaption(job: GenerationJob, maxLength: number): string {
  const scriptPackage = job.scriptPackage;
  const title = scriptPackage?.title ?? job.topic;
  const tags = (scriptPackage?.tags ?? []).slice(0, 4).map((tag) => `#${tag.replace(/\s+/g, '')}`);
  return truncateText([title, ...tags].join(' '), maxLength);
}

export function isExpired(expiresAt: string | null | undefined, skewMs = 30_000): boolean {
  if (!expiresAt) {
    return false;
  }

  return new Date(expiresAt).getTime() <= Date.now() + skewMs;
}

export function getRecordValue(
  value: unknown,
  key: string
): Record<string, unknown>[string] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

export function getNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function getStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
  );
}
