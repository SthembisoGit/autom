import type { AppEnv } from '@autom/config';
import type { ContentProfile, ScriptPackage } from '@autom/contracts';
import { ScriptPackageSchema } from '@autom/contracts';

import {
  estimateNarrationDurationSeconds,
  getNarrationOvershootAllowanceSeconds,
} from '../lib/content-quality.js';
import type { ScriptGenerationResult, ScriptProvider } from '../lib/types.js';

const LOCAL_PROMPT_VERSION = 'local-script-template-v1';
const GEMINI_PROMPT_VERSION = 'gemini-script-v1';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
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

type GeminiSdkModule = typeof import('@google/genai/web');

class MalformedScriptResponseError extends Error {
  constructor(
    message: string,
    readonly rawResponse: string
  ) {
    super(message);
    this.name = 'MalformedScriptResponseError';
  }
}

export class LocalScriptProvider implements ScriptProvider {
  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const sceneDurations = allocateDurations(
      Array.from({ length: profile.sceneCount }, () => 1),
      profile.maxDurationSeconds
    );
    const baseSceneIdeas = buildLocalSceneIdeas(profile, topic);

    const scenes = Array.from({ length: profile.sceneCount }, (_, index) => ({
      order: index + 1,
      text: baseSceneIdeas[index] ?? `${topic} lesson ${index + 1}.`,
      visualQuery: `${topic} ${profile.visualStyle} vertical cinematic ${index + 1}`,
      durationSeconds: sceneDurations[index] ?? MIN_SCENE_DURATION_SECONDS,
    }));

    return {
      scriptPackage: ScriptPackageSchema.parse({
        id: `script_${topic.toLowerCase().replace(/\s+/g, '_')}`,
        title: `${capitalize(topic)}: a practical breakdown`,
        description: `A focused ${profile.niche} explainer about ${topic}.`,
        tags: buildVideoKeywords([profile.niche, topic, ...profile.defaultHashtags]),
        scenes,
        totalDurationSeconds: profile.maxDurationSeconds,
      }),
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

export class GeminiScriptProvider implements ScriptProvider {
  private readonly createClient: GeminiClientFactory;
  private readonly maxAttempts: number;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly apiKey: string,
    options: GeminiScriptProviderOptions = {}
  ) {
    this.createClient = options.createClient ?? (() => createGeminiClient(this.apiKey));
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.promptVersion = options.promptVersion ?? GEMINI_PROMPT_VERSION;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const client = await this.createClient();
    let repairContext: RepairContext | null = null;
    let lastIssue = 'Gemini did not return a usable script.';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await withTimeout(
          client.models.generateContent({
            model: this.model,
            contents: repairContext
              ? buildRepairPrompt(profile, topic, repairContext)
              : buildGenerationPrompt(profile, topic),
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

export function createScriptProvider(env: AppEnv): ScriptProvider {
  if (env.GEMINI_API_KEY) {
    return new GeminiScriptProvider(env.GEMINI_API_KEY);
  }

  return new LocalScriptProvider();
}

function buildGenerationPrompt(profile: ContentProfile, topic: string): string {
  const targetWordsTotal = Math.max(
    profile.sceneCount * 12,
    Math.round(profile.maxDurationSeconds * 2.2)
  );
  const targetWordsPerScene = Math.max(8, Math.round(targetWordsTotal / profile.sceneCount));

  return [
    'Return JSON only that matches the provided schema.',
    `Create a vertical explainer video about "${topic}".`,
    `Use exactly ${profile.sceneCount} scenes.`,
    `Target a total runtime of ${profile.maxDurationSeconds} seconds.`,
    `Aim for roughly ${targetWordsTotal} spoken words total, or about ${targetWordsPerScene} words per scene.`,
    'Write for a narrator reading aloud, with short, spoken sentences instead of dense paragraphs.',
    'Use a hook, problem, demonstration, and payoff structure across the scenes.',
    'Write for people searching for a practical answer, comparison, or tutorial.',
    'If the topic is a product or platform, compare it against the obvious manual workflow or alternative.',
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
  ].join('\n');
}

function buildRepairPrompt(
  profile: ContentProfile,
  topic: string,
  repairContext: RepairContext
): string {
  const targetWordsTotal = Math.max(
    profile.sceneCount * 12,
    Math.round(profile.maxDurationSeconds * 2.2)
  );
  const targetWordsPerScene = Math.max(8, Math.round(targetWordsTotal / profile.sceneCount));

  return [
    'The previous response failed validation.',
    'Repair it so it satisfies the exact same JSON schema and constraints.',
    'Do not add commentary or markdown fences. Return JSON only.',
    `Topic: ${topic}.`,
    `Required scene count: ${profile.sceneCount}.`,
    `Target total duration: ${profile.maxDurationSeconds} seconds.`,
    `Target roughly ${targetWordsTotal} spoken words total, or about ${targetWordsPerScene} words per scene.`,
    'Use a hook, problem, demonstration, and payoff structure across the scenes.',
    'Write for people searching for a practical answer, comparison, or tutorial.',
    'If the topic is a product or platform, compare it against the obvious manual workflow or alternative.',
    'If the topic touches finance, keep it tool-led or comparison-led and avoid advice or promises.',
    'Each tag must be a short keyword or short phrase, not a sentence.',
    'Keep every tag to one to four words, under 40 characters, and avoid punctuation.',
    'If the affiliate link template is empty, keep the CTA educational and do not imply affiliate status.',
    `Validation issue: ${repairContext.issue}`,
    'Previous response:',
    repairContext.rawResponse,
  ].join('\n');
}

function buildScriptResponseJsonSchema(profile: ContentProfile): Record<string, unknown> {
  return {
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
    })),
    totalDurationSeconds: profile.maxDurationSeconds,
  };

  validateScriptTiming(scriptPackage, profile);
  return scriptPackage;
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

function buildLocalSceneIdeas(profile: ContentProfile, topic: string): string[] {
  const nextTopic = profile.preferredTopics[0] ?? 'AI tools that save time';
  return [
    `Most people approach ${topic} backwards. Start with the payoff, not the buzzword.`,
    `The real problem is usually too many steps, too many tabs, or the wrong tool for the job.`,
    `The simplest version is to treat ${topic} as a workflow, not a one-off trick.`,
    `Show the comparison or example that proves why the better option saves time.`,
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
