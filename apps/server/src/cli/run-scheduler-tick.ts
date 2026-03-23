import { bootstrap } from '../lib/bootstrap.js';

async function main(): Promise<void> {
  const context = await bootstrap();
  const overview = await context.schedulerService.runDueWork();
  console.log(JSON.stringify(overview, null, 2));
  await context.schedulerService.stop();
  context.repository.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
