import cors from '@fastify/cors';
import Fastify from 'fastify';

import { registerRoutes } from './http/routes/index.js';
import { bootstrap } from './lib/bootstrap.js';
import type {
  MediaRenderer,
  Publisher,
  ScriptProvider,
  VisualProvider,
  VoiceProvider,
} from './lib/types.js';

export async function createApp(options?: {
  env?: NodeJS.ProcessEnv;
  mediaRenderer?: MediaRenderer;
  publishers?: Publisher[];
  scriptProvider?: ScriptProvider;
  voiceProvider?: VoiceProvider;
  visualProvider?: VisualProvider;
}) {
  const app = Fastify({
    logger: false,
  });
  const bootstrapResult = await bootstrap(options);
  const corsOrigin =
    bootstrapResult.env.NODE_ENV === 'production'
      ? async (origin: string | undefined) => {
          if (!origin) {
            return false;
          }

          return origin === bootstrapResult.env.OPS_URL ? origin : false;
        }
      : true;

  await app.register(cors, {
    origin: corsOrigin,
  });
  await registerRoutes(app, bootstrapResult);

  if (bootstrapResult.env.NODE_ENV !== 'test' && bootstrapResult.env.SCHEDULER_ENABLED) {
    bootstrapResult.schedulerService.start();
  }

  app.addHook('onClose', async () => {
    await bootstrapResult.schedulerService.stop();
    bootstrapResult.repository.close();
  });

  return app;
}
