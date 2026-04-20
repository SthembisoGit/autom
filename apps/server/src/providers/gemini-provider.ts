import type { AppEnv } from '@autom/config';
import type { ContentProfile, DialoguePackage, DialogueShotType, DialogueTurn, ScriptPackage } from '@autom/contracts';
import { ScriptPackageSchema } from '@autom/contracts';

import {
  estimateNarrationDurationSeconds,
  getNarrationOvershootAllowanceSeconds,
} from '../lib/content-quality.js';
import {
  applySceneVisualModes,
} from '../lib/dialogue.js';
import type { NewsProvider, NewsTopicContext, ScriptGenerationResult, ScriptProvider } from '../lib/types.js';

const LOCAL_PROMPT_VERSION = 'local-script-template-v1';
const GEMINI_PROMPT_VERSION = 'gemini-script-v1';
const GROQ_PROMPT_VERSION = 'groq-script-v1';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_GROQ_REQUEST_TIMEOUT_MS = 45_000;
const MIN_SCENE_DURATION_SECONDS = 3;
const MAX_VIDEO_TAGS = 8;
const MAX_VIDEO_TAG_LENGTH = 40;
const MAX_VIDEO_TAG_WORDS = 4;
const VIDEO_TAG_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'that',
  'to',
  'with',
  'without',
]);
const GENERIC_FILLER_PATTERNS = [
  /\bin today's world\b/i,
  /\bit's important to\b/i,
  /\bthis shows that\b/i,
  /\bthe key takeaway\b/i,
  /\bgame changer\b/i,
  /\bleverage\b/i,
];
const CONCRETE_SCENE_RULES = [
  'Every scene must mention one concrete artifact: a named tool, workflow step, metric, comparison, or example.',
  'Do not write general background paragraphs that could fit any topic.',
  'Scene 1 should state the promise in plain language.',
  'Middle scenes must add a distinct example, comparison, or step instead of repeating the same idea.',
  'The final scene must summarize the payoff and then close with the CTA.',
  'Avoid abstract filler words like opportunity, landscape, transformation, leverage, ecosystem, or game changer unless paired with a named example.',
  'If the topic is broad, narrow it to a specific use case, tool, platform, or decision.',
];
const DIRECT_CONCRETE_DEMO_PATTERN =
  /(for example|example|compare|comparison|instead of|before|after|workflow|step-by-step|demo|walkthrough|case study|scenario)/i;
const CONCRETE_ARTIFACT_PATTERN =
  /\b(tool|software|platform|dashboard|spreadsheet|calculator|template|checklist|playbook|crm|pipeline|keyword|campaign|ad set|report|account|pricing|trial|screen|tab|filter|metric|score|benchmark|ira|401k|portfolio|expense ratio|contribution|match|deal|rent|cash flow|cap rate|valuation|workflow|automation)\b/i;
const ACTIONABLE_VERB_PATTERN =
  /\b(use|open|check|track|map|export|filter|route|audit|review|test|compare|price|budget|rebalance|contribute|forecast|segment|score|calculate|screen|move|plug|sync|automate|trim|cluster)\b/i;
const QUANTIFIED_DETAIL_PATTERN = /\b(?:\$?\d[\d,.]*%?|\d{4})\b/;
const NEWS_CONCRETE_PATTERN =
  /\b(according to|reported|announced|said|filed|launched|released|approved|blocked|acquired|raised|cut|tariff|market|shares|company|government|agency|minister|president|court|earnings|forecast|deal|merger|outage|update)\b/i;
const GROQ_CHAT_COMPLETIONS_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

type GeminiTextResponse = {
  text?: string | (() => string);
};

type GeminiGenerateContentInput = {
  model: string;
  contents: string;
  config: {
    responseMimeType: string;
    responseJsonSchema?: unknown;
  };
};

type GeminiClient = {
  models: {
    generateContent(input: GeminiGenerateContentInput): Promise<GeminiTextResponse>;
  };
};

type GeminiClientFactory = () => Promise<GeminiClient> | GeminiClient;

type GeminiScriptProviderOptions = {
  createClient?: GeminiClientFactory;
  maxAttempts?: number;
  model?: string;
  promptVersion?: string;
  requestTimeoutMs?: number;
  newsProvider?: NewsProvider;
};

type GroqChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type GroqChatCompletionInput = {
  model: string;
  messages: GroqChatMessage[];
  temperature?: number;
  response_format?: {
    type: 'json_object';
  };
};

type GroqTextResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

type GroqClient = {
  chat: {
    completions: {
      create(input: GroqChatCompletionInput): Promise<GroqTextResponse>;
    };
  };
};

type GroqClientFactory = () => Promise<GroqClient> | GroqClient;

type GroqScriptProviderOptions = {
  createClient?: GroqClientFactory;
  maxAttempts?: number;
  model?: string;
  promptVersion?: string;
  requestTimeoutMs?: number;
  newsProvider?: NewsProvider;
};

type RepairContext = {
  issue: string;
  rawResponse: string;
};

type SceneDraft = {
  text: string;
  visualQuery: string;
  durationSeconds: number;
};

class MalformedScriptResponseError extends Error {
  constructor(
    message: string,
    readonly rawResponse: string
  ) {
    super(message);
    this.name = 'MalformedScriptResponseError';
  }
}

type GeminiSdkModule = typeof import('@google/genai/web');

export class LocalScriptProvider implements ScriptProvider {
  constructor(private readonly newsProvider?: NewsProvider) {}

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const newsContext = await resolveNewsContext(this.newsProvider, profile, topic);
    const sceneDurations = allocateDurations(
      Array.from({ length: profile.sceneCount }, () => 1),
      profile.maxDurationSeconds
    );
    const baseSceneIdeas = buildLocalSceneIdeas(profile, topic, newsContext);

    const scenes = Array.from({ length: profile.sceneCount }, (_, index) => ({
      order: index + 1,
      text: baseSceneIdeas[index] ?? `${topic} lesson ${index + 1}.`,
      visualQuery: `${topic} ${profile.visualStyle} vertical cinematic ${index + 1}`,
      durationSeconds: sceneDurations[index] ?? MIN_SCENE_DURATION_SECONDS,
      visualMode: 'auto' as const,
    }));

    const baseScriptPackage = ScriptPackageSchema.parse({
      id: `script_${topic.toLowerCase().replace(/\s+/g, '_')}`,
      title: newsContext
        ? `${capitalize(topic)}: what actually happened`
        : `${capitalize(topic)}: a practical breakdown`,
      description: newsContext
        ? `A simplified ${profile.niche} breakdown of the latest ${topic} story.`
        : `A focused ${profile.niche} explainer about ${topic}.`,
      tags: buildVideoKeywords([
        profile.niche,
        topic,
        newsContext?.sourceName ?? '',
        ...profile.defaultHashtags,
      ]),
      scenes,
      totalDurationSeconds: profile.maxDurationSeconds,
      dialogue: null,
    });
    const scriptPackage = applySceneVisualModes(profile, baseScriptPackage);

    return {
      scriptPackage,
      scriptMetadata: {
        provider: 'local',
        model: null,
        promptVersion: LOCAL_PROMPT_VERSION,
        mode: 'stub',
        attemptCount: 1,
        repaired: false,
      },
    };
  }
}

export class GroqScriptProvider implements ScriptProvider {
  private readonly createClient: GroqClientFactory;
  private readonly maxAttempts: number;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly newsProvider?: NewsProvider;

  constructor(
    private readonly apiKey: string,
    options: GroqScriptProviderOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.model = options.model ?? DEFAULT_GROQ_MODEL;
    this.promptVersion = options.promptVersion ?? GROQ_PROMPT_VERSION;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_GROQ_REQUEST_TIMEOUT_MS;
    this.newsProvider = options.newsProvider;
    this.createClient =
      options.createClient ?? (() => createGroqClient(this.apiKey, this.requestTimeoutMs));
  }

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const client = await this.createClient();
    const newsContext = await resolveNewsContext(this.newsProvider, profile, topic);
    let repairContext: RepairContext | null = null;
    let lastIssue = 'Groq did not return a usable script.';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'Return only valid JSON that matches the requested schema and constraints. Do not wrap the response in markdown fences.',
            },
            {
              role: 'user',
              content: repairContext
                ? buildRepairPrompt(profile, topic, repairContext, newsContext)
                : buildGenerationPrompt(profile, topic, newsContext),
            },
          ],
          temperature: 0.2,
          response_format: {
            type: 'json_object',
          },
        });

        const rawText = readGroqResponseText(response);
        const scriptPackage = parseGeminiScript(rawText, profile, topic);

        return {
          scriptPackage,
          scriptMetadata: {
            provider: 'groq',
            model: this.model,
            promptVersion: this.promptVersion,
            mode: 'live',
            attemptCount: attempt,
            repaired: repairContext !== null,
          },
        };
      } catch (error) {
        lastIssue = error instanceof Error ? error.message : 'Unknown Groq generation failure.';
        repairContext =
          error instanceof MalformedScriptResponseError
            ? {
                issue: lastIssue,
                rawResponse: error.rawResponse,
              }
            : null;
      }
    }

    throw new Error(`Groq generation failed after ${this.maxAttempts} attempts. ${lastIssue}`);
  }
}

export class FallbackScriptProvider implements ScriptProvider {
  constructor(
    private readonly providers: Array<{
      label: string;
      provider: ScriptProvider;
    }>
  ) {}

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const failures: string[] = [];

    for (const candidate of this.providers) {
      try {
        return await candidate.provider.generate(profile, topic);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown script generation failure.';
        failures.push(`${candidate.label}: ${message}`);
      }
    }

    throw new Error(`All script providers failed. ${failures.join(' | ')}`);
  }
}

export class GeminiScriptProvider implements ScriptProvider {
  private readonly createClient: GeminiClientFactory;
  private readonly maxAttempts: number;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly newsProvider?: NewsProvider;

  constructor(
    private readonly apiKey: string,
    options: GeminiScriptProviderOptions = {}
  ) {
    this.createClient = options.createClient ?? (() => createGeminiClient(this.apiKey));
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.promptVersion = options.promptVersion ?? GEMINI_PROMPT_VERSION;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.newsProvider = options.newsProvider;
  }

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const client = await this.createClient();
    const newsContext = await resolveNewsContext(this.newsProvider, profile, topic);
    let repairContext: RepairContext | null = null;
    let lastIssue = 'Gemini did not return a usable script.';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await withTimeout(
          client.models.generateContent({
            model: this.model,
            contents: repairContext
              ? buildRepairPrompt(profile, topic, repairContext, newsContext)
              : buildGenerationPrompt(profile, topic, newsContext),
            config: {
              responseMimeType: 'application/json',
              responseJsonSchema: buildScriptResponseJsonSchema(profile),
            },
          }),
          this.requestTimeoutMs,
          `Gemini request timed out after ${this.requestTimeoutMs}ms.`
        );

        const rawText = readGeminiResponseText(response);
        const scriptPackage = parseGeminiScript(rawText, profile, topic);

        return {
          scriptPackage,
          scriptMetadata: {
            provider: 'gemini',
            model: this.model,
            promptVersion: this.promptVersion,
            mode: 'live',
            attemptCount: attempt,
            repaired: repairContext !== null,
          },
        };
      } catch (error) {
        lastIssue = error instanceof Error ? error.message : 'Unknown Gemini generation failure.';
        repairContext =
          error instanceof MalformedScriptResponseError
            ? {
                issue: lastIssue,
                rawResponse: error.rawResponse,
              }
            : null;
      }
    }

    throw new Error(`Gemini generation failed after ${this.maxAttempts} attempts. ${lastIssue}`);
  }
}

export function createScriptProvider(env: AppEnv, newsProvider?: NewsProvider): ScriptProvider {
  const providers: Array<{ label: string; provider: ScriptProvider }> = [];

  if (env.GEMINI_API_KEY) {
    providers.push({
      label: 'gemini',
      provider: new GeminiScriptProvider(env.GEMINI_API_KEY, {
        model: env.GEMINI_SCRIPT_MODEL,
        newsProvider,
      }),
    });
  }

  if (env.GROQ_API_KEY) {
    providers.push({
      label: 'groq',
      provider: new GroqScriptProvider(env.GROQ_API_KEY, {
        model: env.GROQ_SCRIPT_MODEL,
        requestTimeoutMs: env.GROQ_SCRIPT_TIMEOUT_SECONDS * 1000,
        newsProvider,
      }),
    });
  }

  providers.push({
    label: 'local',
    provider: new LocalScriptProvider(newsProvider),
  });

  return providers.length === 1 ? providers[0].provider : new FallbackScriptProvider(providers);
}

function buildGenerationPrompt(
  profile: ContentProfile,
  topic: string,
  newsContext: NewsTopicContext | null
): string {
  const targetWordsTotal = Math.max(
    profile.sceneCount * 15,
    Math.round(profile.maxDurationSeconds * 2.4)
  );
  const targetWordsPerScene = Math.max(8, Math.round(targetWordsTotal / profile.sceneCount));

  const promptLines = [
    'Return JSON only that matches the provided schema.',
    `Your main task is to invent a specific, compelling video topic within the category of "${topic}", then write the script for it.`,
    'Do not write a generic script about the category itself. Invent a specific title and topic.',
    `Use exactly ${profile.sceneCount} scenes.`,
    `Target a total runtime of ${profile.maxDurationSeconds} seconds.`,
    `Aim for roughly ${targetWordsTotal} spoken words total, or about ${targetWordsPerScene} words per scene, written for a narrator reading aloud.`,
    'Use short, spoken sentences instead of dense paragraphs.',
    'Use a hook, problem, demonstration, and payoff structure across the scenes.',
    'Write for people searching for a practical answer, comparison, or tutorial.',
    'If the topic is a product or platform, compare it against the obvious manual workflow or alternative.',
    'Avoid generic filler language and keep every scene concrete.',
    'Include at least one practical example or comparison in the middle scenes.',
    'For finance, SaaS, or SEO topics, name one specific scenario, metric, account type, workflow step, or screen the viewer would actually inspect.',
    ...CONCRETE_SCENE_RULES,
    'Each scene must include text, visualQuery, and durationSeconds.',
    'Keep each scene at least 3 seconds long.',
    'Keep each scene readable on a phone screen and avoid overlong caption blocks.',
    `Niche: ${profile.niche}.`,
    `Tone: ${profile.tone}.`,
    `Visual style: ${profile.visualStyle}.`,
    `Prompt directives: ${profile.promptDirectives}.`,
    `Preferred topics: ${joinOrNone(profile.preferredTopics)}.`,
    `Banned topics: ${joinOrNone(profile.bannedTopics)}.`,
    `Banned terms: ${joinOrNone(profile.bannedTerms)}.`,
    'Each tag must be a short keyword or short phrase, not a sentence.',
    'Keep every tag under 50 characters and avoid punctuation.',
    `CTA style: ${profile.callToActionStyle}.`,
    `CTA template: ${profile.callToActionTemplate}.`,
    `CTA guardrails: ${profile.callToActionGuardrails}.`,
    `Default hashtags: ${joinOrNone(profile.defaultHashtags)}.`,
    `Affiliate disclosure required: ${profile.requireAffiliateDisclosure ? 'yes' : 'no'}.`,
    `Affiliate disclosure template: ${profile.affiliateDisclosureTemplate || 'none'}.`,
    'If the affiliate link template is empty, keep the CTA educational and do not imply affiliate status.',
    'If the topic touches finance, keep it tool-led or comparison-led and avoid advice or promises.',
    'Title should sound search-led and specific, not generic or hypey.',
    'Description should summarize the practical payoff and context clearly.',
    'Keep tags lowercase, concise, and omit the # symbol.',
    'Keep each tag to one to four words. Do not return sentence-length tags.',
    'Place the strongest call to action near the final scene only.',
  ];

  if (profile.topicSource === 'daily_news') {
    promptLines.push(
      'Treat this as a current news explainer, not a timeless tutorial.',
      'Keep every factual claim anchored to the supplied news context. Do not invent details, motives, numbers, or quotes.',
      'Explain what happened, why people care, and what changes next in plain language.',
      'One host should mainly explain the story while the other host reacts, asks clarifying questions, and pushes for simpler language.',
      'Humanize the dialogue with occasional natural speech markers like "mm", "you know", "look", or "I mean", but use them sparingly and not in every turn.',
      'Allow one or two light opinion beats or gentle jokes, but keep them clearly framed as reactions, not facts.',
      'If part of the story is uncertain, say it is unclear instead of pretending certainty.',
      'Focus on the latest angle and avoid stale background unless it helps simplify the story.'
    );
  }

  if (newsContext) {
    promptLines.push(
      `Current news headline: ${newsContext.title}.`,
      `News search lens: ${newsContext.query}.`,
      `Reported source: ${newsContext.sourceName ?? 'unknown'}.`,
      `Published at: ${newsContext.publishedAt ?? 'unknown'}.`,
      `Source URL: ${newsContext.sourceUrl ?? 'unknown'}.`,
      `Article snippet: ${newsContext.snippet ?? 'none available'}.`
    );
  }

  return promptLines.join('\n');
}

function buildRepairPrompt(
  profile: ContentProfile,
  topic: string,
  repairContext: RepairContext,
  newsContext: NewsTopicContext | null
): string {
  const targetWordsTotal = Math.max(
    profile.sceneCount * 15,
    Math.round(profile.maxDurationSeconds * 2.4)
  );
  const targetWordsPerScene = Math.max(8, Math.round(targetWordsTotal / profile.sceneCount));

  const promptLines = [
    'The previous response failed validation.',
    'Repair it so it satisfies the exact same JSON schema and constraints.',
    'Do not add commentary or markdown fences. Return JSON only.',
    `Category: ${topic}.`,
    `Required scene count: ${profile.sceneCount}.`,
    `Target total duration: ${profile.maxDurationSeconds} seconds.`,
    `Target roughly ${targetWordsTotal} spoken words total, or about ${targetWordsPerScene} words per scene.`,
    'Use a hook, problem, demonstration, and payoff structure across the scenes.',
    'Write for people searching for a practical answer, comparison, or tutorial.',
    'If the topic is a product or platform, compare it against the obvious manual workflow or alternative.',
    'Avoid generic filler language and keep every scene concrete.',
    'Include at least one practical example or comparison in the middle scenes.',
    'For finance, SaaS, or SEO topics, name one specific scenario, metric, account type, workflow step, or screen the viewer would actually inspect.',
    ...CONCRETE_SCENE_RULES,
    'If the topic touches finance, keep it tool-led or comparison-led and avoid advice or promises.',
    'Each tag must be a short keyword or short phrase, not a sentence.',
    'Keep every tag to one to four words, under 40 characters, and avoid punctuation.',
    'If the affiliate link template is empty, keep the CTA educational and do not imply affiliate status.',
    `Validation issue: ${repairContext.issue}`,
    'Previous response:',
    repairContext.rawResponse,
  ];

  if (profile.topicSource === 'daily_news') {
    promptLines.push(
      'Keep the script grounded in the supplied current news context.',
      'Do not invent facts, timelines, quotes, or company motives.',
      'Make the dialogue feel natural with restrained conversational markers and reactive questions.'
    );
  }

  if (newsContext) {
    promptLines.push(
      `Current news headline: ${newsContext.title}.`,
      `News search lens: ${newsContext.query}.`,
      `Reported source: ${newsContext.sourceName ?? 'unknown'}.`,
      `Published at: ${newsContext.publishedAt ?? 'unknown'}.`,
      `Source URL: ${newsContext.sourceUrl ?? 'unknown'}.`,
      `Article snippet: ${newsContext.snippet ?? 'none available'}.`
    );
  }

  return promptLines.join('\n');
}

async function resolveNewsContext(
  newsProvider: NewsProvider | undefined,
  profile: ContentProfile,
  topic: string
): Promise<NewsTopicContext | null> {
  if (!newsProvider || profile.topicSource !== 'daily_news') {
    return null;
  }

  try {
    return await newsProvider.resolveContext(profile, topic);
  } catch {
    return null;
  }
}

function buildScriptResponseJsonSchema(profile: ContentProfile): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'tags', 'scenes'],
    properties: {
      title: {
        type: 'string',
      },
      description: {
        type: 'string',
      },
      tags: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
      scenes: {
        type: 'array',
        minItems: profile.sceneCount,
        maxItems: profile.sceneCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'visualQuery', 'durationSeconds'],
          properties: {
            text: {
              type: 'string',
            },
            visualQuery: {
              type: 'string',
            },
            durationSeconds: {
              type: 'number',
              minimum: 3,
            },
          },
        },
      },
      totalDurationSeconds: {
        type: 'number',
        minimum: profile.sceneCount * 3,
        maximum: profile.maxDurationSeconds,
      },
    },
  };

  return schema;
}

function readGeminiResponseText(response: GeminiTextResponse): string {
  const value =
    typeof response?.text === 'function'
      ? response.text()
      : typeof response?.text === 'string'
        ? response.text
        : '';
  const text = stripCodeFence(value).trim();

  if (text.length === 0) {
    throw new Error('Gemini returned an empty response.');
  }

  return text;
}

function parseGeminiScript(rawText: string, profile: ContentProfile, topic: string): ScriptPackage {
  let payload: unknown;

  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new MalformedScriptResponseError('Gemini returned invalid JSON.', rawText);
  }

  try {
    const normalizedScript = normalizeScriptDraft(payload, profile, topic);
    return ScriptPackageSchema.parse(normalizedScript);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini returned invalid script data.';
    throw new MalformedScriptResponseError(message, rawText);
  }
}

function normalizeScriptDraft(
  payload: unknown,
  profile: ContentProfile,
  topic: string
): ScriptPackage {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Gemini response must be a JSON object.');
  }

  const record = payload as Record<string, unknown>;
  const scenesInput = Array.isArray(record.scenes) ? record.scenes : null;

  if (!scenesInput) {
    throw new Error('Gemini response must include a scenes array.');
  }

  if (scenesInput.length !== profile.sceneCount) {
    throw new Error(`Gemini must return exactly ${profile.sceneCount} scenes.`);
  }

  const scenes = scenesInput.map((scene, index) => normalizeSceneDraft(scene, index));
  const durationTargets = allocateDurations(
    scenes.map((scene) => scene.durationSeconds),
    profile.maxDurationSeconds
  );

  const scriptPackage = {
    id: `script_${topic.toLowerCase().replace(/\s+/g, '_')}`,
    title: getRequiredString(record.title, 'Gemini response must include a title.'),
    description: getRequiredString(
      record.description,
      'Gemini response must include a description.'
    ),
    tags: normalizeTags(record.tags, profile, topic),
    scenes: scenes.map((scene, index) => ({
      order: index + 1,
      text: scene.text,
      visualQuery: scene.visualQuery,
      durationSeconds: durationTargets[index] ?? MIN_SCENE_DURATION_SECONDS,
      visualMode: 'auto' as const,
    })),
    totalDurationSeconds: profile.maxDurationSeconds,
    dialogue: null,
  };

  const normalizedScriptPackage = applySceneVisualModes(profile, scriptPackage);
  validateScriptDirectionQuality(normalizedScriptPackage);
  validateScriptTiming(normalizedScriptPackage, profile);
  return normalizedScriptPackage;
}

function normalizeSceneDraft(scene: unknown, index: number): SceneDraft {
  if (!scene || typeof scene !== 'object') {
    throw new Error(`Scene ${index + 1} must be an object.`);
  }

  const record = scene as Record<string, unknown>;
  const durationSeconds = getPositiveNumber(
    record.durationSeconds,
    `Scene ${index + 1} must include a positive duration.`
  );

  if (durationSeconds < 3) {
    throw new Error(`Scene ${index + 1} must be at least 3 seconds long.`);
  }

  return {
    text: getRequiredString(record.text, `Scene ${index + 1} must include text.`),
    visualQuery: getRequiredString(
      record.visualQuery,
      `Scene ${index + 1} must include a visual query.`
    ),
    durationSeconds,
  };
}

function normalizeTags(input: unknown, profile: ContentProfile, topic: string): string[] {
  const source = Array.isArray(input) ? input : [];
  return buildVideoKeywords([
    profile.niche,
    topic,
    ...profile.defaultHashtags,
    ...source.flatMap((tag) => (typeof tag === 'string' ? splitTagSource(tag) : [])),
  ]);
}

function buildLocalSceneIdeas(
  profile: ContentProfile,
  topic: string,
  newsContext: NewsTopicContext | null
): string[] {
  const nextTopic = profile.preferredTopics[0] ?? 'AI tools that save time';
  const topicKey = topic.toLowerCase();

  if (profile.topicSource === 'daily_news' && newsContext) {
    const source = newsContext.sourceName ? ` according to ${newsContext.sourceName}` : '';
    return [
      `Mm, the big story today is ${topic}${source}, and this scene states the core update in plain language.`,
      'The next beat simplifies what actually changed and avoids jargon so the viewer understands the headline fast.',
      'Now compare this update with the old normal or expectation so the shift feels concrete instead of abstract.',
      'Spell out who is affected, what people are watching next, and which part is still unclear.',
      'Let one host add a small reaction or joke without changing the facts, then pull the conversation back to what matters.',
      `${profile.callToActionTemplate}`,
      `If you want tomorrow's simplified headline, come back for the next story.`,
      'Save this if you want the quick version without digging through ten articles.',
    ].slice(0, profile.sceneCount);
  }

  if (/retirement/.test(topicKey)) {
    return [
      'Most retirement tool lists are too vague, so start with one specific use case: tracking contributions, fees, and account mix in one place.',
      'Open a Roth IRA or 401k dashboard and check the concrete inputs that matter: contribution room, employer match, and expense ratio.',
      'A useful tool should show what changes when you raise a monthly contribution from 200 to 300 and keep the same timeline.',
      'The stronger option makes the comparison visible on one screen instead of forcing you to bounce between spreadsheets and account tabs.',
      'The payoff is fewer blind spots, clearer tradeoffs, and a retirement plan you can actually review each month.',
      `${profile.callToActionTemplate}`,
      `If you want the next practical topic, try ${nextTopic}.`,
      'Save this checklist and use it before you pick the next retirement tool.',
    ].slice(0, profile.sceneCount);
  }

  if (/real estate/.test(topicKey)) {
    return [
      'The fastest way to judge a real estate investing tool is to see whether it clarifies one deal instead of overwhelming you with market noise.',
      'Start with the concrete inputs: rent, vacancy, repairs, financing, and the cap rate or cash flow number the tool calculates from them.',
      'A good dashboard should let you test one scenario, like higher interest or lower occupancy, without rebuilding the deal in a spreadsheet.',
      'The better option replaces manual copy-paste with a repeatable deal review workflow you can run on every listing.',
      'That gives you cleaner underwriting, faster go or no-go calls, and fewer bad assumptions hiding in the numbers.',
      `${profile.callToActionTemplate}`,
      `If you want the next practical topic, try ${nextTopic}.`,
      'Save this process and use it the next time a deal looks better than it really is.',
    ].slice(0, profile.sceneCount);
  }

  if (/seo|programmatic/.test(topicKey)) {
    return [
      'Programmatic SEO only works when the workflow is concrete, so start with one page type, one keyword cluster, and one template.',
      'The first screen to check is the keyword map: search intent, supporting terms, and the page pattern you can reuse safely.',
      'A practical tool should show where pages are thin, where internal links are missing, and which template variables still need real data.',
      'The stronger setup replaces random publishing with a repeatable content system that pairs templates, QA, and indexing checks.',
      'That means fewer junk pages, cleaner coverage, and a programmatic SEO process you can scale without losing quality.',
      `${profile.callToActionTemplate}`,
      `If you want the next practical topic, try ${nextTopic}.`,
      'Save this breakdown and use it before you scale another batch of pages.',
    ].slice(0, profile.sceneCount);
  }

  if (/crm|saas|workflow|automation/.test(topicKey)) {
    return [
      `The useful way to judge ${topic} is to follow one lead or one task from start to finish, not to skim a feature list.`,
      'Check the specific workflow: where the lead lands, who gets notified, what data is captured, and which step still needs human review.',
      'A practical demo should show the trigger, the handoff, and the one screen where the team saves the most time.',
      'The better option replaces spreadsheet follow-up and tab switching with a workflow that is visible, searchable, and easier to audit.',
      'That gives you fewer dropped steps, clearer ownership, and a system the team can repeat without extra cleanup.',
      `${profile.callToActionTemplate}`,
      `If you want the next practical topic, try ${nextTopic}.`,
      'Save this workflow and use it the next time a tool promises more than it proves.',
    ].slice(0, profile.sceneCount);
  }

  return [
    `Most people approach ${topic} backwards. Start with the payoff, not the buzzword.`,
    `The real problem is usually too many steps, too many tabs, or the wrong tool for the job.`,
    `The simplest version is to treat ${topic} as a workflow, not a one-off trick.`,
    `Show the concrete screen, metric, or comparison that proves why the better option saves time.`,
    `The payoff is less friction, clearer output, and a process that is easier to repeat.`,
    `${profile.callToActionTemplate}`,
    `If you want the next practical topic, try ${nextTopic}.`,
    `Save this workflow and use it the next time you need a simpler path.`,
  ].slice(0, profile.sceneCount);
}

function getRequiredString(input: unknown, message: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(message);
  }

  return input.trim();
}

function getPositiveNumber(input: unknown, message: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    throw new Error(message);
  }

  return input;
}

function allocateDurations(weights: number[], targetTotal: number): number[] {
  if (weights.length === 0) {
    return [];
  }

  const minimumTotal = weights.length * MIN_SCENE_DURATION_SECONDS;
  if (targetTotal < minimumTotal) {
    throw new Error(
      `Target total duration must allow at least ${MIN_SCENE_DURATION_SECONDS} seconds per scene.`
    );
  }

  const normalizedWeights = weights.map((weight) => Math.max(1, Math.floor(weight)));
  const remainingDuration = targetTotal - minimumTotal;

  if (remainingDuration === 0) {
    return Array.from({ length: weights.length }, () => MIN_SCENE_DURATION_SECONDS);
  }

  const weightTotal = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const allocations = normalizedWeights.map((weight, index) => {
    const exact = (remainingDuration * weight) / weightTotal;
    const value = Math.floor(exact);
    return {
      index,
      value,
      fraction: exact - value,
    };
  });

  let leftover = remainingDuration - allocations.reduce((sum, item) => sum + item.value, 0);
  const prioritized = [...allocations].sort((left, right) => {
    if (right.fraction !== left.fraction) {
      return right.fraction - left.fraction;
    }

    return left.index - right.index;
  });

  let cursor = 0;
  while (leftover > 0) {
    prioritized[cursor % prioritized.length].value += 1;
    leftover -= 1;
    cursor += 1;
  }

  return allocations.map((item) => MIN_SCENE_DURATION_SECONDS + item.value);
}

function validateScriptTiming(scriptPackage: ScriptPackage, profile: ContentProfile): void {
  const estimatedNarrationSeconds = estimateNarrationDurationSeconds(
    scriptPackage.scenes.map((scene) => scene.text)
  );
  const budgetAllowanceSeconds = getNarrationOvershootAllowanceSeconds(profile.maxDurationSeconds);

  if (estimatedNarrationSeconds > profile.maxDurationSeconds + budgetAllowanceSeconds) {
    throw new Error(
      `Gemini response exceeds the duration budget by ${Math.ceil(
        estimatedNarrationSeconds - profile.maxDurationSeconds
      )} seconds. Regenerate the script.`
    );
  }
}

function validateScriptDirectionQuality(scriptPackage: ScriptPackage): void {
  const lowerSceneTexts = scriptPackage.scenes.map((scene) => scene.text.toLowerCase());
  if (new Set(lowerSceneTexts).size <= Math.max(2, Math.floor(scriptPackage.scenes.length * 0.6))) {
    throw new Error('Script repeats too much and lacks scene-to-scene progression.');
  }

  for (const scene of scriptPackage.scenes) {
    if (GENERIC_FILLER_PATTERNS.some((pattern) => pattern.test(scene.text))) {
      throw new Error('Script contains generic filler language and must be more concrete.');
    }
  }

  const nonFinalScenes = scriptPackage.scenes.slice(1, Math.max(2, scriptPackage.scenes.length - 1));
  const hasConcreteDemo = nonFinalScenes.some((scene) => hasConcreteSceneSignal(scene.text));
  if (!hasConcreteDemo) {
    throw new Error('Script must include at least one practical comparison or concrete example.');
  }
}

function hasConcreteSceneSignal(text: string): boolean {
  return (
    DIRECT_CONCRETE_DEMO_PATTERN.test(text) ||
    CONCRETE_ARTIFACT_PATTERN.test(text) ||
    NEWS_CONCRETE_PATTERN.test(text) ||
    (ACTIONABLE_VERB_PATTERN.test(text) && QUANTIFIED_DETAIL_PATTERN.test(text)) ||
    (ACTIONABLE_VERB_PATTERN.test(text) && /\b(screen|tab|dashboard|calculator|template|report)\b/i.test(text))
  );
}

function buildVideoKeywords(values: string[]): string[] {
  const keywords = new Set<string>();

  for (const value of values) {
    for (const candidate of splitTagSource(value)) {
      const keyword = sanitizeVideoKeyword(candidate);
      if (!keyword) {
        continue;
      }

      keywords.add(keyword);
      if (keywords.size >= MAX_VIDEO_TAGS) {
        return Array.from(keywords);
      }
    }
  }

  return Array.from(keywords);
}

function splitTagSource(value: string): string[] {
  return value
    .split(/[,;\n|/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function sanitizeVideoKeyword(value: string): string | null {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/^#/, '')
    .replace(/["'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length === 0) {
    return null;
  }

  if (/^(https?|www)\b/i.test(normalized) || normalized.includes('://')) {
    return null;
  }

  const words = normalized.split(' ').filter(Boolean);
  const compressedWords = compressVideoKeywordWords(words);
  if (compressedWords.length === 0) {
    return null;
  }

  const keyword = compressedWords.join(' ').trim();
  if (keyword.length === 0 || keyword.length > MAX_VIDEO_TAG_LENGTH) {
    return null;
  }

  return keyword;
}

function compressVideoKeywordWords(words: string[]): string[] {
  const contentWords = words.filter((word) => !VIDEO_TAG_STOPWORDS.has(word));
  if (contentWords.length > 0) {
    return contentWords.slice(0, MAX_VIDEO_TAG_WORDS);
  }

  if (words.length <= MAX_VIDEO_TAG_WORDS) {
    return words;
  }

  return words.slice(0, MAX_VIDEO_TAG_WORDS);
}

function stripCodeFence(input: string): string {
  return input.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function joinOrNone(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

async function createGeminiClient(apiKey: string): Promise<GeminiClient> {
  const sdk = (await import('@google/genai/web')) as GeminiSdkModule;
  return new sdk.GoogleGenAI({ apiKey });
}

function readGroqResponseText(response: GroqTextResponse): string {
  const text = response.choices?.[0]?.message?.content?.trim() ?? '';

  if (text.length === 0) {
    throw new Error('Groq returned an empty response.');
  }

  return stripCodeFence(text);
}

async function createGroqClient(apiKey: string, timeoutMs: number): Promise<GroqClient> {
  return {
    chat: {
      completions: {
        create: async (input) => {
          let response: Response;
          try {
            response = await fetch(GROQ_CHAT_COMPLETIONS_ENDPOINT, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(input),
              signal: AbortSignal.timeout(timeoutMs),
            });
          } catch (error) {
            if (isAbortError(error)) {
              throw new Error(`Groq request timed out after ${timeoutMs}ms.`);
            }

            throw error;
          }

          if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(
              `Groq request failed with status ${response.status}.${body ? ` ${body}` : ''}`
            );
          }

          return (await response.json()) as GroqTextResponse;
        },
      },
    },
  };
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
