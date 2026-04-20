import type { ContentProfile } from '@autom/contracts';

import { nowIso } from './time.js';

type DefaultProfileSignature = Pick<
  ContentProfile,
  | 'name'
  | 'niche'
  | 'tone'
  | 'visualStyle'
  | 'promptDirectives'
  | 'preferredTopics'
  | 'bannedTopics'
  | 'bannedTerms'
  | 'defaultHashtags'
  | 'callToActionStyle'
  | 'callToActionTemplate'
  | 'callToActionGuardrails'
>;

const UPGRADABLE_DEFAULT_PROFILE_SIGNATURES: DefaultProfileSignature[] = [];

export function createDefaultProfile(
  targetPlatforms: ContentProfile['targetPlatforms'] = ['local']
): ContentProfile {
  const timestamp = nowIso();

  return {
    id: 'profile_default',
    name: 'autoM Media',
    niche: 'Fascinating stories, hidden knowledge, and clever ideas',
    tone: 'simple, engaging, curious, and clear',
    visualStyle:
      'cinematic b-roll, archival footage, news graphics, data visualizations, and dynamic text',
    promptDirectives:
      'Your main task is to create a compelling, easy-to-understand video script for one of the supplied categories. Focus on great storytelling that will make someone watch the entire video. Use simple English. For business ideas, be specific and clever, not generic. For facts, find a surprising hook. For history, reveal something interesting. For news, explain a major trending story simply and clearly. CRITICAL FOR VISUALS: To prevent repeating stock footage, you MUST write highly specific and literal visual search queries for every scene. Never use generic terms like "history" or "business". Use highly distinct, specific descriptions like "1920s black and white street view", "animated chart showing business growth", or "close up on an ancient egyptian artifact".',
    preferredTopics: [
      'A clever business idea that is not obvious',
      "A 'did you know' fact that is genuinely surprising",
      'An interesting story from history is revealed',
      'A major trending world news story explained simply',
    ],
    bannedTopics: [
      'partisan politics',
      'medical advice',
      'celebrity gossip',
      'unverified breaking news',
      'get rich quick schemes',
      'graphic crime details',
    ],
    bannedTerms: [
      'guaranteed income',
      'overnight success',
      'secret loophole',
      'must-buy before it sells out',
    ],
    sceneCount: 6,
    maxDurationSeconds: 90,
    defaultHashtags: ['didyouknow', 'history', 'businessideas', 'worldnews', 'explained'],
    callToActionStyle: 'community',
    callToActionTemplate: "Follow for more fascinating stories and ideas you won't find anywhere else.",
    callToActionGuardrails:
      'Keep the CTA short, engaging, and focused on curiosity. Do not use fake urgency.',
    affiliateLinkTemplate: '',
    requireAffiliateDisclosure: false,
    affiliateDisclosureTemplate: '',
    contentMode: 'narration',
    topicSource: 'preferred_topics',
    dialogueCharacterPresetId: 'studio_duo_v2',
    dialogueHostAName: 'Maya',
    dialogueHostBName: 'Theo',
    dialogueVoiceA: 'aura-2-thalia-en',
    dialogueVoiceB: 'aura-2-orion-en',
    enabled: true,
    scheduleCron: '0 8 * * *',
    targetPlatforms: [...targetPlatforms],
    defaultVoice: 'aura-2-thalia-en',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function isLegacyDefaultProfile(profile: ContentProfile): boolean {
  return false;
}

export function migrateLegacyDefaultProfile(
  profile: ContentProfile,
  targetPlatforms: ContentProfile['targetPlatforms'] = ['local']
): ContentProfile {
  const migrated = createDefaultProfile(targetPlatforms);

  return {
    ...migrated,
    id: profile.id,
    enabled: profile.enabled,
    scheduleCron: profile.scheduleCron,
    defaultVoice: profile.defaultVoice,
    createdAt: profile.createdAt,
    updatedAt: nowIso(),
  };
}
