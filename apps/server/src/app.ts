import cors from '@fastify/cors';
import Fastify from 'fastify';

import { registerRoutes } from './http/routes/index.js';
import { bootstrap } from './lib/bootstrap.js';
import type {
  MediaRenderer,
  NewsProvider,
  Publisher,
  ScriptProvider,
  TranscriptionProvider,
  VisualProvider,
  VoiceProvider,
} from './lib/types.js';
import type { CommandRunner } from './media/ffmpeg-renderer.js';

export async function createApp(options?: {
  env?: NodeJS.ProcessEnv;
  mediaRenderer?: MediaRenderer;
  publishers?: Publisher[];
  newsProvider?: NewsProvider;
  scriptProvider?: ScriptProvider;
  voiceProvider?: VoiceProvider;
  transcriptionProvider?: TranscriptionProvider;
  visualProvider?: VisualProvider;
  commandRunner?: CommandRunner;
}) {
  const app = Fastify({
    logger: false,
    bodyLimit: 100 * 1024 * 1024,
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
