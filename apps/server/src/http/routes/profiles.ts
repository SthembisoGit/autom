import { UpsertProfileRequestSchema } from '@autom/contracts';
import type { FastifyInstance } from 'fastify';

import type { AppServices } from '../../lib/bootstrap.js';
import { sendValidationError } from '../send-error.js';

export async function registerProfileRoutes(
  app: FastifyInstance,
  services: AppServices
): Promise<void> {
  app.get('/profiles/schema', async () => ({
    required: [
      'name',
      'niche',
      'tone',
      'visualStyle',
      'promptDirectives',
      'sceneCount',
      'maxDurationSeconds',
      'contentMode',
      'callToActionStyle',
      'callToActionTemplate',
      'callToActionGuardrails',
      'scheduleCron',
      'targetPlatforms',
      'defaultVoice',
    ],
    optional: [
      'preferredTopics',
      'bannedTopics',
      'bannedTerms',
      'defaultHashtags',
      'topicSource',
      'affiliateLinkTemplate',
      'requireAffiliateDisclosure',
      'affiliateDisclosureTemplate',
      'dialogueCharacterPresetId',
      'dialogueHostAName',
      'dialogueHostBName',
      'dialogueVoiceA',
      'dialogueVoiceB',
    ],
    availableTargetPlatforms: services.profilesService.listAvailablePlatforms(),
  }));

  app.get('/profiles', async () => services.profilesService.list());

  app.put('/profiles/:profileId', async (request, reply) => {
    const params = request.params as { profileId: string };
    const parsed = UpsertProfileRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.flatten());
    }

    return services.profilesService.upsert(params.profileId, parsed.data);
  });
}
