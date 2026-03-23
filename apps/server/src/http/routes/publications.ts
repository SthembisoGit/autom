import { PlatformSchema, PublishJobRequestSchema } from '@autom/contracts';
import type { FastifyInstance } from 'fastify';

import type { AppServices } from '../../lib/bootstrap.js';
import { sendServiceError, sendValidationError } from '../send-error.js';

export async function registerPublicationRoutes(
  app: FastifyInstance,
  services: AppServices
): Promise<void> {
  app.get('/publications/connections', async (_request, reply) => {
    try {
      return await services.publicationsService.listConnections();
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to load publishing connections.');
    }
  });

  app.get('/publications/connections/:platform/start', async (request, reply) => {
    const params = request.params as { platform: string };
    const query = request.query as { format?: string } | undefined;
    const platform = PlatformSchema.safeParse(params.platform);
    if (!platform.success) {
      return sendValidationError(reply, platform.error.flatten());
    }

    try {
      const authorizationUrl = await services.publicationsService.getAuthorizationUrl(
        platform.data
      );
      if (query?.format === 'json') {
        return { authorizationUrl };
      }

      return reply.redirect(authorizationUrl);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to start platform connection.');
    }
  });

  app.get('/publications/connections/:platform/callback', async (request, reply) => {
    const params = request.params as { platform: string };
    const query = request.query as
      | {
          code?: string;
          state?: string;
          error?: string;
          error_description?: string;
          format?: string;
        }
      | undefined;
    const platform = PlatformSchema.safeParse(params.platform);
    if (!platform.success) {
      return sendValidationError(reply, platform.error.flatten());
    }

    try {
      const connection = await services.publicationsService.completeAuthorization(platform.data, {
        code: query?.code,
        state: query?.state,
        error: query?.error,
        errorDescription: query?.error_description,
      });

      if (query?.format === 'json') {
        return connection;
      }

      reply.type('text/html; charset=utf-8');
      return renderCallbackPage({
        ok: true,
        platform: platform.data,
        message: `${platform.data} connected successfully.`,
      });
    } catch (error) {
      if (query?.format === 'json') {
        return sendServiceError(reply, error, 'Unable to complete platform connection.');
      }

      const message =
        error instanceof Error ? error.message : 'Unable to complete platform connection.';
      reply.code(400).type('text/html; charset=utf-8');
      return renderCallbackPage({
        ok: false,
        platform: platform.data,
        message,
      });
    }
  });

  app.delete('/publications/connections/:platform', async (request, reply) => {
    const params = request.params as { platform: string };
    const platform = PlatformSchema.safeParse(params.platform);
    if (!platform.success) {
      return sendValidationError(reply, platform.error.flatten());
    }

    try {
      return await services.publicationsService.disconnect(platform.data);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to disconnect platform.');
    }
  });

  app.post('/publications/:jobId/publish', async (request, reply) => {
    const params = request.params as { jobId: string };
    const parsed = PublishJobRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    try {
      return await services.publicationsService.publish(params.jobId, parsed.data.targets);
    } catch (error) {
      return sendServiceError(reply, error, 'Unable to publish job.');
    }
  });

  app.get('/history', async () => services.jobsService.listHistory());
}

function renderCallbackPage(input: {
  ok: boolean;
  platform: string;
  message: string;
}): string {
  const title = input.ok ? 'Connection completed' : 'Connection failed';
  const serializedPayload = serializeForInlineScript({
    source: 'autom-publication-connection',
    ok: input.ok,
    platform: input.platform,
    message: input.message,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; }
      body { margin: 0; background: #ffffff; color: #0a0a0a; }
      main { max-width: 540px; margin: 80px auto; padding: 32px; border: 1px solid #d1d5db; border-radius: 18px; }
      h1 { margin-top: 0; }
      p { color: #4b5563; }
      .tone-ok { color: #127a5a; }
      .tone-error { color: #b42318; }
    </style>
  </head>
  <body>
    <main>
      <p>${escapeHtml(input.platform)}</p>
      <h1 class="${input.ok ? 'tone-ok' : 'tone-error'}">${escapeHtml(title)}</h1>
      <p>${escapeHtml(input.message)}</p>
      <p>You can close this window and return to the ops console.</p>
    </main>
    <script>
      const payload = ${serializedPayload};
      if (window.opener) {
        window.opener.postMessage(payload, '*');
        window.close();
      }
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
