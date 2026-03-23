import { loadEnv } from '@autom/config';

import { createApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await createApp();
  await app.listen({
    host: '0.0.0.0',
    port: env.APP_PORT,
  });
  console.log(`The server is running on port ${env.APP_PORT}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
