import { ReviewDecisionRequestSchema } from '@autom/contracts';
import type { FastifyInstance } from 'fastify';

import type { AppServices } from '../../lib/bootstrap.js';
import { sendServiceError, sendValidationError } from '../send-error.js';

export async function registerReviewRoutes(
  app: FastifyInstance,
  services: AppServices
): Promise<void> {
  app.get('/reviews', async () => services.reviewsService.list());

  app.post('/reviews/:jobId/approve', async (request, reply) => {
    const params = request.params as { jobId: string };
    const parsed = ReviewDecisionRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    try {
      return services.reviewsService.approve(params.jobId, parsed.data.note);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to approve review.');
    }
  });

  app.post('/reviews/:jobId/reject', async (request, reply) => {
    const params = request.params as { jobId: string };
    const parsed = ReviewDecisionRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    try {
      return services.reviewsService.reject(params.jobId, parsed.data.note);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to reject review.');
    }
  });
}
