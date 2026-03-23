import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { RuntimePaths } from '@autom/config';

import { writeArtifactFile } from '../lib/artifacts.js';
import { badRequest } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import type { Publisher } from '../lib/types.js';
import {
  createConnectionSummary,
  createFailedPublicationResult,
  createPublishedResult,
  ensurePublishableArtifacts,
  fileExists,
} from './common.js';

export class LocalPublisher implements Publisher {
  readonly platform = 'local' as const;

  constructor(private readonly runtimePaths: RuntimePaths) {}

  async getConnection() {
    return createConnectionSummary({
      platform: this.platform,
      status: 'connected',
      configured: true,
      connected: true,
      accountLabel: 'Local Archive',
      connectedAt: null,
      expiresAt: null,
      message: 'Approved videos are archived locally for testing.',
    });
  }

  async getAuthorizationUrl(): Promise<string> {
    throw badRequest('Local Archive does not require authorization.');
  }

  async completeAuthorization() {
    return this.getConnection();
  }

  async disconnect() {
    return this.getConnection();
  }

  async publish(job: Parameters<Publisher['publish']>[0]) {
    try {
      const { videoPath, thumbnailPath } = ensurePublishableArtifacts(job);
      const subtitlesPath = job.reviewPackage?.renderBundle.subtitlesPath ?? null;

      if (!(await fileExists(videoPath))) {
        return createFailedPublicationResult(
          this.platform,
          'The rendered video file is missing from disk and cannot be archived.'
        );
      }

      if (!subtitlesPath || !(await fileExists(subtitlesPath))) {
        return createFailedPublicationResult(
          this.platform,
          'The rendered subtitles file is missing from disk and cannot be archived.'
        );
      }

      const archiveDirectory = join(this.runtimePaths.publishedDirectory, this.platform, job.id);
      await mkdir(archiveDirectory, { recursive: true });

      const archivedVideoPath = join(archiveDirectory, 'video.mp4');
      const archivedSubtitlesPath = join(archiveDirectory, 'captions.srt');
      const archivedThumbnailPath = join(archiveDirectory, 'thumbnail.jpg');
      const archivedManifestPath = join(archiveDirectory, 'publication.json');

      await copyFile(videoPath, archivedVideoPath);
      await copyFile(subtitlesPath, archivedSubtitlesPath);

      const archivedThumbnail = thumbnailPath && (await fileExists(thumbnailPath));
      if (archivedThumbnail && thumbnailPath) {
        await copyFile(thumbnailPath, archivedThumbnailPath);
      }

      await writeArtifactFile(
        archivedManifestPath,
        JSON.stringify(
          {
            platform: this.platform,
            destinationLabel: 'Local Archive',
            jobId: job.id,
            topic: job.topic,
            archivedAt: nowIso(),
            source: {
              videoPath,
              subtitlesPath,
              thumbnailPath: thumbnailPath ?? null,
            },
            archivedFiles: {
              videoPath: archivedVideoPath,
              subtitlesPath: archivedSubtitlesPath,
              thumbnailPath: archivedThumbnail ? archivedThumbnailPath : null,
            },
          },
          null,
          2
        )
      );

      return createPublishedResult(
        this.platform,
        `local_${job.id}`,
        'Archived to Local Archive for in-app testing.'
      );
    } catch (error) {
      return createFailedPublicationResult(
        this.platform,
        error instanceof Error ? error.message : 'Local archive publishing failed.'
      );
    }
  }
}
