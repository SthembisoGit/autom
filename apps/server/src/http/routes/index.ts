import type { FastifyInstance } from 'fastify';

import type { AppServices } from '../../lib/bootstrap.js';
import { registerDashboardRoutes } from './dashboard.js';
import { registerJobRoutes } from './jobs.js';
import { registerProfileRoutes } from './profiles.js';
import { registerPublicationRoutes } from './publications.js';
import { registerReviewRoutes } from './reviews.js';
import { registerSchedulerRoutes } from './scheduler.js';

export async function registerRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/', async () => ({
    ok: true,
    message: 'autoM server is running.',
    health: '/health',
  }));

  app.get('/health', async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
  }));

  await registerDashboardRoutes(app, services);
  await registerProfileRoutes(app, services);
  await registerJobRoutes(app, services);
  await registerReviewRoutes(app, services);
  await registerPublicationRoutes(app, services);
  await registerSchedulerRoutes(app, services);
}
