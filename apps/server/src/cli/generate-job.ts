import { bootstrap } from '../lib/bootstrap.js';

async function main(): Promise<void> {
  const [profileId, ...topicParts] = process.argv.slice(2);
  const topic = topicParts.join(' ').trim();

  if (!profileId || !topic) {
    console.error(
      'Usage: npm --workspace @autom/server exec tsx src/cli/generate-job.ts <profileId> <topic>'
    );
    process.exit(1);
  }

  const context = await bootstrap();
  const job = await context.workflowService.generate({
    profileId,
    topic,
  });
  console.log(JSON.stringify(job, null, 2));
  context.repository.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
