import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { loadEnv } from '@autom/config';

import { bootstrap } from '../lib/bootstrap.js';
import { ensureRuntimePaths, resolveDatabasePath } from '../lib/runtime.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const runtimePaths = await ensureRuntimePaths(env);
  const databasePath = resolveDatabasePath(env.DATABASE_URL);
  const databaseDirectory = dirname(databasePath);

  try {
    await Promise.all([
      rm(databaseDirectory, { recursive: true, force: true }),
      rm(runtimePaths.tempDirectory, { recursive: true, force: true }),
      rm(runtimePaths.outputDirectory, { recursive: true, force: true }),
      rm(runtimePaths.logDirectory, { recursive: true, force: true }),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'EBUSY' || error.code === 'EPERM')
    ) {
      throw new Error(
        'Local reset could not remove the SQLite files because they are in use. Stop the running autoM server processes and run `npm run reset:dev` again.'
      );
    }

    throw error;
  }

  await ensureRuntimePaths(env);

  const context = await bootstrap();

  try {
    const profiles = context.profilesService.list();
    console.log(
      JSON.stringify(
        {
          message: 'Local data reset.',
          databasePath,
          mediaRoot: runtimePaths.mediaRoot,
          profileCount: profiles.length,
          profiles: profiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
            enabled: profile.enabled,
          })),
        },
        null,
        2
      )
    );
  } finally {
    context.repository.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
