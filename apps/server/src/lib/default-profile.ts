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

const UPGRADABLE_DEFAULT_PROFILE_SIGNATURES: DefaultProfileSignature[] = [
  {
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
    defaultHashtags: ['didyouknow', 'history', 'businessideas', 'worldnews', 'explained'],
    callToActionStyle: 'community',
    callToActionTemplate: "Follow for more fascinating stories and ideas you won't find anywhere else.",
    callToActionGuardrails:
      'Keep the CTA short, engaging, and focused on curiosity. Do not use fake urgency.',
  },
  {
    name: 'autoM Media',
    niche: 'high-intent finance, SaaS, and digital growth',
    tone: 'clear, analytical, practical',
    visualStyle:
      'financial charts, dashboard interfaces, software screens, marketing analytics, office workflows, smart desk setups, cinematic business b-roll',
    promptDirectives:
      'Lead with a practical hook, explain the tool or strategy simply, compare alternatives when helpful, keep claims specific and verifiable, and finish with a concrete payoff. Keep the script optimized for people searching for solutions, tutorials, comparisons, and buyer-intent questions. If finance appears, keep it tool-led or comparison-led and avoid advice or promises. Avoid empty hype, fearbait, fake urgency, legal drama, revenge framing, recap-style storytelling, and exaggerated promises.',
    preferredTopics: [
      'best CRM for 2026',
      'AI workflow automation',
      'programmatic SEO',
      'retirement planning tools',
      'real estate investing tools',
    ],
    bannedTopics: [
      'partisan politics',
      'medical advice',
      'revenge stories',
      'courtroom drama',
      'celebrity gossip',
    ],
    bannedTerms: ['guaranteed returns', 'instant wealth', 'secret loophole', 'risk-free'],
    defaultHashtags: ['businesstools', 'saas', 'finance', 'automation', 'explained'],
    callToActionStyle: 'affiliate',
    callToActionTemplate: 'Follow for practical tool breakdowns and smarter business systems.',
    callToActionGuardrails:
      'Keep the CTA clear and useful. Do not promise financial outcomes or urgency.',
  },
  {
    name: 'autoM Media',
    niche: 'high-intent finance, SaaS, and digital growth',
    tone: 'clear, analytical, practical',
    visualStyle:
      'financial charts, dashboard interfaces, software screens, marketing analytics, office workflows, smart desk setups, cinematic business b-roll',
    promptDirectives:
      'Lead with a practical hook, explain the tool or strategy simply, compare alternatives when helpful, keep claims specific and verifiable, and finish with a concrete payoff. Keep the script optimized for people searching for solutions, tutorials, comparisons, and buyer-intent questions. If finance appears, keep it tool-led or comparison-led and avoid advice or promises. Avoid empty hype, fearbait, fake urgency, legal drama, revenge framing, recap-style storytelling, and exaggerated promises.',
    preferredTopics: [
      'Best CRM for 2026',
      'AI workflow automation',
      'SEO and programmatic SEO guides',
      'AI tool tutorials',
      'Paid ad scaling systems',
      'Tax strategy software',
      'Retirement planning tools',
      'Real estate investing tools',
      'High-ticket affiliate software reviews',
      'B2B SaaS comparisons',
    ],
    bannedTopics: [
      'partisan politics',
      'medical advice',
      'celebrity gossip',
      'unverified breaking news',
    ],
    bannedTerms: [
      'guaranteed income',
      'overnight success',
      'secret loophole',
      'must-buy before it sells out',
    ],
    defaultHashtags: ['finance', 'saas', 'automation', 'seo'],
    callToActionStyle: 'educational',
    callToActionTemplate:
      'Follow autoM Media for the next tool, strategy, or comparison worth knowing.',
    callToActionGuardrails:
      'Keep the CTA short, honest, and product-led. Do not use fake urgency or promise personal, financial, or life-changing outcomes.',
  },
  {
    name: 'Stoic Wealth Shorts',
    niche: 'mindset and modern stoicism',
    tone: 'clear, confident, reflective',
    visualStyle: 'high-contrast monochrome portraits, city architecture, deliberate movement',
    promptDirectives:
      'Keep each script practical, reflective, and specific. Avoid hype language and vague promises.',
    preferredTopics: ['discipline', 'focus', 'self-command', 'money habits', 'decision making'],
    bannedTopics: ['partisan politics', 'medical advice', 'get rich quick schemes'],
    bannedTerms: ['overnight success', 'secret formula', 'guaranteed wealth'],
    defaultHashtags: ['stoicism', 'discipline', 'mindset', 'wealthhabits'],
    callToActionStyle: 'community',
    callToActionTemplate: 'Follow for practical discipline, focus, and money habit lessons.',
    callToActionGuardrails:
      'Keep the CTA reflective, grounded, and free from urgency or promises.',
  },
  {
    name: 'Stoic Wealth Shorts',
    niche: 'mindset and modern stoicism',
    tone: 'clear, confident, reflective',
    visualStyle: 'high-contrast monochrome portraits, city architecture, deliberate movement',
    promptDirectives:
      'Keep each script practical, reflective, and specific. Avoid hype language and vague promises.',
    preferredTopics: ['discipline', 'focus', 'self-command', 'money habits', 'decision making'],
    bannedTopics: ['partisan politics', 'medical advice', 'get rich quick schemes'],
    bannedTerms: ['guaranteed income', 'overnight success', 'secret loophole'],
    defaultHashtags: ['stoicism', 'mindset', 'wealthhabits'],
    callToActionStyle: 'community',
    callToActionTemplate: 'Follow for the next short lesson and save this idea for later.',
    callToActionGuardrails:
      'Keep the CTA short, calm, and non-pushy. Do not promise financial outcomes.',
  },
];

export function createDefaultProfile(
  targetPlatforms: ContentProfile['targetPlatforms'] = ['local']
): ContentProfile {
  const timestamp = nowIso();

  return {
    id: 'profile_default',
    name: 'autoM Media',
    niche: 'daily trending tech, business, and world news explained simply',
    tone: 'clear, conversational, human, and easy to follow',
    visualStyle:
      'clean news graphics, cinematic b-roll, product footage, studio dialogue scenes, and simple data visuals',
    promptDirectives:
      'Turn one major daily trending story into a clear, engaging, and honest explainer. Keep the language simple, current, and conversational. Use two recurring hosts in dialogue mode, where one explains and the other reacts naturally with short human interjections like "mm", "you know", or "wait". Keep the tone grounded and lightly witty without inventing facts. Include at least one concrete example, comparison, or practical implication so the audience understands why the story matters. Use highly specific visual search queries and keep all claims faithful to the source context.',
    preferredTopics: [
      'artificial intelligence',
      'big tech',
      'business',
      'startups',
      'world news',
    ],
    bannedTopics: [
      'partisan politics',
      'medical advice',
      'celebrity gossip',
      'graphic crime details',
      'unverified breaking news',
    ],
    bannedTerms: ['guaranteed income', 'secret loophole', 'overnight success', 'risk-free'],
    sceneCount: 6,
    maxDurationSeconds: 90,
    defaultHashtags: ['news', 'technews', 'businessnews', 'explained'],
    callToActionStyle: 'community',
    callToActionTemplate: 'Follow for simple daily news breakdowns that actually make sense.',
    callToActionGuardrails:
      'Keep the CTA short, friendly, and grounded. No fake urgency or exaggerated promises.',
    affiliateLinkTemplate: '',
    requireAffiliateDisclosure: false,
    affiliateDisclosureTemplate: '',
    contentMode: 'dialogue',
    topicSource: 'daily_news',
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
  return UPGRADABLE_DEFAULT_PROFILE_SIGNATURES.some((signature) =>
    matchesSignature(profile, signature)
  );
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

function matchesSignature(profile: ContentProfile, signature: DefaultProfileSignature): boolean {
  return (
    profile.name === signature.name &&
    profile.niche === signature.niche &&
    profile.tone === signature.tone &&
    profile.visualStyle === signature.visualStyle &&
    profile.promptDirectives === signature.promptDirectives &&
    arraysEqual(profile.preferredTopics, signature.preferredTopics) &&
    arraysEqual(profile.bannedTopics, signature.bannedTopics) &&
    arraysEqual(profile.bannedTerms, signature.bannedTerms) &&
    arraysEqual(profile.defaultHashtags, signature.defaultHashtags) &&
    profile.callToActionStyle === signature.callToActionStyle &&
    profile.callToActionTemplate === signature.callToActionTemplate &&
    profile.callToActionGuardrails === signature.callToActionGuardrails
  );
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
