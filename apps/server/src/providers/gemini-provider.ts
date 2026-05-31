import type { AppEnv } from '@autom/config';
import type {
  ContentProfile,
  DialoguePackage,
  DialogueShotType,
  DialogueTurn,
  ScriptPackage,
} from '@autom/contracts';
import { ScriptPackageSchema } from '@autom/contracts';

import {
  buildVideoKeywords,
  normalizeTags,
} from '../domains/editorial/packaging/hashtag-generator.js';
import {
  CONCRETE_SCENE_RULES,
  MIN_SCENE_DURATION_SECONDS,
  type ScenePlan,
  allocateDurations,
  deriveScenePlan,
  resolveTargetDurationSeconds,
  validateScriptDirectionQuality,
  validateScriptTiming,
} from '../domains/editorial/script-quality.js';
import type { ContentBrief, NewsTopicContext } from '../domains/pipeline/types.js';
import {
  type ContentOrchestrator,
  createContentOrchestrator,
} from '../domains/research/content-orchestrator.js';
import { applySceneVisualModes } from '../lib/dialogue.js';
import type { NewsProvider, ScriptGenerationResult, ScriptProvider } from '../lib/types.js';

const LOCAL_PROMPT_VERSION = 'local-script-template-v1';
const GEMINI_PROMPT_VERSION = 'gemini-script-v1';
const GROQ_PROMPT_VERSION = 'groq-script-v1';
const MISTRAL_PROMPT_VERSION = 'mistral-script-v1';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_GROQ_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_MISTRAL_REQUEST_TIMEOUT_MS = 45_000;
const GROQ_CHAT_COMPLETIONS_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MISTRAL_CHAT_COMPLETIONS_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

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
  contentOrchestrator?: ContentOrchestrator;
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
  contentOrchestrator?: ContentOrchestrator;
};

type MistralChatCompletionInput = {
  model: string;
  messages: GroqChatMessage[];
  temperature?: number;
  response_format?: {
    type: 'json_object';
  };
};

type MistralTextResponse = GroqTextResponse;

type MistralClient = {
  chat: {
    completions: {
      create(input: MistralChatCompletionInput): Promise<MistralTextResponse>;
    };
  };
};

type MistralClientFactory = () => Promise<MistralClient> | MistralClient;

type MistralScriptProviderOptions = {
  createClient?: MistralClientFactory;
  maxAttempts?: number;
  model?: string;
  promptVersion?: string;
  requestTimeoutMs?: number;
  newsProvider?: NewsProvider;
  contentOrchestrator?: ContentOrchestrator;
};

type RepairContext = {
  issue: string;
  rawResponse: string;
};

type ScriptProviderLabel = 'local' | 'gemini' | 'groq' | 'mistral';

type ResearchContext = {
  newsContext: NewsTopicContext | null;
  contentBrief: ContentBrief | null;
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
  constructor(
    private readonly newsProvider?: NewsProvider,
    private readonly contentOrchestrator?: ContentOrchestrator
  ) {}

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const researchContext = await resolveResearchContext(
      this.contentOrchestrator,
      this.newsProvider,
      profile,
      topic
    );
    const { newsContext, contentBrief } = researchContext;
    assertResearchSufficiency(topic, contentBrief);
    const scenePlan = deriveScenePlan(profile.maxDurationSeconds);
    const baseSceneIdeas = buildLocalSceneIdeas(
      profile,
      topic,
      newsContext,
      scenePlan.targetSceneCount
    );
    const sceneDurations = allocateDurations(
      Array.from({ length: scenePlan.targetSceneCount }, () => 1),
      resolveTargetDurationSeconds(baseSceneIdeas, profile.maxDurationSeconds)
    );

    const scenes = Array.from({ length: scenePlan.targetSceneCount }, (_, index) => ({
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
      totalDurationSeconds: sceneDurations.reduce((sum, value) => sum + value, 0),
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
        searchProvider: contentBrief?.searchProvider ?? 'none',
        rerankProvider: contentBrief?.rerankProvider ?? 'none',
        verificationStatus: contentBrief?.verificationStatus ?? 'unverified',
        evidenceSourceCount: contentBrief?.evidence.items.length ?? 0,
        fallbackProvider: null,
        providerChain: ['local'],
        categoryId: contentBrief?.category?.id ?? null,
        categoryLabel: contentBrief?.category?.label ?? null,
        platformFit: contentBrief?.category?.platformFit ?? null,
        countryTargets: contentBrief?.category?.countryTargets ?? [],
        monetizationScore: contentBrief?.monetizationScore?.total ?? null,
        storyAngle: contentBrief?.storyAngle?.highStakesAngle ?? null,
        hookStyle: contentBrief?.storyAngle?.hookStyle ?? null,
        warnings: contentBrief?.warnings ?? [],
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
  private readonly contentOrchestrator?: ContentOrchestrator;

  constructor(
    private readonly apiKey: string,
    options: GroqScriptProviderOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.model = options.model ?? DEFAULT_GROQ_MODEL;
    this.promptVersion = options.promptVersion ?? GROQ_PROMPT_VERSION;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_GROQ_REQUEST_TIMEOUT_MS;
    this.newsProvider = options.newsProvider;
    this.contentOrchestrator = options.contentOrchestrator;
    this.createClient =
      options.createClient ?? (() => createGroqClient(this.apiKey, this.requestTimeoutMs));
  }

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const client = await this.createClient();
    const researchContext = await resolveResearchContext(
      this.contentOrchestrator,
      this.newsProvider,
      profile,
      topic
    );
    const { newsContext, contentBrief } = researchContext;
    assertResearchSufficiency(topic, contentBrief);
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
                ? buildRepairPrompt(profile, topic, repairContext, newsContext, contentBrief)
                : buildGenerationPrompt(profile, topic, newsContext, contentBrief),
            },
          ],
          temperature: 0.2,
          response_format: {
            type: 'json_object',
          },
        });

        const rawText = readGroqResponseText(response);
        const scriptPackage = parseGeminiScript(rawText, profile, topic, contentBrief);

        return {
          scriptPackage,
          scriptMetadata: {
            provider: 'groq',
            model: this.model,
            promptVersion: this.promptVersion,
            mode: 'live',
            attemptCount: attempt,
            repaired: repairContext !== null,
            searchProvider: contentBrief?.searchProvider ?? 'none',
            rerankProvider: contentBrief?.rerankProvider ?? 'none',
            verificationStatus: contentBrief?.verificationStatus ?? 'unverified',
            evidenceSourceCount: contentBrief?.evidence.items.length ?? 0,
            fallbackProvider: null,
            providerChain: ['groq'],
            categoryId: contentBrief?.category?.id ?? null,
            categoryLabel: contentBrief?.category?.label ?? null,
            platformFit: contentBrief?.category?.platformFit ?? null,
            countryTargets: contentBrief?.category?.countryTargets ?? [],
            monetizationScore: contentBrief?.monetizationScore?.total ?? null,
            storyAngle: contentBrief?.storyAngle?.highStakesAngle ?? null,
            hookStyle: contentBrief?.storyAngle?.hookStyle ?? null,
            warnings: contentBrief?.warnings ?? [],
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
      label: ScriptProviderLabel;
      provider: ScriptProvider;
    }>
  ) {}

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const failures: string[] = [];
    const attemptedProviders: string[] = [];

    for (const candidate of this.providers) {
      try {
        attemptedProviders.push(candidate.label);
        const result = await candidate.provider.generate(profile, topic);
        return {
          ...result,
          scriptMetadata: {
            ...result.scriptMetadata,
            fallbackProvider: attemptedProviders.length > 1 ? candidate.label : null,
            providerChain: attemptedProviders,
            warnings:
              attemptedProviders.length > 1
                ? [
                    ...result.scriptMetadata.warnings,
                    `Primary script provider fell back to ${candidate.label}.`,
                  ]
                : result.scriptMetadata.warnings,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown script generation failure.';
        failures.push(`${candidate.label}: ${message}`);
      }
    }

    throw new Error(`All script providers failed. ${failures.join(' | ')}`);
  }
}

export class MistralScriptProvider implements ScriptProvider {
  private readonly createClient: MistralClientFactory;
  private readonly maxAttempts: number;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly newsProvider?: NewsProvider;
  private readonly contentOrchestrator?: ContentOrchestrator;

  constructor(
    private readonly apiKey: string,
    options: MistralScriptProviderOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.model = options.model ?? 'mistral-small-latest';
    this.promptVersion = options.promptVersion ?? MISTRAL_PROMPT_VERSION;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_MISTRAL_REQUEST_TIMEOUT_MS;
    this.newsProvider = options.newsProvider;
    this.contentOrchestrator = options.contentOrchestrator;
    this.createClient =
      options.createClient ?? (() => createMistralClient(this.apiKey, this.requestTimeoutMs));
  }

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const client = await this.createClient();
    const researchContext = await resolveResearchContext(
      this.contentOrchestrator,
      this.newsProvider,
      profile,
      topic
    );
    const { newsContext, contentBrief } = researchContext;
    assertResearchSufficiency(topic, contentBrief);
    let repairContext: RepairContext | null = null;
    let lastIssue = 'Mistral did not return a usable script.';

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
                ? buildRepairPrompt(profile, topic, repairContext, newsContext, contentBrief)
                : buildGenerationPrompt(profile, topic, newsContext, contentBrief),
            },
          ],
          temperature: 0.2,
          response_format: {
            type: 'json_object',
          },
        });

        const rawText = readGroqResponseText(response);
        const scriptPackage = parseGeminiScript(rawText, profile, topic, contentBrief);

        return {
          scriptPackage,
          scriptMetadata: {
            provider: 'mistral',
            model: this.model,
            promptVersion: this.promptVersion,
            mode: 'live',
            attemptCount: attempt,
            repaired: repairContext !== null,
            searchProvider: contentBrief?.searchProvider ?? 'none',
            rerankProvider: contentBrief?.rerankProvider ?? 'none',
            verificationStatus: contentBrief?.verificationStatus ?? 'unverified',
            evidenceSourceCount: contentBrief?.evidence.items.length ?? 0,
            fallbackProvider: null,
            providerChain: ['mistral'],
            categoryId: contentBrief?.category?.id ?? null,
            categoryLabel: contentBrief?.category?.label ?? null,
            platformFit: contentBrief?.category?.platformFit ?? null,
            countryTargets: contentBrief?.category?.countryTargets ?? [],
            monetizationScore: contentBrief?.monetizationScore?.total ?? null,
            storyAngle: contentBrief?.storyAngle?.highStakesAngle ?? null,
            hookStyle: contentBrief?.storyAngle?.hookStyle ?? null,
            warnings: contentBrief?.warnings ?? [],
          },
        };
      } catch (error) {
        lastIssue = error instanceof Error ? error.message : 'Unknown Mistral generation failure.';
        repairContext =
          error instanceof MalformedScriptResponseError
            ? {
                issue: lastIssue,
                rawResponse: error.rawResponse,
              }
            : null;
      }
    }

    throw new Error(`Mistral generation failed after ${this.maxAttempts} attempts. ${lastIssue}`);
  }
}

export class GeminiScriptProvider implements ScriptProvider {
  private readonly createClient: GeminiClientFactory;
  private readonly maxAttempts: number;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly newsProvider?: NewsProvider;
  private readonly contentOrchestrator?: ContentOrchestrator;

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
    this.contentOrchestrator = options.contentOrchestrator;
  }

  async generate(profile: ContentProfile, topic: string): Promise<ScriptGenerationResult> {
    const client = await this.createClient();
    const researchContext = await resolveResearchContext(
      this.contentOrchestrator,
      this.newsProvider,
      profile,
      topic
    );
    const { newsContext, contentBrief } = researchContext;
    assertResearchSufficiency(topic, contentBrief);
    let repairContext: RepairContext | null = null;
    let lastIssue = 'Gemini did not return a usable script.';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await withTimeout(
          client.models.generateContent({
            model: this.model,
            contents: repairContext
              ? buildRepairPrompt(profile, topic, repairContext, newsContext, contentBrief)
              : buildGenerationPrompt(profile, topic, newsContext, contentBrief),
            config: {
              responseMimeType: 'application/json',
              responseJsonSchema: buildScriptResponseJsonSchema(profile),
            },
          }),
          this.requestTimeoutMs,
          `Gemini request timed out after ${this.requestTimeoutMs}ms.`
        );

        const rawText = readGeminiResponseText(response);
        const scriptPackage = parseGeminiScript(rawText, profile, topic, contentBrief);

        return {
          scriptPackage,
          scriptMetadata: {
            provider: 'gemini',
            model: this.model,
            promptVersion: this.promptVersion,
            mode: 'live',
            attemptCount: attempt,
            repaired: repairContext !== null,
            searchProvider: contentBrief?.searchProvider ?? 'none',
            rerankProvider: contentBrief?.rerankProvider ?? 'none',
            verificationStatus: contentBrief?.verificationStatus ?? 'unverified',
            evidenceSourceCount: contentBrief?.evidence.items.length ?? 0,
            fallbackProvider: null,
            providerChain: ['gemini'],
            categoryId: contentBrief?.category?.id ?? null,
            categoryLabel: contentBrief?.category?.label ?? null,
            platformFit: contentBrief?.category?.platformFit ?? null,
            countryTargets: contentBrief?.category?.countryTargets ?? [],
            monetizationScore: contentBrief?.monetizationScore?.total ?? null,
            storyAngle: contentBrief?.storyAngle?.highStakesAngle ?? null,
            hookStyle: contentBrief?.storyAngle?.hookStyle ?? null,
            warnings: contentBrief?.warnings ?? [],
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
  const contentOrchestrator = createContentOrchestrator(env, newsProvider);
  const providers: Array<{ label: ScriptProviderLabel; provider: ScriptProvider }> = [];

  if (env.GEMINI_API_KEY) {
    providers.push({
      label: 'gemini',
      provider: new GeminiScriptProvider(env.GEMINI_API_KEY, {
        model: env.GEMINI_SCRIPT_MODEL,
        newsProvider,
        contentOrchestrator,
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
        contentOrchestrator,
      }),
    });
  }

  if (env.MISTRAL_API_KEY) {
    providers.push({
      label: 'mistral',
      provider: new MistralScriptProvider(env.MISTRAL_API_KEY, {
        model: env.MISTRAL_SCRIPT_MODEL,
        requestTimeoutMs: env.MISTRAL_SCRIPT_TIMEOUT_SECONDS * 1000,
        newsProvider,
        contentOrchestrator,
      }),
    });
  }

  providers.push({
    label: 'local',
    provider: new LocalScriptProvider(newsProvider, contentOrchestrator),
  });

  return providers.length === 1 ? providers[0].provider : new FallbackScriptProvider(providers);
}

function buildGenerationPrompt(
  profile: ContentProfile,
  topic: string,
  newsContext: NewsTopicContext | null,
  contentBrief: ContentBrief | null
): string {
  const scenePlan = deriveScenePlan(profile.maxDurationSeconds);
  const targetWordsTotal = Math.max(
    scenePlan.targetSceneCount * 15,
    // 1.85 wps matches actual TTS output rate — keeps scripts within duration budget.
    Math.round(profile.maxDurationSeconds * 1.85)
  );
  const targetWordsPerScene = Math.max(
    8,
    Math.round(targetWordsTotal / scenePlan.targetSceneCount)
  );

  const promptLines = [
    'Return JSON only that matches the provided schema.',
    `Write the script about the exact topic "${topic}".`,
    'Do not replace the topic with an unrelated example or an invented internal placeholder.',
    `Use between ${scenePlan.minSceneCount} and ${scenePlan.maxSceneCount} scenes.`,
    `Aim for about ${scenePlan.targetSceneCount} scenes unless the story clearly needs one more or one less.`,
    `Keep the total runtime at or below ${profile.maxDurationSeconds} seconds.`,
    `Aim for roughly ${targetWordsTotal} spoken words total, or about ${targetWordsPerScene} words per scene, written for a narrator reading aloud.`,
    'Use short, spoken sentences instead of dense paragraphs.',
    'Use simple everyday English. Choose plain words over polished business language.',
    'Write like a smart person explaining this to one friend out loud.',
    'Use contractions where they sound natural.',
    'A few short fragments are fine if they sound punchy when read aloud.',
    'Avoid generic filler language and keep every scene concrete.',

    // ── Hook formula — MANDATORY for Scene 1 ────────────────────────────
    'Scene 1 MUST use one of these four opening formulas — choose the best fit, do not invent a fifth:',
    '  Hook A — Contradiction: "[X] is [positive fact]. But [unexpected bad outcome]. Here is why."',
    '  Hook B — Number: "[Specific statistic or count]. That is how many [thing]. And it changes how you think about [topic]."',
    '  Hook C — Reversal: "Everyone believes [common assumption about topic]. The actual [data/record/evidence] says the opposite."',
    '  Hook D — Stakes: "By [specific timeframe], [topic-related thing] will [significant change]. Most people will not see it coming."',
    `Scene 1 must NOT open with: "In today's video", "Today we're going to", "Welcome back", "This is about", or any other preamble.`,
    'Scene 1 must feel like something the viewer learned in the first 5 seconds — stop-the-scroll energy.',

    // ── 3-beat structure ─────────────────────────────────────────────────
    'Structure the full script as three beats:',
    `  Beat 1 — Disruption (Scene 1): break the viewer's existing mental model with the hook.`,
    '  Beat 2 — Evidence stack (middle scenes): escalate — each scene adds a new complication, stat, or consequence.',
    `  Beat 3 — Reframe (final scene): deliver a perspective shift, not a summary. The viewer should feel they now see something others don't.`,

    // ── Visual queries — documentary-style specificity REQUIRED ──────────
    'Every visualQuery must describe a specific filmable scene as a documentary crew would record it.',
    'Name the objects, people, actions, setting, and time of day if it matters.',
    'Good: "cargo containers being unloaded at a harbour at dawn", "1970s factory workers on assembly line archival footage", "solar panels on a township rooftop", "trader watching multiple screens in a dark trading floor".',
    'Bad: "economic activity", "technology background", "business concept", "success", "money and people".',
    'Abstract nouns alone are not visual queries. Every query must anchor to something a camera can see.',

    'Each new scene must add a fresh detail, contrast, or consequence — no scene should feel interchangeable with another.',
    'Do not use lazy filler lines like "this matters because" unless you immediately follow with a concrete consequence.',
    'Avoid jargon like landscape, leverage, ecosystem, transformation, unlock, optimize, or synergy.',
    'Avoid robotic transitions like moreover, furthermore, additionally, and it is important to note.',
    'Avoid generic AI phrasing like "the interesting part is", "the real problem is", or "the payoff is".',

    // ── Retention engineering (2026 algorithm research) ────────────────
    `Midpoint retention trap (REQUIRED): At approximately the halfway scene of this script, include a genuinely surprising reveal, a counterintuitive finding, or a question the viewer desperately wants answered. This is the single highest-leverage moment for completion rate. Do not skip this.`,
    'Forward hooks (REQUIRED): At the end of every other scene, include one sentence that teases what comes next. Examples: "But here is where it gets surprising.", "What happened next is something almost nobody expected.", "The next part is the one most people never hear about." Never repeat the same forward hook phrase. These keep viewers watching for the next 60-90 seconds.',

    ...CONCRETE_SCENE_RULES,
    'Each scene must include text, visualQuery, and durationSeconds.',
    'Keep each scene at least 3 seconds long.',
    'Keep each scene readable on a phone screen and avoid overlong caption blocks.',
    // Binge-chain instruction — generates the watch-next suggestion for YouTube end screens
    `Include a nextVideoSuggestion field: a single specific topic sentence describing what a viewer who enjoyed this video would want to watch next. It should be a natural follow-on — not a generic suggestion. Example: if this video is about South Africa's electricity grid history, a good nextVideoSuggestion is "Why South Africa's water infrastructure was designed the way it was in 1960". Bad: "Watch more videos about South Africa".`,
    `Tone: ${profile.tone}.`,
    `Content categories: ${joinOrNone(profile.contentCategories.map((category) => category.label))}.`,
    `Local context required: ${profile.contentCategories.some((c) => c.localContextRequired) ? 'yes — ground the script in local or regional examples, prices, people, or events where relevant' : 'no'}.`,
    `Scene 1 hook formula: ${profile.contentCategories[0]?.topicHookFormula && profile.contentCategories[0]?.topicHookFormula !== 'auto' ? profile.contentCategories[0].topicHookFormula : 'choose best fit from Hook A/B/C/D above'}.`,
    'Each tag must be a short keyword or short phrase, not a sentence.',
    'Keep every tag under 50 characters and avoid punctuation.',
    `CTA style: ${profile.callToActionStyle}.`,
    `CTA guardrails: ${profile.callToActionGuardrails}.`,
    `Affiliate disclosure required: ${profile.requireAffiliateDisclosure ? 'yes' : 'no'}.`,
    'If the affiliate link template is empty, keep the CTA educational and do not imply affiliate status.',
    'Title should sound search-led and specific, not generic or hypey.',
    'Description should summarize the practical payoff and context clearly.',
    'Keep tags lowercase, concise, and omit the # symbol.',
    'Keep each tag to one to four words. Do not return sentence-length tags.',
    'Place the strongest call to action near the final scene only.',
  ];

  if (profile.topicSource === 'daily_news') {
    promptLines.push(
      'This is a current news explainer, not a tutorial.',
      'Start with the sharpest update, then explain what changed and why it matters.',
      'Keep background short. Stay on the new development.',
      'Humanize the narration with restrained conversational phrasing.',
      'Allow one light human reaction at most, but keep it clearly framed as commentary, not facts.',
      'If part of the story is still unclear, say that plainly.'
    );
  } else {
    promptLines.push(
      'Write for someone who wants a clear answer fast, not a formal explainer.',
      'If the topic is a product or platform, compare it against the obvious manual workflow or alternative.',
      'Include at least one practical example or comparison in the middle scenes.',
      'For finance, SaaS, or SEO topics, name one specific scenario, metric, account type, workflow step, or screen the viewer would actually inspect.',
      'If the topic touches finance, keep it tool-led or comparison-led and avoid advice or promises.'
    );
  }

  if (contentBrief) {
    promptLines.push(
      `Canonical angle: ${contentBrief.angle}.`,
      `Chosen category: ${contentBrief.category?.label ?? 'none'}.`,
      `Content type: ${contentBrief.contentType}.`,
      `Verification status: ${contentBrief.verificationStatus}.`,
      `Evidence source count: ${contentBrief.evidence.items.length}.`,
      `Monetization score: ${contentBrief.monetizationScore?.total ?? 'unknown'}.`,
      `Country targets: ${joinOrNone(contentBrief.category?.countryTargets ?? [])}.`,
      `Key entities: ${joinOrNone(contentBrief.keyEntities)}.`,
      `Desired visuals: ${joinOrNone(contentBrief.desiredVisuals)}.`,
      `Allowed sources: ${joinOrNone(contentBrief.allowedSources)}.`,
      `Tone guidance: ${joinOrNone(contentBrief.toneGuidance)}.`
    );

    if (contentBrief.storyAngle) {
      promptLines.push(
        `Core hook: ${contentBrief.storyAngle.coreHook}.`,
        `Curiosity gap: ${contentBrief.storyAngle.curiosityGap}.`,
        `High-stakes angle: ${contentBrief.storyAngle.highStakesAngle}.`,
        `Concrete implication: ${contentBrief.storyAngle.concreteImplication}.`,
        `Twist or payoff: ${contentBrief.storyAngle.twistOrPayoff}.`,
        `Visual moments: ${joinOrNone(contentBrief.storyAngle.visualMoments)}.`,
        `Hook style: ${contentBrief.storyAngle.hookStyle}.`
      );
    }

    if (contentBrief.factualClaims.length > 0) {
      promptLines.push(`Supported factual claims: ${contentBrief.factualClaims.join(' || ')}.`);
    }

    if (contentBrief.evidence.items.length > 0) {
      promptLines.push(
        'Use the evidence list below to anchor the script. Do not invent facts beyond it.',
        ...contentBrief.evidence.items
          .slice(0, 5)
          .map(
            (item, index) =>
              `Evidence ${index + 1}: ${item.title} | ${item.sourceName ?? 'unknown source'} | ${
                item.publishedAt ?? 'unknown date'
              } | ${item.snippet ?? 'no snippet'}`
          )
      );
    }
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
  newsContext: NewsTopicContext | null,
  contentBrief: ContentBrief | null
): string {
  const scenePlan = deriveScenePlan(profile.maxDurationSeconds);
  const targetWordsTotal = Math.max(
    scenePlan.targetSceneCount * 15,
    Math.round(profile.maxDurationSeconds * 2.4)
  );
  const targetWordsPerScene = Math.max(
    8,
    Math.round(targetWordsTotal / scenePlan.targetSceneCount)
  );

  const promptLines = [
    'The previous response failed validation.',
    'Repair it so it satisfies the exact same JSON schema and constraints.',
    'Do not add commentary or markdown fences. Return JSON only.',
    `Topic: ${topic}.`,
    // Restate scene count constraint explicitly — the most common repair failure
    // is returning too few scenes because the model forgets the limit mid-repair.
    `REQUIRED scene count: minimum ${scenePlan.minSceneCount}, maximum ${scenePlan.maxSceneCount}. This is a hard constraint — do not return fewer than ${scenePlan.minSceneCount} scenes under any circumstances.`,
    `Target scene count: about ${scenePlan.targetSceneCount}.`,
    `Target total duration: ${profile.maxDurationSeconds} seconds.`,
    `Target roughly ${targetWordsTotal} spoken words total, or about ${targetWordsPerScene} words per scene.`,
    'Use simple, spoken English and avoid polished jargon.',
    'Write like a smart person explaining it out loud, not a polished brand script.',
    'Use contractions where they sound natural.',
    'Avoid generic filler language and keep every scene concrete.',
    'Make the opening feel worth stopping for immediately.',
    'Escalate scene by scene instead of rephrasing the same idea.',
    'Avoid words like leverage, ecosystem, transformation, unlock, optimize, and synergy.',
    'Avoid robotic transitions like moreover, furthermore, additionally, and it is important to note.',
    'Avoid generic AI phrasing like "the interesting part is", "the real problem is", or "the payoff is".',
    ...CONCRETE_SCENE_RULES,
    'Each tag must be a short keyword or short phrase, not a sentence.',
    'Keep every tag to one to four words, under 40 characters, and avoid punctuation.',
    'If the affiliate link template is empty, keep the CTA educational and do not imply affiliate status.',
    `Validation issue: ${repairContext.issue}`,
    'Previous response:',
    repairContext.rawResponse,
  ];

  if (profile.topicSource === 'daily_news') {
    promptLines.push(
      'Treat this as a current news explainer, not a tutorial.',
      'Lead with the new development, not a long setup.'
    );
  } else {
    promptLines.push(
      'If the topic is a product or platform, compare it against the obvious manual workflow or alternative.',
      'Include at least one practical example or comparison in the middle scenes.',
      'For finance, SaaS, or SEO topics, name one specific scenario, metric, account type, workflow step, or screen the viewer would actually inspect.',
      'If the topic touches finance, keep it tool-led or comparison-led and avoid advice or promises.'
    );
  }

  if (contentBrief) {
    promptLines.push(
      `Canonical angle: ${contentBrief.angle}.`,
      `Chosen category: ${contentBrief.category?.label ?? 'none'}.`,
      `Verification status: ${contentBrief.verificationStatus}.`,
      `Evidence source count: ${contentBrief.evidence.items.length}.`,
      `Tone guidance: ${joinOrNone(contentBrief.toneGuidance)}.`
    );

    if (contentBrief.storyAngle) {
      promptLines.push(
        `Core hook: ${contentBrief.storyAngle.coreHook}.`,
        `Curiosity gap: ${contentBrief.storyAngle.curiosityGap}.`,
        `Concrete implication: ${contentBrief.storyAngle.concreteImplication}.`,
        `Twist or payoff: ${contentBrief.storyAngle.twistOrPayoff}.`
      );
    }

    if (contentBrief.evidence.items.length > 0) {
      promptLines.push(
        ...contentBrief.evidence.items
          .slice(0, 5)
          .map(
            (item, index) =>
              `Evidence ${index + 1}: ${item.title} | ${item.sourceName ?? 'unknown source'} | ${
                item.publishedAt ?? 'unknown date'
              } | ${item.snippet ?? 'no snippet'}`
          )
      );
    }
  }

  if (profile.topicSource === 'daily_news') {
    promptLines.push(
      'Keep the script grounded in the supplied current news context.',
      'Do not invent facts, timelines, quotes, or company motives.',
      'Make the narration feel natural with restrained conversational phrasing.'
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

async function resolveResearchContext(
  contentOrchestrator: ContentOrchestrator | undefined,
  newsProvider: NewsProvider | undefined,
  profile: ContentProfile,
  topic: string
): Promise<ResearchContext> {
  const newsContext = await resolveNewsContext(newsProvider, profile, topic);

  if (!contentOrchestrator) {
    return {
      newsContext,
      contentBrief: null,
    };
  }

  try {
    return {
      newsContext,
      contentBrief: await contentOrchestrator.buildBrief(profile, topic),
    };
  } catch {
    return {
      newsContext,
      contentBrief: null,
    };
  }
}

function assertResearchSufficiency(topic: string, contentBrief: ContentBrief | null): void {
  if (!contentBrief) {
    return;
  }

  if (contentBrief.exactEvidenceRequired && contentBrief.evidence.items.length === 0) {
    throw new Error(
      `No trusted evidence was available for "${topic}". Configure Tavily/Cohere or choose a better-supported topic.`
    );
  }

  if (
    contentBrief.exactEvidenceRequired &&
    contentBrief.verificationStatus === 'degraded' &&
    contentBrief.searchProvider !== 'news' &&
    contentBrief.evidence.items.length < 2
  ) {
    throw new Error(
      `Evidence for "${topic}" is too weak to publish safely. Retry after search providers are configured.`
    );
  }
}

function buildScriptResponseJsonSchema(profile: ContentProfile): Record<string, unknown> {
  const scenePlan = deriveScenePlan(profile.maxDurationSeconds);
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
        minItems: scenePlan.minSceneCount,
        maxItems: scenePlan.maxSceneCount,
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
        minimum: scenePlan.minSceneCount * 3,
        maximum: profile.maxDurationSeconds,
      },
      // A specific topic suggestion for the "watch next" end screen CTA.
      // One sentence describing what a viewer who enjoyed this video would want to watch next.
      // Example: "How South Africa's water infrastructure was designed in 1950"
      // This enables YouTube's binge signal — the strongest growth driver for faceless channels.
      nextVideoSuggestion: {
        type: 'string',
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

function parseGeminiScript(
  rawText: string,
  profile: ContentProfile,
  topic: string,
  contentBrief: ContentBrief | null
): ScriptPackage {
  let payload: unknown;

  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new MalformedScriptResponseError('Gemini returned invalid JSON.', rawText);
  }

  try {
    const normalizedScript = normalizeScriptDraft(payload, profile, topic, contentBrief);
    return ScriptPackageSchema.parse(normalizedScript);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini returned invalid script data.';
    throw new MalformedScriptResponseError(message, rawText);
  }
}

function normalizeScriptDraft(
  payload: unknown,
  profile: ContentProfile,
  topic: string,
  contentBrief: ContentBrief | null
): ScriptPackage {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Gemini response must be a JSON object.');
  }

  const record = payload as Record<string, unknown>;
  const scenesInput = Array.isArray(record.scenes) ? record.scenes : null;
  const scenePlan = deriveScenePlan(profile.maxDurationSeconds);

  if (!scenesInput) {
    throw new Error('Gemini response must include a scenes array.');
  }

  if (
    scenesInput.length < scenePlan.minSceneCount ||
    scenesInput.length > scenePlan.maxSceneCount
  ) {
    throw new Error(
      `Gemini must return between ${scenePlan.minSceneCount} and ${scenePlan.maxSceneCount} scenes.`
    );
  }

  const scenes = scenesInput.map((scene, index) => normalizeSceneDraft(scene, index));
  const resolvedTargetDurationSeconds = resolveTargetDurationSeconds(
    scenes.map((scene) => scene.text),
    profile.maxDurationSeconds,
    typeof record.totalDurationSeconds === 'number' ? record.totalDurationSeconds : null
  );
  const durationTargets = allocateDurations(
    scenes.map((scene) => scene.durationSeconds),
    resolvedTargetDurationSeconds
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
    totalDurationSeconds: resolvedTargetDurationSeconds,
    dialogue: null,
    nextVideoSuggestion:
      typeof record.nextVideoSuggestion === 'string' && record.nextVideoSuggestion.trim().length > 0
        ? record.nextVideoSuggestion.trim()
        : null,
  };

  const normalizedScriptPackage = applySceneVisualModes(profile, scriptPackage);
  validateScriptDirectionQuality(normalizedScriptPackage, contentBrief);
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

function buildLocalSceneIdeas(
  profile: ContentProfile,
  topic: string,
  newsContext: NewsTopicContext | null,
  sceneCount: number
): string[] {
  const nextTopic =
    profile.contentCategories[0]?.exampleTopics[0] ??
    'the next business or tech story worth watching';
  const topicKey = topic.toLowerCase();

  if (profile.topicSource === 'daily_news' && newsContext) {
    const source = newsContext.sourceName ? ` according to ${newsContext.sourceName}` : '';
    return [
      `${topic}${source} is the story today, and the first beat says the actual update fast.`,
      'The next beat explains what changed in plain English so the viewer does not need the article open.',
      'Then show what is different from yesterday, last quarter, or the old expectation so the shift feels real.',
      'Spell out who gets hit first, who benefits, and what people still do not know yet.',
      'Add one light reaction if it fits, then bring it straight back to the facts.',
      `${profile.callToActionTemplate}`,
      `If you want tomorrow's simplified headline, come back for the next story.`,
      'Save this if you want the quick version without digging through ten articles.',
    ].slice(0, sceneCount);
  }

  if (/retirement/.test(topicKey)) {
    return [
      'Most retirement tool videos stay vague. Start with one real job: tracking contributions, fees, and account mix in one place.',
      'Open a Roth IRA or 401k dashboard and look for the numbers that actually matter: contribution room, employer match, and expense ratio.',
      'A useful tool should show what changes when a monthly contribution goes from 200 to 300 on the same timeline.',
      'The stronger option makes that comparison obvious on one screen instead of sending you back to spreadsheets and account tabs.',
      'What you want at the end is fewer blind spots and a plan you can check in a few minutes each month.',
      `${profile.callToActionTemplate}`,
      `If you want the next practical topic, try ${nextTopic}.`,
      'Save this checklist and use it before you pick the next retirement tool.',
    ].slice(0, sceneCount);
  }

  if (/real estate/.test(topicKey)) {
    return [
      'The easiest way to judge a real estate investing tool is simple: can it help you read one deal without drowning you in noise.',
      'Start with the real inputs: rent, vacancy, repairs, financing, and the cap rate or cash flow the tool spits out.',
      'A good dashboard should let you test one change, like higher interest or lower occupancy, without rebuilding the whole deal in a spreadsheet.',
      'The better option cuts out manual copy and paste and gives you a repeatable way to review every listing.',
      'That means faster go or no-go calls and fewer bad assumptions hiding in the numbers.',
      `${profile.callToActionTemplate}`,
      `If you want the next practical topic, try ${nextTopic}.`,
      'Save this process and use it the next time a deal looks better than it really is.',
    ].slice(0, sceneCount);
  }

  if (/seo|programmatic/.test(topicKey)) {
    return [
      'Programmatic SEO only works when the workflow is real, so start with one page type, one keyword cluster, and one template.',
      'The first screen to check is the keyword map: search intent, support terms, and the page pattern you can safely repeat.',
      'A practical tool should show where pages are thin, where internal links are missing, and which template fields still need real data.',
      'The stronger setup replaces random publishing with a repeatable system that includes templates, QA, and indexing checks.',
      'That gets you fewer junk pages and cleaner coverage when you scale.',
      `${profile.callToActionTemplate}`,
      `If you want the next practical topic, try ${nextTopic}.`,
      'Save this breakdown and use it before you scale another batch of pages.',
    ].slice(0, sceneCount);
  }

  if (/crm|saas|workflow|automation/.test(topicKey)) {
    return [
      `The useful way to judge ${topic} is to follow one lead or one task from start to finish, not skim a feature list.`,
      'Check the real workflow: where the lead lands, who gets pinged, what data gets saved, and which step still needs a human.',
      'A practical demo should show the trigger, the handoff, and the one screen where the team saves the most time.',
      'The better option cuts down spreadsheet follow-up and tab switching with a workflow you can actually track.',
      'That gives you fewer dropped steps and clearer ownership.',
      `${profile.callToActionTemplate}`,
      `If you want the next practical topic, try ${nextTopic}.`,
      'Save this workflow and use it the next time a tool promises more than it proves.',
    ].slice(0, sceneCount);
  }

  return [
    `${topic} gets framed in a vague way too often, so start with the real use case instead of the buzzword.`,
    'Usually the problem is simple: too many steps, too many tabs, or the wrong tool for the job.',
    `A cleaner way to explain ${topic} is to show it as a repeatable workflow, not a magic trick.`,
    'Show the actual screen, metric, or comparison that proves why the better option saves time.',
    'End on the real benefit: less friction and a process someone can repeat tomorrow.',
    `${profile.callToActionTemplate}`,
    `If you want the next practical topic, try ${nextTopic}.`,
    'Save this workflow and use it the next time you need a simpler path.',
  ].slice(0, sceneCount);
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

async function createMistralClient(apiKey: string, timeoutMs: number): Promise<MistralClient> {
  return {
    chat: {
      completions: {
        create: async (input) => {
          let response: Response;
          try {
            response = await fetch(MISTRAL_CHAT_COMPLETIONS_ENDPOINT, {
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
              throw new Error(`Mistral request timed out after ${timeoutMs}ms.`);
            }

            throw error;
          }

          if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(
              `Mistral request failed with status ${response.status}.${body ? ` ${body}` : ''}`
            );
          }

          return (await response.json()) as MistralTextResponse;
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
