import { createReadStream } from 'node:fs';

import { CreateJobRequestSchema } from '@autom/contracts';
import type { FastifyInstance } from 'fastify';

import type { AppServices } from '../../lib/bootstrap.js';
import { sendServiceError, sendValidationError } from '../send-error.js';

export async function registerJobRoutes(
  app: FastifyInstance,
  services: AppServices
): Promise<void> {
  app.post('/jobs/generate', async (request, reply) => {
    const parsed = CreateJobRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    try {
      return await services.workflowService.generate(parsed.data);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to generate job.');
    }
  });

  app.get('/jobs/monitor', async (_request, reply) => {
    try {
      return services.jobsService.getMonitor();
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to load job progress monitor.');
    }
  });

  app.get('/jobs/:jobId', async (request, reply) => {
    const params = request.params as { jobId: string };
    const detail = services.jobsService.getDetail(params.jobId);

    if (!detail) {
      reply.code(404);
      return { message: 'Job not found.' };
    }

    return detail;
  });

  app.post('/jobs/:jobId/retry', async (request, reply) => {
    const params = request.params as { jobId: string };

    try {
      return await services.jobsService.retry(params.jobId);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to retry job.');
    }
  });

  app.post('/jobs/:jobId/cancel', async (request, reply) => {
    const params = request.params as { jobId: string };

    try {
      return services.jobsService.cancel(params.jobId);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to cancel job.');
    }
  });

  app.post('/jobs/:jobId/archive', async (request, reply) => {
    const params = request.params as { jobId: string };

    try {
      return services.jobsService.archive(params.jobId);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to archive job.');
    }
  });

  app.get('/jobs/:jobId/artifacts/render/:artifact', async (request, reply) => {
    const params = request.params as { jobId: string; artifact: string };
    const artifact = parseRenderArtifact(params.artifact);
    if (!artifact) {
      reply.code(404);
      return { message: 'Artifact not found.' };
    }

    try {
      const descriptor = await services.artifactsService.getRenderArtifact(params.jobId, artifact);
      if (!descriptor) {
        reply.code(404);
        return { message: 'Artifact not found.' };
      }

      reply.header('Content-Disposition', `inline; filename="${descriptor.filename}"`);
      reply.type(descriptor.contentType);
      return reply.send(createReadStream(descriptor.path));
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to load render artifact.');
    }
  });

  app.get('/jobs/:jobId/artifacts/publications/local/:artifact', async (request, reply) => {
    const params = request.params as { jobId: string; artifact: string };
    const artifact = parseLocalPublicationArtifact(params.artifact);
    if (!artifact) {
      reply.code(404);
      return { message: 'Artifact not found.' };
    }

    try {
      const descriptor = await services.artifactsService.getLocalPublicationArtifact(
        params.jobId,
        artifact
      );
      if (!descriptor) {
        reply.code(404);
        return { message: 'Artifact not found.' };
      }

      reply.header('Content-Disposition', `inline; filename="${descriptor.filename}"`);
      reply.type(descriptor.contentType);
      return reply.send(createReadStream(descriptor.path));
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to load local publication artifact.');
    }
  });
}

function parseRenderArtifact(value: string): 'video' | 'subtitles' | 'thumbnail' | null {
  return value === 'video' || value === 'subtitles' || value === 'thumbnail' ? value : null;
}

function parseLocalPublicationArtifact(value: string): 'video' | 'thumbnail' | 'manifest' | null {
  return value === 'video' || value === 'thumbnail' || value === 'manifest' ? value : null;
}
