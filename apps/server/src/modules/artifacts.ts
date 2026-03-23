import { access } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { RuntimePaths } from '@autom/config';
import type { ReviewPackage } from '@autom/contracts';

import type { AppRepository } from '../repositories/app-repository.js';

export type RenderArtifactKind = 'video' | 'subtitles' | 'thumbnail';
export type LocalPublicationArtifactKind = 'video' | 'thumbnail' | 'manifest';

export type ArtifactDescriptor = {
  path: string;
  contentType: string;
  filename: string;
};

export class ArtifactsService {
  constructor(
    private readonly repository: AppRepository,
    private readonly runtimePaths: RuntimePaths
  ) {}

  async getRenderArtifact(
    jobId: string,
    artifact: RenderArtifactKind
  ): Promise<ArtifactDescriptor | null> {
    const job = this.repository.getJob(jobId);
    const renderBundle = job?.reviewPackage?.renderBundle;
    if (!renderBundle) {
      return null;
    }

    const descriptor = this.createRenderArtifactDescriptor(renderBundle, artifact);
    if (!descriptor) {
      return null;
    }

    return this.ensureArtifact(descriptor, this.runtimePaths.outputDirectory);
  }

  async getLocalPublicationArtifact(
    jobId: string,
    artifact: LocalPublicationArtifactKind
  ): Promise<ArtifactDescriptor | null> {
    const job = this.repository.getJob(jobId);
    const hasLocalPublication = job?.publicationResults.some(
      (result) => result.platform === 'local' && result.status === 'published'
    );
    if (!hasLocalPublication) {
      return null;
    }

    const descriptor = this.createLocalPublicationDescriptor(jobId, artifact);
    return this.ensureArtifact(descriptor, this.runtimePaths.publishedDirectory);
  }

  private createRenderArtifactDescriptor(
    renderBundle: ReviewPackage['renderBundle'],
    artifact: RenderArtifactKind
  ): ArtifactDescriptor | null {
    if (artifact === 'video') {
      return {
        path: renderBundle.outputVideoPath,
        contentType: 'video/mp4',
        filename: 'preview.mp4',
      };
    }

    if (artifact === 'subtitles') {
      return {
        path: renderBundle.subtitlesPath,
        contentType: 'application/x-subrip',
        filename: 'captions.srt',
      };
    }

    if (!renderBundle.thumbnailPath) {
      return null;
    }

    return {
      path: renderBundle.thumbnailPath,
      contentType: 'image/jpeg',
      filename: 'thumbnail.jpg',
    };
  }

  private createLocalPublicationDescriptor(
    jobId: string,
    artifact: LocalPublicationArtifactKind
  ): ArtifactDescriptor {
    const archiveDirectory = join(this.runtimePaths.publishedDirectory, 'local', jobId);
    if (artifact === 'video') {
      return {
        path: join(archiveDirectory, 'video.mp4'),
        contentType: 'video/mp4',
        filename: 'video.mp4',
      };
    }

    if (artifact === 'thumbnail') {
      return {
        path: join(archiveDirectory, 'thumbnail.jpg'),
        contentType: 'image/jpeg',
        filename: 'thumbnail.jpg',
      };
    }

    return {
      path: join(archiveDirectory, 'publication.json'),
      contentType: 'application/json; charset=utf-8',
      filename: 'publication.json',
    };
  }

  private async ensureArtifact(
    descriptor: ArtifactDescriptor,
    rootDirectory: string
  ): Promise<ArtifactDescriptor | null> {
    const resolvedRoot = resolve(rootDirectory);
    const resolvedPath = resolve(descriptor.path);
    const relativePath = relative(resolvedRoot, resolvedPath);

    if (
      relativePath.length === 0 ||
      (!relativePath.startsWith('..') && !isAbsolute(relativePath))
    ) {
      try {
        await access(resolvedPath);
        return {
          ...descriptor,
          path: resolvedPath,
        };
      } catch {
        return null;
      }
    }

    return null;
  }
}
