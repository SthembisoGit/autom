import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import type { AppEnv, RuntimePaths } from '@autom/config';
import { resolveRuntimePaths } from '@autom/config';

export async function ensureRuntimePaths(env: AppEnv): Promise<RuntimePaths> {
  const resolvedMediaRoot = isAbsolute(env.MEDIA_ROOT)
    ? env.MEDIA_ROOT
    : join(process.cwd(), env.MEDIA_ROOT);
  const paths = resolveRuntimePaths(resolvedMediaRoot);

  await Promise.all([
    mkdir(paths.dbDirectory, { recursive: true }),
    mkdir(paths.tempDirectory, { recursive: true }),
    mkdir(paths.outputDirectory, { recursive: true }),
    mkdir(paths.publishedDirectory, { recursive: true }),
    mkdir(paths.logDirectory, { recursive: true }),
    mkdir(paths.manualClipDirectory, { recursive: true }),
    mkdir(dirname(resolveDatabasePath(env.DATABASE_URL)), { recursive: true }),
  ]);

  return paths;
}

export function resolveDatabasePath(databaseUrl: string): string {
  return isAbsolute(databaseUrl) ? databaseUrl : join(process.cwd(), databaseUrl);
}
