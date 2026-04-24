import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultProfile } from '../src/lib/default-profile.js';
import {
  FallbackScriptProvider,
  GeminiScriptProvider,
  GroqScriptProvider,
  LocalScriptProvider,
  MistralScriptProvider,
} from '../src/providers/gemini-provider.js';
import {
  ContentOrchestrator,
  FallbackSearchProvider,
  HeuristicRerankProvider,
} from '../src/providers/content-orchestrator.js';

function createScriptTestProfile() {
  return {
    ...createDefaultProfile(),
    contentMode: 'narration' as const,
    topicSource: 'category_pool' as const,
  };
}

test('GeminiScriptProvider retries malformed responses and repairs them', async () => {
  const profile = createScriptTestProfile();
  const requests: Array<{ contents: string; config: { responseMimeType: string } }> = [];
  let callCount = 0;
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 3,
    createClient: async () => ({
      models: {
        generateContent: async (input) => {
          requests.push(input);
          callCount += 1;

          if (callCount === 1) {
            return {
              text: '{"title":"Broken draft"}',
            };
          }

          return {
            text: JSON.stringify({
              title: 'Focus systems that scale',
              description: 'A short lesson on building focus systems with intention.',
              tags: ['focus', 'systems'],
              scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
                text:
                  index === 2
                    ? 'For example, compare a scattered task list with one focused workflow and track the time saved.'
                    : `Scene ${index + 1} about focus systems with practical direction.`,
                visualQuery: `focus systems monochrome vertical ${index + 1}`,
                durationSeconds: 4,
              })),
              totalDurationSeconds: profile.sceneCount * 4,
            }),
          };
        },
      },
    }),
  });

  const result = await provider.generate(profile, 'focus systems');

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.config.responseMimeType, 'application/json');
  assert.ok('responseJsonSchema' in (requests[0]?.config ?? {}));
  assert.match(requests[1]?.contents ?? '', /previous response failed validation/i);
  assert.equal(result.scriptMetadata.provider, 'gemini');
  assert.equal(result.scriptMetadata.mode, 'live');
  assert.equal(result.scriptMetadata.promptVersion, 'gemini-script-v1');
  assert.equal(result.scriptMetadata.attemptCount, 2);
  assert.equal(result.scriptMetadata.repaired, true);
  assert.equal(result.scriptPackage.scenes.length, profile.sceneCount);
  assert.ok(result.scriptPackage.totalDurationSeconds <= profile.maxDurationSeconds);
  assert.ok(result.scriptPackage.totalDurationSeconds >= profile.sceneCount * 3);
});

test('GeminiScriptProvider retries scripts that exceed the duration budget', async () => {
  const profile = createScriptTestProfile();
  const requests: Array<{ contents: string; config: { responseMimeType: string } }> = [];
  let callCount = 0;
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 2,
    createClient: async () => ({
      models: {
        generateContent: async (input) => {
          requests.push(input);
          callCount += 1;

          if (callCount === 1) {
            return {
              text: JSON.stringify({
                title: 'Too verbose draft',
                description: 'A script that runs too long for the budget.',
                tags: ['timing'],
                scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
                  text:
                    index === 2
                      ? `${Array.from(
                          { length: 24 },
                          (_, wordIndex) => `Scene ${index + 1} word ${wordIndex + 1}`
                        ).join(' ')} For example, compare one manual process with one streamlined workflow to show the payoff.`
                      : Array.from(
                          { length: 24 },
                          (_, wordIndex) => `Scene ${index + 1} word ${wordIndex + 1}`
                        ).join(' '),
                  visualQuery: `verbose scene ${index + 1}`,
                  durationSeconds: 4,
                })),
              }),
            };
          }

          return {
            text: JSON.stringify({
              title: 'Aligned timing draft',
              description: 'A script that fits the configured duration budget.',
              tags: ['timing'],
              scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
                text:
                  index === 2
                    ? 'For example, compare one manual process with one streamlined workflow to show the payoff.'
                    : `Scene ${index + 1} keeps the narration tight.`,
                visualQuery: `timing scene ${index + 1}`,
                durationSeconds: 4,
              })),
            }),
          };
        },
      },
    }),
  });

  const result = await provider.generate(profile, 'timing budget');

  assert.equal(requests.length, 2);
  assert.match(requests[1]?.contents ?? '', /duration budget/i);
  assert.equal(result.scriptMetadata.attemptCount, 2);
  assert.equal(result.scriptMetadata.repaired, true);
});

test('GeminiScriptProvider normalizes long and sentence-like tags before validation', async () => {
  const profile = createScriptTestProfile();
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 1,
    createClient: async () => ({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            title: 'Tag cleanup draft',
            description: 'A script with bad keyword metadata.',
            tags: [
              'Agentic AI in legal and medical discovery',
              'Deep Work; systems & focus',
              'https://bad.example',
              'FOCUS!',
            ],
            scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
              text:
                index === 2
                  ? 'For example, compare one manual habit with one automated habit to show the difference.'
                  : `Scene ${index + 1} keeps the narration tight.`,
              visualQuery: `tag cleanup scene ${index + 1}`,
              durationSeconds: 4,
            })),
            totalDurationSeconds: profile.maxDurationSeconds,
          }),
        }),
      },
    }),
  });

  const result = await provider.generate(profile, 'tag cleanup');

  assert.ok(result.scriptPackage.tags.length > 0);
  assert.ok(result.scriptPackage.tags.length <= 8);
  assert.ok(
    result.scriptPackage.tags.every((tag) => {
      assert.match(tag, /^[a-z0-9\s-]+$/);
      assert.ok(tag.split(' ').length <= 4);
      assert.ok(tag.length <= 40);
      return true;
    })
  );
  assert.equal(result.scriptPackage.tags.length > 0, true);
  assert.ok(!result.scriptPackage.tags.includes('shorts'));
});

test('GeminiScriptProvider rejects generic filler and weak scene direction', async () => {
  const profile = createScriptTestProfile();
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 1,
    createClient: async () => ({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            title: 'Generic filler draft',
            description: 'A script that sounds too generic.',
            tags: ['general'],
            scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
              text: `In today's world, this is important to know for scene ${index + 1}.`,
              visualQuery: `generic scene ${index + 1}`,
              durationSeconds: 4,
            })),
            totalDurationSeconds: profile.maxDurationSeconds,
          }),
        }),
      },
    }),
  });

  await assert.rejects(
    provider.generate(profile, 'generic filler'),
    /generic filler language|practical comparison or concrete example/i
  );
});

test('GeminiScriptProvider accepts concrete metric-driven scripts without literal example phrasing', async () => {
  const profile = createScriptTestProfile();
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 1,
    createClient: async () => ({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            title: 'Retirement tools that show the real tradeoffs',
            description: 'A practical retirement planning tools explainer.',
            tags: ['retirement', 'tools'],
            scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
              text:
                index === 2
                  ? 'Open the retirement dashboard, check the 401k match, expense ratio, and how a 1 percent fee changes the balance by age 65.'
                  : `Scene ${index + 1} keeps the workflow specific and practical.`,
              visualQuery: `retirement tools scene ${index + 1}`,
              durationSeconds: 4,
            })),
            totalDurationSeconds: profile.maxDurationSeconds,
          }),
        }),
      },
    }),
  });

  const result = await provider.generate(profile, 'Retirement planning tools');

  assert.equal(result.scriptMetadata.provider, 'gemini');
  assert.equal(result.scriptPackage.scenes.length, profile.sceneCount);
});

test('GeminiScriptProvider rejects internal fallback placeholder language', async () => {
  const profile = createScriptTestProfile();
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 1,
    createClient: async () => ({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            title: 'Broken fallback draft',
            description: 'A script contaminated by internal placeholders.',
            tags: ['fallback'],
            scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
              text:
                index === 2
                  ? 'For example, compare this story against a local fallback context and a manual workflow.'
                  : `Scene ${index + 1} mentions Entity Disambiguation and practical applications.`,
              visualQuery: `scene ${index + 1} local fallback context`,
              durationSeconds: 4,
            })),
          }),
        }),
      },
    }),
  });

  await assert.rejects(
    provider.generate(profile, 'placeholder test'),
    /internal fallback placeholder language/i
  );
});

test('LocalScriptProvider refuses weak factual topics without trusted evidence', async () => {
  const profile = {
    ...createDefaultProfile(),
    topicSource: 'category_pool' as const,
    contentCategories: createDefaultProfile().contentCategories.map((category) => ({
      ...category,
      enabled: category.id === 'history_people_and_power',
    })),
  };
  const provider = new LocalScriptProvider(undefined, new ContentOrchestrator(
    undefined,
    new FallbackSearchProvider(),
    new HeuristicRerankProvider()
  ));

  await assert.rejects(
    provider.generate(profile, 'The #MadlangaCommission'),
    /no trusted evidence|too weak to publish safely/i
  );
});

test('GeminiScriptProvider surfaces a clear failure after retry exhaustion', async () => {
  const profile = createScriptTestProfile();
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 2,
    createClient: async () => ({
      models: {
        generateContent: async () => ({
          text: 'not-json',
        }),
      },
    }),
  });

  await assert.rejects(
    provider.generate(profile, 'systems thinking'),
    /Gemini generation failed after 2 attempts/i
  );
});

test('GroqScriptProvider returns validated scripts through the same schema pipeline', async () => {
  const profile = createScriptTestProfile();
  const provider = new GroqScriptProvider('test-key', {
    maxAttempts: 1,
    createClient: async () => ({
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'SEO systems that scale',
                    description: 'A concrete SEO workflow breakdown.',
                    tags: ['seo', 'automation'],
                    scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
                      text:
                        index === 2
                          ? 'Open the keyword map, cluster the terms, and check which template pages still need real data before publishing.'
                          : `Scene ${index + 1} keeps the workflow specific and practical.`,
                      visualQuery: `seo systems scene ${index + 1}`,
                      durationSeconds: 4,
                    })),
                    totalDurationSeconds: profile.maxDurationSeconds,
                  }),
                },
              },
            ],
          }),
        },
      },
    }),
  });

  const result = await provider.generate(profile, 'SEO and programmatic SEO guides');

  assert.equal(result.scriptMetadata.provider, 'groq');
  assert.equal(result.scriptMetadata.mode, 'live');
});

test('FallbackScriptProvider falls back to the next provider after quota exhaustion', async () => {
  const profile = createScriptTestProfile();
  let groqCalls = 0;
  const provider = new FallbackScriptProvider([
    {
      label: 'gemini',
      provider: new GeminiScriptProvider('test-key', {
        maxAttempts: 1,
        createClient: async () => ({
          models: {
            generateContent: async () => {
              throw new Error(
                '429 RESOURCE_EXHAUSTED: quota exceeded for metric generate_content_free_tier_requests'
              );
            },
          },
        }),
      }),
    },
    {
      label: 'groq',
      provider: new GroqScriptProvider('test-key', {
        maxAttempts: 1,
        createClient: async () => ({
          chat: {
            completions: {
              create: async () => {
                groqCalls += 1;
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          title: 'AI workflow automation that saves real time',
                          description: 'A fallback script that still stays concrete.',
                          tags: ['automation', 'ai'],
                          scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
                            text:
                              index === 2
                                ? 'Open the workflow builder, route the lead, and check which approval step still needs a human before the CRM updates.'
                                : `Scene ${index + 1} keeps the workflow specific and practical.`,
                            visualQuery: `automation scene ${index + 1}`,
                            durationSeconds: 4,
                          })),
                          totalDurationSeconds: profile.maxDurationSeconds,
                        }),
                      },
                    },
                  ],
                };
              },
            },
          },
        }),
      }),
    },
    {
      label: 'local',
      provider: new LocalScriptProvider(),
    },
  ]);

  const result = await provider.generate(profile, 'AI workflow automation');

  assert.equal(groqCalls, 1);
  assert.equal(result.scriptMetadata.provider, 'groq');
  assert.equal(result.scriptMetadata.fallbackProvider, 'groq');
  assert.deepEqual(result.scriptMetadata.providerChain, ['gemini', 'groq']);
});

test('MistralScriptProvider can act as the last fallback writer', async () => {
  const profile = createScriptTestProfile();
  const provider = new MistralScriptProvider('test-key', {
    maxAttempts: 1,
    createClient: async () => ({
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Business ideas with a real workflow',
                    description: 'A practical business idea explainer.',
                    tags: ['business', 'ideas'],
                    scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
                      text:
                        index === 2
                          ? 'Compare a generic side hustle idea with one workflow that starts from a real customer pain point and a simple validation step.'
                          : `Scene ${index + 1} keeps the business idea concrete.`,
                      visualQuery: `business ideas scene ${index + 1}`,
                      durationSeconds: 4,
                    })),
                    totalDurationSeconds: profile.maxDurationSeconds,
                  }),
                },
              },
            ],
          }),
        },
      },
    }),
  });

  const result = await provider.generate(profile, 'Business idea validation');

  assert.equal(result.scriptMetadata.provider, 'mistral');
  assert.equal(result.scriptMetadata.mode, 'live');
});

test('GeminiScriptProvider records research metadata from the orchestrator brief', async () => {
  const profile = {
    ...createScriptTestProfile(),
    topicSource: 'daily_news' as const,
  };
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 1,
    newsProvider: {
      async discoverTopic() {
        return null;
      },
      async resolveContext() {
        return {
          title: 'Nvidia launches a new enterprise AI chip',
          sourceName: 'Reuters',
          sourceUrl: 'https://example.com/nvidia-chip',
          publishedAt: '2026-04-16T08:00:00.000Z',
          snippet: 'The company announced a new chip aimed at enterprise demand.',
          query: 'artificial intelligence',
        };
      },
    },
    contentOrchestrator: new ContentOrchestrator(
      {
        async discoverTopic() {
          return null;
        },
        async resolveContext() {
          return {
            title: 'Nvidia launches a new enterprise AI chip',
            sourceName: 'Reuters',
            sourceUrl: 'https://example.com/nvidia-chip',
            publishedAt: '2026-04-16T08:00:00.000Z',
            snippet: 'The company announced a new chip aimed at enterprise demand.',
            query: 'artificial intelligence',
          };
        },
      },
      new FallbackSearchProvider(),
      new HeuristicRerankProvider()
    ),
    createClient: async () => ({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            title: 'Nvidia launches a new enterprise AI chip',
            description: 'A simplified breakdown of the latest AI hardware update.',
            tags: ['ai', 'chip'],
            scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
              text:
                index === 2
                  ? 'Open the earnings context, compare the enterprise demand story with the last hardware cycle, and explain what actually changed.'
                  : `Scene ${index + 1} explains the update with one concrete detail.`,
              visualQuery: `nvidia ai chip scene ${index + 1}`,
              durationSeconds: 4,
            })),
            totalDurationSeconds: profile.maxDurationSeconds,
          }),
        }),
      },
    }),
  });

  const result = await provider.generate(profile, 'Nvidia launches a new enterprise AI chip');

  assert.equal(result.scriptMetadata.searchProvider, 'news');
  assert.equal(result.scriptMetadata.rerankProvider, 'heuristic');
  assert.equal(result.scriptMetadata.verificationStatus, 'degraded');
  assert.equal(result.scriptMetadata.evidenceSourceCount > 0, true);
});

test('GeminiScriptProvider times out stalled requests instead of hanging indefinitely', async () => {
  const profile = createScriptTestProfile();
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 1,
    requestTimeoutMs: 20,
    createClient: async () => ({
      models: {
        generateContent: async () =>
          await new Promise(() => {
            // Intentionally never resolves.
          }),
      },
    }),
  });

  await assert.rejects(
    provider.generate(profile, 'stalled request'),
    /Gemini generation failed after 1 attempts\. Gemini request timed out after 20ms\./i
  );
});

test('GeminiScriptProvider injects current news context and humanized narration rules for daily news profiles', async () => {
  const profile = {
    ...createDefaultProfile(),
    contentMode: 'narration' as const,
    topicSource: 'daily_news' as const,
  };
  const requests: Array<{ contents: string }> = [];
  const provider = new GeminiScriptProvider('test-key', {
    maxAttempts: 1,
    newsProvider: {
      async discoverTopic() {
        return null;
      },
      async resolveContext() {
        return {
          title: 'OpenAI launches a faster reasoning model',
          sourceName: 'Reuters',
          sourceUrl: 'https://example.com/openai-model',
          publishedAt: '2026-04-16T08:00:00.000Z',
          snippet: 'OpenAI launched a faster reasoning model and said it is aimed at developer workflows.',
          query: 'artificial intelligence',
        };
      },
    },
    createClient: async () => ({
      models: {
        generateContent: async (input) => {
          requests.push({ contents: input.contents });
          return {
            text: JSON.stringify({
              title: 'OpenAI launches a faster reasoning model',
              description: 'A simplified breakdown of the latest AI model launch.',
              tags: ['ai', 'news'],
              scenes: Array.from({ length: profile.sceneCount }, (_, index) => ({
                text: `Scene ${index + 1} explains the latest update with one concrete detail and a quick reaction.`,
                visualQuery: `ai news scene ${index + 1}`,
                durationSeconds: 4,
              })),
              dialogue: {
                speakers: [
                  { id: 'host_a', name: profile.dialogueHostAName, role: 'lead' },
                  { id: 'host_b', name: profile.dialogueHostBName, role: 'reactor' },
                ],
                turns: Array.from({ length: profile.sceneCount * 2 }, (_, index) => ({
                  speakerId: index % 2 === 0 ? 'host_a' : 'host_b',
                  sceneOrder: Math.min(profile.sceneCount, Math.floor(index / 2) + 1),
                  text:
                    index % 4 === 0
                      ? 'Mm, here is the actual update and why it matters.'
                      : index % 4 === 1
                        ? 'Right, but what changes for normal people using these tools?'
                        : index % 4 === 2
                          ? 'Look, the important part is the speed and who gets access first.'
                          : 'You know, that is the part most headlines skip over.',
                  shotType: index % 2 === 0 ? 'speaker_focus' : 'duo',
                  shotNote: 'Keep it conversational.',
                })),
              },
              totalDurationSeconds: profile.maxDurationSeconds,
            }),
          };
        },
      },
    }),
  });

  await provider.generate(profile, 'OpenAI launches a faster reasoning model');

  assert.equal(requests.length, 1);
  assert.match(
    requests[0]?.contents ?? '',
    /Current news headline: OpenAI launches a faster reasoning model/i
  );
  assert.match(requests[0]?.contents ?? '', /Humanize the narration/i);
  assert.match(requests[0]?.contents ?? '', /commentary, not facts/i);
});
