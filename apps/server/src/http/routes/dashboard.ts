import type { FastifyInstance } from 'fastify';

import type { AppServices } from '../../lib/bootstrap.js';

export async function registerDashboardRoutes(
  app: FastifyInstance,
  services: AppServices
): Promise<void> {
  app.get('/dashboard', async () => services.jobsService.getDashboardSummary());
}
