import type { ContentCategory, ContentProfile } from '@autom/contracts';

import { nowIso } from './time.js';

type DefaultProfileSignature = Pick<
  ContentProfile,
  | 'name'
  | 'niche'
  | 'tone'
  | 'visualStyle'
  | 'promptDirectives'
  | 'defaultHashtags'
  | 'callToActionStyle'
  | 'callToActionTemplate'
  | 'callToActionGuardrails'
>;

const PRIMARY_COUNTRIES = ['US', 'UK', 'CA', 'AU'];
const SECONDARY_COUNTRIES = ['DE', 'IE', 'NL', 'NZ', 'SG'];

const UPGRADABLE_DEFAULT_PROFILE_SIGNATURES: DefaultProfileSignature[] = [
  {
    name: 'autoM Media',
    niche: 'Fascinating stories, hidden knowledge, and clever ideas',
    tone: 'simple, engaging, curious, and clear',
    visualStyle:
      'cinematic b-roll, archival footage, news graphics, data visualizations, and dynamic text',
    promptDirectives:
      'Your main task is to create a compelling, easy-to-understand video script for one of the supplied categories. Focus on great storytelling that will make someone watch the entire video. Use simple English. For business ideas, be specific and clever, not generic. For facts, find a surprising hook. For history, reveal something interesting. For news, explain a major trending story simply and clearly. CRITICAL FOR VISUALS: To prevent repeating stock footage, you MUST write highly specific and literal visual search queries for every scene. Never use generic terms like "history" or "business". Use highly distinct, specific descriptions like "1920s black and white street view", "animated chart showing business growth", or "close up on an ancient egyptian artifact".',
    defaultHashtags: ['didyouknow', 'history', 'businessideas', 'worldnews', 'explained'],
    callToActionStyle: 'community',
    callToActionTemplate:
      "Follow for more fascinating stories and ideas you won't find anywhere else.",
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
    defaultHashtags: ['businesstools', 'saas', 'finance', 'automation', 'explained'],
    callToActionStyle: 'affiliate',
    callToActionTemplate: 'Follow for practical tool breakdowns and smarter business systems.',
    callToActionGuardrails:
      'Keep the CTA clear and useful. Do not promise financial outcomes or urgency.',
  },
  {
    name: 'Stoic Wealth Shorts',
    niche: 'mindset and modern stoicism',
    tone: 'clear, confident, reflective',
    visualStyle: 'high-contrast monochrome portraits, city architecture, deliberate movement',
    promptDirectives:
      'Keep each script practical, reflective, and specific. Avoid hype language and vague promises.',
    defaultHashtags: ['stoicism', 'discipline', 'mindset', 'wealthhabits'],
    callToActionStyle: 'community',
    callToActionTemplate: 'Follow for practical discipline, focus, and money habit lessons.',
    callToActionGuardrails: 'Keep the CTA reflective, grounded, and free from urgency or promises.',
  },
];

export function createDefaultContentCategories(): ContentCategory[] {
  return [
    {
      id: 'business_tech_news',
      label: 'Business & Tech News',
      enabled: true,
      goal: 'revenue',
      platformFit: 'both',
      countryTargets: [...PRIMARY_COUNTRIES, ...SECONDARY_COUNTRIES],
      contentTypeBias: 'recent_news',
      topicGenerationRules:
        'Choose current stories around large tech companies, AI products, enterprise software, regulation with market impact, business moves, and platform shifts. Prefer stories with a clear winner, loser, surprise, or money implication.',
      evidencePolicy:
        'Use only current, source-backed stories with at least one credible publication and a concrete development.',
      visualPolicy:
        'Use exact company, executive, product, or event visuals first. Do not fall back to generic office stock unless the scene is commentary-only.',
      lengthStrategy: {
        minSeconds: 135,
        maxSeconds: 270,
        longformEligible: true,
      },
      hashtagStrategy:
        'Use 2-3 business or tech category tags, then 1-2 company or product tags. Keep tags sharp and topical.',
      searchLenses: ['technology news', 'business news', 'AI news', 'startup funding', 'earnings'],
      exampleTopics: [
        'Why a new AI launch matters for everyday users',
        'The business move that changes a whole market',
        'What a big earnings surprise really means',
      ],
    },
    {
      id: 'consumer_tech_and_ai',
      label: 'Consumer Tech & AI',
      enabled: true,
      goal: 'revenue',
      platformFit: 'both',
      countryTargets: [...PRIMARY_COUNTRIES],
      contentTypeBias: 'product_or_tool_demo',
      topicGenerationRules:
        'Focus on useful products, AI tools, platform updates, creator tools, or app shifts that change how people work or create.',
      evidencePolicy:
        'Prefer first-party announcements, product pages, current demos, and credible reporting.',
      visualPolicy:
        'Use exact product, app, interface, or device visuals before generic stock. Demo-style visuals are preferred.',
      lengthStrategy: {
        minSeconds: 135,
        maxSeconds: 240,
        longformEligible: true,
      },
      hashtagStrategy:
        'Use 2 category tags, 1-2 product tags, and optionally one trend tag if the topic is timely.',
      searchLenses: ['AI tools', 'consumer tech', 'app update', 'creator tools', 'product launch'],
      exampleTopics: [
        'The AI tool that quietly removes a painful workflow',
        'The consumer app update people are underestimating',
        'The device or feature that actually changes behavior',
      ],
    },
    {
      id: 'money_work_and_tools',
      label: 'Money, Work & Tools',
      enabled: true,
      goal: 'revenue',
      platformFit: 'both',
      countryTargets: [...PRIMARY_COUNTRIES],
      contentTypeBias: 'product_or_tool_demo',
      topicGenerationRules:
        'Pick tools, systems, comparisons, and work upgrades that solve real money or productivity pain without giving personal financial advice.',
      evidencePolicy:
        'Use source-backed tool details, pricing, product comparisons, or concrete use cases. Avoid unsupported promises.',
      visualPolicy:
        'Favor exact tools, screens, dashboards, calculators, or workflow visuals over generic office stock.',
      lengthStrategy: {
        minSeconds: 150,
        maxSeconds: 300,
        longformEligible: true,
      },
      hashtagStrategy:
        'Use 2 practical category tags and 1-2 tool or use-case tags. Skip generic hype tags.',
      searchLenses: [
        'business tools',
        'productivity tools',
        'finance tools',
        'automation software',
      ],
      exampleTopics: [
        'The workflow tool that actually cuts admin work',
        'The money tool that makes one decision easier',
        'The software comparison worth watching this year',
      ],
    },
    {
      id: 'big_explainers_and_current_affairs',
      label: 'Big Explainers & Current Affairs',
      enabled: true,
      goal: 'hybrid',
      platformFit: 'meta',
      countryTargets: [...PRIMARY_COUNTRIES, ...SECONDARY_COUNTRIES],
      contentTypeBias: 'recent_news',
      topicGenerationRules:
        'Pick major current events that can be explained clearly, especially stories with global impact, policy shifts, technology consequences, or business implications.',
      evidencePolicy:
        'Require multiple credible sources and clear factual grounding. Skip weakly sourced or purely partisan stories.',
      visualPolicy:
        'Use exact place, institution, person, or event visuals first. Generic stock is only acceptable for abstract commentary scenes.',
      lengthStrategy: {
        minSeconds: 150,
        maxSeconds: 300,
        longformEligible: true,
      },
      hashtagStrategy:
        'Use 1-2 explainer tags, 1 current-event tag, and entity tags when they are specific and relevant.',
      searchLenses: ['world news', 'current affairs', 'policy update', 'global business impact'],
      exampleTopics: [
        'The world event everyone is hearing about but not understanding',
        'The policy move with a real business ripple effect',
      ],
    },
    {
      id: 'history_people_and_power',
      label: 'History, People & Power',
      enabled: true,
      goal: 'authority',
      platformFit: 'meta',
      countryTargets: [...PRIMARY_COUNTRIES, ...SECONDARY_COUNTRIES],
      contentTypeBias: 'historical_topic',
      topicGenerationRules:
        'Choose history or biography topics only when there is a vivid hook, a reveal, a turning point, or a surprising consequence.',
      evidencePolicy:
        'Require strong factual grounding and exact visual availability for the key person, place, or event.',
      visualPolicy:
        'Use exact archival or entity visuals first. Reject scenes that would fall back to generic stock instead of the real subject.',
      lengthStrategy: {
        minSeconds: 135,
        maxSeconds: 270,
        longformEligible: false,
      },
      hashtagStrategy: 'Use 1-2 history tags plus the exact person, place, or event when relevant.',
      searchLenses: [
        'history explained',
        'historical figure',
        'archival story',
        'power and leadership history',
      ],
      exampleTopics: [
        'The historical decision that changed everything after it looked settled',
        'The leader everyone mentions but few explain correctly',
      ],
    },
    {
      id: 'practical_life_and_work_tips',
      label: 'Practical Life & Work Tips',
      enabled: true,
      goal: 'reach',
      platformFit: 'meta',
      countryTargets: [...PRIMARY_COUNTRIES],
      contentTypeBias: 'generic_business_or_lifestyle',
      topicGenerationRules:
        'Choose practical systems, habits, work tips, decision shortcuts, and everyday improvements with a specific payoff.',
      evidencePolicy:
        'Generic evergreen tips are acceptable if they stay concrete and avoid fake authority.',
      visualPolicy:
        'Use relevant stock, product, or activity visuals that match the exact action being described.',
      lengthStrategy: {
        minSeconds: 135,
        maxSeconds: 240,
        longformEligible: false,
      },
      hashtagStrategy:
        'Use 2 practical category tags and 1-2 exact action or workflow tags. Keep the set compact.',
      searchLenses: ['work tips', 'productivity habits', 'decision making', 'life systems'],
      exampleTopics: [
        'The small workflow fix that saves hours over a month',
        'The habit shift that changes work quality fast',
        'The practical system that stops repeat mistakes',
      ],
    },
  ];
}

export function createDefaultProfile(
  targetPlatforms: ContentProfile['targetPlatforms'] = ['local']
): ContentProfile {
  const timestamp = nowIso();

  return {
    id: 'profile_default',
    name: 'autoM Media',
    niche:
      'meta-first explainers for business, technology, current affairs, history, and practical life/work topics',
    tone: 'clear, conversational, vivid, and human',
    visualStyle:
      'relevant factual visuals, archival imagery, real-world footage, clean product visuals, and simple editorial graphics',
    promptDirectives:
      'Choose the most interesting concrete angle under the selected category, not the safest generic summary. Open with a real hook, escalate scene by scene, stay factual, and use highly specific visual search queries that describe the exact person, object, place, event, app, or activity on screen.',
    contentCategories: createDefaultContentCategories(),
    sceneCount: 0,
    maxDurationSeconds: 180,
    defaultHashtags: ['explained', 'news', 'tech', 'business'],
    callToActionStyle: 'community',
    callToActionTemplate:
      'Follow for sharper explainers on the stories, people, and tools worth knowing.',
    callToActionGuardrails:
      'Keep the CTA short, natural, and curiosity-led. No fake urgency or exaggerated promises.',
    affiliateLinkTemplate: '',
    requireAffiliateDisclosure: false,
    affiliateDisclosureTemplate: '',
    contentMode: 'narration',
    topicSource: 'category_pool',
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

export function shouldRefreshDefaultProfile(profile: ContentProfile): boolean {
  if (isLegacyDefaultProfile(profile)) {
    return true;
  }

  if (
    profile.id === 'profile_default' &&
    (profile.niche === 'high-intent finance, SaaS, and digital growth' ||
      profile.niche === 'mindset and modern stoicism')
  ) {
    return true;
  }

  return profile.id === 'profile_default' && profile.name === 'autoM History';
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
    arraysEqual(profile.defaultHashtags, signature.defaultHashtags) &&
    profile.callToActionStyle === signature.callToActionStyle &&
    profile.callToActionTemplate === signature.callToActionTemplate &&
    profile.callToActionGuardrails === signature.callToActionGuardrails
  );
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
