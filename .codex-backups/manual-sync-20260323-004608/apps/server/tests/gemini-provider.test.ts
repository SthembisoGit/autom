import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultProfile } from '../src/lib/default-profile.js';
import { GeminiScriptProvider } from '../src/providers/gemini-provider.js';

test('GeminiScriptProvider retries malformed responses and repairs them', async () => {
  const profile = createDefaultProfile();
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
                text: `Scene ${index + 1} about focus systems.`,
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
  assert.equal(result.scriptPackage.totalDurationSeconds, profile.maxDurationSeconds);
});

test('GeminiScriptProvider retries scripts that exceed the duration budget', async () => {
  const profile = createDefaultProfile();
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
                  text: Array.from(
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
                text: `Scene ${index + 1} keeps the narration tight.`,
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
  const profile = createDefaultProfile();
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
              text: `Scene ${index + 1} keeps the narration tight.`,
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
  assert.ok(result.scriptPackage.tags.includes('saas'));
  assert.ok(!result.scriptPackage.tags.includes('shorts'));
});

test('GeminiScriptProvider surfaces a clear failure after retry exhaustion', async () => {
  const profile = createDefaultProfile();
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

test('GeminiScriptProvider times out stalled requests instead of hanging indefinitely', async () => {
  const profile = createDefaultProfile();
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
