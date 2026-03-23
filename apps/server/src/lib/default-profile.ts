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
  {
    name: 'autoM Media',
    niche: 'tech tools and curiosity',
    tone: 'clear, curious, practical',
    visualStyle:
      'clean product close-ups, futuristic interfaces, robotics labs, smart desks, cinematic technology b-roll',
    promptDirectives:
      'Lead with one surprising or useful point, explain the technology simply, keep claims specific and verifiable, and end with a practical takeaway. Avoid empty hype, fearbait, fake urgency, and exaggerated promises.',
    preferredTopics: [
      'AI tools that save time',
      'budget creator gadgets',
      'smart home upgrades',
      'future tech breakthroughs',
      'productivity apps',
      'weird engineering ideas',
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
    defaultHashtags: ['aitools', 'saas', 'automation', 'workflow'],
    callToActionStyle: 'educational',
    callToActionTemplate: 'Follow autoM Media for the next tool, workflow, or system worth trying.',
    callToActionGuardrails:
      'Keep the CTA short, honest, and product-led. Do not use fake urgency or promise personal, financial, or life-changing outcomes.',
  },
  {
    name: 'autoM Media',
    niche:
      'Quantitative Finance & Trading: Focus on automated trading strategies, algorithmic crypto analysis, and wealth-building "blueprints". "Boring" AI & Productivity: Break down how AI is automating physical labor and technical services (e.g., AI in law, engineering, or real estate). Business Scandals & Case Studies: High-retention "mini-documentaries" on corporate failures or industry shifts (e.g., "The Death of Retail").',
    tone:
      'Objective: Stick to facts to build trust in high-value niches like finance. Analytical: Use a data-driven approach to stand out in the crowded "hype" tech space. Sophisticated: A refined, "premium" feel that attracts high-spending advertisers.',
    visualStyle:
      '3D Isometric Data Visualisations: Use clean, moving graphs to explain complex trends. Aesthetic Minimalist Tech: High-quality stock footage of sleek hardware and clean, organized workspaces. Archival Cinematic B-Roll: Mix historical business footage with modern, high-contrast technology clips.',
    promptDirectives:
      'Lead with an "Impossible" Stat: Start with a verifiable but shocking data point (e.g., "AI just cut legal labor costs by 70%"). The "Why it Matters" Pivot: Halfway through, pivot from what the tech is to how it affects the viewer\'s wallet or career. Practical Takeaway: Always end with a specific tool to try or a strategy to implement.',
    preferredTopics: [
      'Prop firm trading blueprints',
      'Algorithmic crypto "whale" tracking',
      'Automated options hedging strategies',
      'Machine Learning for retail investors',
      'Agentic AI in legal and medical discovery',
      'AI-driven real estate valuation systems',
      'Robotic labor in technical engineering trades',
      'Workflow automation for white-collar firms',
      'The collapse of high-profile fintech companies',
      'Documentaries on industry-wide digital shifts',
      'High-stakes algorithmic trading glitches',
      'Corporate espionage in the Big Tech sector',
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
    defaultHashtags: ['aitools', 'gadgets', 'futuretech'],
    callToActionStyle: 'educational',
    callToActionTemplate: 'Follow autoM Media for useful tech and the next idea worth knowing.',
    callToActionGuardrails:
      'Keep the CTA short, honest, and non-pushy. Do not use fake urgency or promise personal, financial, or life-changing outcomes.',
  },
  {
    name: 'autoM Media',
    niche:
      'Quantitative Finance & Trading: Focus on automated trading strategies, algorithmic crypto analysis, and wealth-building "blueprints". "Boring" AI & Productivity: Break down how AI is automating physical labor and technical services (e.g., AI in law, engineering, or real estate). Business Scandals & Case Studies: High-retention "mini-documentaries" on corporate failures or industry shifts (e.g., "The Death of Retail").',
    tone:
      'Objective: Stick to facts to build trust in high-value niches like finance. Analytical: Use a data-driven approach to stand out in the crowded "hype" tech space. Sophisticated: A refined, "premium" feel that attracts high-spending advertisers.',
    visualStyle:
      '3D Isometric Data Visualisations: Use clean, moving graphs to explain complex trends. Aesthetic Minimalist Tech: High-quality stock footage of sleek hardware and clean, organized workspaces. Archival Cinematic B-Roll: Mix historical business footage with modern, high-contrast technology clips.',
    promptDirectives:
      'Lead with an "Impossible" Stat: Start with a verifiable but shocking data point (e.g., "AI just cut legal labor costs by 70%"). The "Why it Matters" Pivot: Halfway through, pivot from what the tech is to how it affects the viewer\'s wallet or career. Practical Takeaway: Always end with a specific tool to try or a strategy to implement.',
    preferredTopics: [
      'Prop firm trading blueprints',
      'Algorithmic crypto "whale" tracking',
      'Automated options hedging strategies',
      'Machine Learning for retail investors',
      'Agentic AI in legal and medical discovery',
      'AI-driven real estate valuation systems',
      'Robotic labor in technical engineering trades',
      'Workflow automation for white-collar firms',
      'The collapse of high-profile fintech companies',
      'Documentaries on industry-wide digital shifts',
      'High-stakes algorithmic trading glitches',
      'Corporate espionage in the Big Tech sector',
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
    defaultHashtags: ['aitools', 'gadgets', 'futuretech'],
    callToActionStyle: 'community',
    callToActionTemplate: 'Follow autoM Media for useful tech and the next idea worth knowing.',
    callToActionGuardrails:
      'Keep the CTA short, honest, and non-pushy. Do not use fake urgency or promise personal, financial, or life-changing outcomes.',
  },
  {
    name: 'autoM Media',
    niche:
      'Quantitative Finance & Trading: Focus on automated trading strategies, algorithmic crypto analysis, and wealth-building "blueprints". "Boring" AI & Productivity: Break down how AI is automating physical labor and technical services (e.g., AI in law, engineering, or real estate). Business Scandals & Case Studies: High-retention "mini-documentaries" on corporate failures or industry shifts (e.g., "The Death of Retail").',
    tone:
      'Objective: Stick to facts to build trust in high-value niches like finance. Analytical: Use a data-driven approach to stand out in the crowded "hype" tech space. Sophisticated: A refined, "premium" feel that attracts high-spending advertisers.',
    visualStyle:
      '3D Isometric Data Visualisations: Use clean, moving graphs to explain complex trends. Aesthetic Minimalist Tech: High-quality stock footage of sleek hardware and clean, organized workspaces. Archival Cinematic B-Roll: Mix historical business footage with modern, high-contrast technology clips.',
    promptDirectives:
      'Lead with an "Impossible" Stat: Start with a verifiable but shocking data point (e.g., "AI just cut legal labor costs by 70%"). The "Why it Matters" Pivot: Halfway through, pivot from what the tech is to how it affects the viewer\'s wallet or career. Practical Takeaway: Always end with a specific tool to try or a strategy to implement.',
    preferredTopics: [
      'Prop firm trading blueprints',
      'Algorithmic crypto "whale" tracking',
      'Automated options hedging strategies',
      'Machine Learning for retail investors',
      'Agentic AI in legal and medical discovery',
      'AI-driven real estate valuation systems',
      'Robotic labor in technical engineering trades',
      'Workflow automation for white-collar firms',
      'The collapse of high-profile fintech companies',
      'Documentaries on industry-wide digital shifts',
      'High-stakes algorithmic trading glitches',
      'Corporate espionage in the Big Tech sector',
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
    defaultHashtags: ['aitools', 'gadgets', 'futuretech'],
    callToActionStyle: 'educational',
    callToActionTemplate: 'Follow autoM Media for useful tech and the next idea worth knowing.',
    callToActionGuardrails:
      'Keep the CTA short, honest, and non-pushy. Do not use fake urgency or promise personal, financial, or life-changing outcomes.',
  },
];

export function createDefaultProfile(
  targetPlatforms: ContentProfile['targetPlatforms'] = ['local']
): ContentProfile {
  const timestamp = nowIso();

  return {
    id: 'profile_default',
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
      'legal drama',
      'revenge stories',
      'manhwa recaps',
      'webtoon recaps',
    ],
    bannedTerms: [
      'guaranteed income',
      'overnight success',
      'secret loophole',
      'must-buy before it sells out',
      'easy money',
    ],
    sceneCount: 6,
    maxDurationSeconds: 90,
    defaultHashtags: ['finance', 'saas', 'automation', 'seo'],
    callToActionStyle: 'educational',
    callToActionTemplate: 'Follow autoM Media for the next tool, strategy, or comparison worth knowing.',
    callToActionGuardrails:
      'Keep the CTA short, honest, and product-led. Do not use fake urgency or promise personal, financial, or life-changing outcomes.',
    affiliateLinkTemplate: '',
    requireAffiliateDisclosure: false,
    affiliateDisclosureTemplate: '',
    enabled: true,
    scheduleCron: '0 8 * * *',
    targetPlatforms: [...targetPlatforms],
    defaultVoice: 'aura-2-thalia-en',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function isLegacyDefaultProfile(profile: ContentProfile): boolean {
  return (
    profile.id === 'profile_default' &&
    UPGRADABLE_DEFAULT_PROFILE_SIGNATURES.some((signature) =>
      matchesDefaultProfileSignature(profile, signature)
    )
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

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function matchesDefaultProfileSignature(
  profile: ContentProfile,
  signature: DefaultProfileSignature
): boolean {
  return (
    profile.name === signature.name &&
    profile.niche === signature.niche &&
    profile.tone === signature.tone &&
    profile.visualStyle === signature.visualStyle &&
    profile.promptDirectives === signature.promptDirectives &&
    sameStringList(profile.preferredTopics, signature.preferredTopics) &&
    sameStringList(profile.bannedTopics, signature.bannedTopics) &&
    sameStringList(profile.bannedTerms, signature.bannedTerms) &&
    sameStringList(profile.defaultHashtags, signature.defaultHashtags) &&
    profile.callToActionStyle === signature.callToActionStyle &&
    profile.callToActionTemplate === signature.callToActionTemplate &&
    profile.callToActionGuardrails === signature.callToActionGuardrails
  );
}
