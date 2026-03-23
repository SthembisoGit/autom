import { bootstrap } from '../lib/bootstrap.js';

async function main(): Promise<void> {
  const context = await bootstrap();

  try {
    const profiles = context.profilesService.list();
    console.log(
      JSON.stringify(
        {
          message: 'Local data seeded.',
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
