import cors from '@fastify/cors';
import Fastify from 'fastify';

import { registerRoutes } from './http/routes/index.js';
import { bootstrap } from './lib/bootstrap.js';
import type { CommandRunner } from './media/ffmpeg-renderer.js';
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
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('video/mp4', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  await registerRoutes(app, bootstrapResult);

  if (bootstrapResult.env.NODE_ENV !== 'test') {
    bootstrapResult.manualClipsService.start();
  }
  if (bootstrapResult.env.NODE_ENV !== 'test' && bootstrapResult.env.SCHEDULER_ENABLED) {
    bootstrapResult.schedulerService.start();
  }

  app.addHook('onClose', async () => {
    await bootstrapResult.manualClipsService.stop();
    await bootstrapResult.schedulerService.stop();
    bootstrapResult.repository.close();
  });

  return app;
}
