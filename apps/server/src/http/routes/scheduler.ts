import type { FastifyInstance } from 'fastify';

import type { AppServices } from '../../lib/bootstrap.js';
import { sendServiceError } from '../send-error.js';

export async function registerSchedulerRoutes(
  app: FastifyInstance,
  services: AppServices
): Promise<void> {
  app.get('/scheduler', async (_request, reply) => {
    try {
      return services.schedulerService.getOverview();
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to load scheduler overview.');
    }
  });

  app.post('/scheduler/run', async (_request, reply) => {
    try {
      return await services.schedulerService.runDueWork();
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to run scheduler tick.');
    }
  });

  app.post('/scheduler/runs/:runId/cancel', async (request, reply) => {
    const params = request.params as { runId: string };

    try {
      return services.schedulerService.cancelRun(params.runId);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to cancel scheduler run.');
    }
  });
}
