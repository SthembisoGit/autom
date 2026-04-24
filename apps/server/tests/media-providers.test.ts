import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { RuntimePaths } from '@autom/config';
import type { ScriptPackage } from '@autom/contracts';

import { createDefaultProfile } from '../src/lib/default-profile.js';
import {
  buildDeepgramRequestTimeoutMs,
  DeepgramVoiceProvider,
} from '../src/providers/deepgram-provider.js';
import { GroqTranscriptionProvider } from '../src/providers/groq-provider.js';
import {
  buildVisualScenePlan,
  CompositeVisualProvider,
  GoogleNewsContextVisualProvider,
  PexelsVisualProvider,
  PixabayVisualProvider,
  WikimediaCommonsProvider,
} from '../src/providers/pexels-provider.js';

type CommandCall = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
};

function createRuntimePaths(root: string): RuntimePaths {
  return {
    mediaRoot: join(root, 'var'),
    dbDirectory: join(root, 'var', 'db'),
    tempDirectory: join(root, 'var', 'temp'),
    outputDirectory: join(root, 'var', 'output'),
    publishedDirectory: join(root, 'var', 'published'),
    logDirectory: join(root, 'var', 'log'),
    manualClipDirectory: join(root, 'var', 'manual-clips'),
  };
}

function createScriptPackage(): ScriptPackage {
  return {
    id: 'script_test',
    title: 'Test Script',
    description: 'Testing media providers.',
    tags: ['testing'],
    scenes: [
      {
        order: 1,
        text: 'Build discipline one habit at a time.',
        visualQuery: 'discipline city architecture',
        durationSeconds: 4,
      },
    ],
    totalDurationSeconds: 4,
  };
}

test('DeepgramVoiceProvider writes narration output into the runtime temp directory', async () => {
  const originalFetch = globalThis.fetch;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-media-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const profile = createDefaultProfile();
  const scriptPackage = createScriptPackage();

  globalThis.fetch = async () =>
    new Response(Buffer.from('mp3-audio'), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
      },
    });

  try {
    const provider = new DeepgramVoiceProvider('test-key', {
      runCommand: async (command) => {
        if (command !== 'ffprobe') {
          throw new Error(`Unexpected command ${command}`);
        }

        return {
          stdout: '3.5',
          stderr: '',
        };
      },
    });
    const result = await provider.synthesize(scriptPackage, profile, 'job-audio', runtimePaths);

    assert.equal(result.assetReferences.length, 1);
    assert.equal(result.assetReferences[0]?.provider, 'deepgram');
    assert.equal(result.assetReferences[0]?.kind, 'audio');
    assert.equal(result.sceneNarrationTimeline?.length ?? 0, 1);
    assert.equal(result.sceneNarrationTimeline?.[0]?.sceneOrder, 1);
    assert.equal(
      result.narrationPath,
      join(runtimePaths.tempDirectory, 'job-audio', 'voice', 'narration.mp3')
    );
    assert.equal(await readFile(result.narrationPath ?? '', 'utf8'), 'mp3-audio');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('DeepgramVoiceProvider scales request timeout with narration length', () => {
  const shortTimeout = buildDeepgramRequestTimeoutMs('Short narration text.');
  const longTimeout = buildDeepgramRequestTimeoutMs(
    Array.from({ length: 120 }, (_, index) => `Sentence ${index + 1} keeps the narration flowing.`).join(' ')
  );

  assert.ok(shortTimeout >= 60_000);
  assert.ok(longTimeout > shortTimeout);
});

test('DeepgramVoiceProvider reports timeout when response body reading aborts', async () => {
  const originalFetch = globalThis.fetch;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-media-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const profile = createDefaultProfile();
  const scriptPackage = createScriptPackage();
  const timeoutError = new Error('The operation was aborted due to timeout');
  timeoutError.name = 'TimeoutError';

  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Type': 'audio/mpeg',
      }),
      arrayBuffer: async () => {
        throw timeoutError;
      },
    }) as unknown as Response;

  try {
    const provider = new DeepgramVoiceProvider('test-key');
    await assert.rejects(
      provider.synthesize(scriptPackage, profile, 'job-timeout', runtimePaths),
      /Deepgram narration response timed out while reading chunk 1 of 1\./
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('DeepgramVoiceProvider chunks long narration text before synthesis', async () => {
  const originalFetch = globalThis.fetch;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-media-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const profile = createDefaultProfile();
  const longText = Array.from(
    { length: 120 },
    (_, index) => `Sentence ${index + 1} keeps the narration flowing.`
  ).join(' ');
  const scriptPackage: ScriptPackage = {
    id: 'script_long_audio',
    title: 'Long Audio Script',
    description: 'Testing narration chunking.',
    tags: ['testing'],
    scenes: [
      {
        order: 1,
        text: longText,
        visualQuery: 'discipline city architecture',
        durationSeconds: 12,
      },
    ],
    totalDurationSeconds: 12,
  };
  let requestCount = 0;

  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(Buffer.from(`chunk-${requestCount}`), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
      },
    });
  };

  try {
    const calls: CommandCall[] = [];
    const provider = new DeepgramVoiceProvider('test-key', {
      ffmpegPath: 'fake-ffmpeg',
      ffprobePath: 'fake-ffprobe',
      runCommand: async (command, args, cwd) => {
        calls.push({ command, args, cwd });

        if (command === 'fake-ffprobe') {
          return {
            stdout: '12',
            stderr: '',
          };
        }

        if (command !== 'fake-ffmpeg') {
          throw new Error(`Unexpected command ${command}`);
        }

        const isConcatRun = args.includes('-f') && args.includes('concat');
        if (isConcatRun) {
          const concatList = await readFile(join(cwd, 'concat.txt'), 'utf8');
          const chunkPaths = concatList
            .split('\n')
            .map((line) => {
              const match = line.match(/^file '(.+)'$/);
              return match?.[1] ?? null;
            })
            .filter((value): value is string => Boolean(value));
          const stitched = await Promise.all(
            chunkPaths.map(async (chunkPath) => await readFile(join(cwd, chunkPath), 'utf8'))
          );
          await writeFile(join(cwd, 'narration.mp3'), stitched.join(''), 'utf8');
          return { stdout: '', stderr: '' };
        }

        throw new Error(`Unexpected command ${command}`);
      },
    });
    const result = await provider.synthesize(scriptPackage, profile, 'job-chunked', runtimePaths);

    assert.ok(requestCount > 1);
    assert.ok(calls.some((call) => call.args.includes('concat')));
    assert.match(result.warnings.join('\n'), /split into/i);
    assert.ok(result.sceneNarrationTimeline && result.sceneNarrationTimeline.length === 1);
    assert.equal(
      await readFile(result.narrationPath ?? '', 'utf8'),
      Array.from({ length: requestCount }, (_, index) => `chunk-${index + 1}`).join('')
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('GroqTranscriptionProvider normalizes word timestamps from narration audio', async () => {
  const originalFetch = globalThis.fetch;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-media-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const profile = createDefaultProfile();
  const scriptPackage = createScriptPackage();
  const narrationPath = join(runtimePaths.tempDirectory, 'job-groq', 'voice', 'narration.mp3');
  await mkdir(join(runtimePaths.tempDirectory, 'job-groq', 'voice'), { recursive: true });
  await writeFile(narrationPath, 'audio-bytes', 'utf8');

  globalThis.fetch = async () =>
    Response.json({
      text: 'hello world',
      words: [
        { word: 'hello', start: 0, end: 0.4, confidence: 0.91 },
        { word: 'world', start: 0.46, end: 0.82, confidence: 0.88 },
      ],
    });

  try {
    const provider = new GroqTranscriptionProvider('test-key', 'whisper-large-v3-turbo', 5_000);
    const result = await provider.transcribe({
      scriptPackage,
      profile,
      jobId: 'job-groq',
      runtimePaths,
      narrationPath,
    });

    assert.equal(result.transcriptWords?.length, 2);
    assert.equal(result.transcriptWords?.[0]?.word, 'hello');
    assert.equal(result.transcriptWords?.[1]?.endSeconds, 0.82);
    assert.equal(result.assetReferences[0]?.provider, 'groq');
    assert.equal(result.warnings.length, 0);
    assert.match(
      await readFile(join(runtimePaths.tempDirectory, 'job-groq', 'transcript', 'groq-transcript.json'), 'utf8'),
      /hello/
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('PexelsVisualProvider retries with fallback queries and downloads portrait clips', async () => {
  const originalFetch = globalThis.fetch;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-media-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const profile = createDefaultProfile();
  const scriptPackage = createScriptPackage();
  const requests: string[] = [];

  globalThis.fetch = async (input) => {
    const url = input.toString();
    requests.push(url);

    if (url.startsWith('https://api.pexels.com/videos/search')) {
      if (requests.length === 1) {
        return Response.json({ videos: [] });
      }

      return Response.json({
        videos: [
          {
            id: 42,
            url: 'https://www.pexels.com/video/example',
            user: {
              name: 'Camera Operator',
            },
            video_files: [
              {
                id: 7,
                link: 'https://videos.pexels.com/example.mp4',
                file_type: 'video/mp4',
                width: 1080,
                height: 1920,
                quality: 'hd',
              },
            ],
          },
        ],
      });
    }

    return new Response(Buffer.from('video-bytes'), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
      },
    });
  };

  try {
    const provider = new CompositeVisualProvider({
      pexels: new PexelsVisualProvider('test-key'),
    });
    const result = await provider.select({
      scriptPackage,
      profile,
      jobId: 'job-visuals',
      runtimePaths,
    });

    assert.equal(result.assetReferences.length, 1);
    assert.equal(result.assetReferences[0]?.provider, 'pexels');
    assert.equal(result.assetReferences[0]?.sceneOrder, 1);
    assert.notEqual(result.selectedVisualQueries[0], scriptPackage.scenes[0]?.visualQuery);
    assert.equal(
      await readFile(
        join(runtimePaths.tempDirectory, 'job-visuals', 'visuals', 'scene-1-pexels.mp4'),
        'utf8'
      ),
      'video-bytes'
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('PexelsVisualProvider leaves no partial file behind when clip download fails', async () => {
  const originalFetch = globalThis.fetch;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-media-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const profile = createDefaultProfile();
  const scriptPackage = createScriptPackage();

  globalThis.fetch = async (input) => {
    const url = input.toString();

    if (url.startsWith('https://api.pexels.com/videos/search')) {
      return Response.json({
        videos: [
          {
            id: 42,
            url: 'https://www.pexels.com/video/example',
            video_files: [
              {
                id: 7,
                link: 'https://videos.pexels.com/example.mp4',
                file_type: 'video/mp4',
                width: 1080,
                height: 1920,
                quality: 'hd',
              },
            ],
          },
        ],
      });
    }

    return new Response('download failed', { status: 503 });
  };

  try {
    const provider = new CompositeVisualProvider({
      pexels: new PexelsVisualProvider('test-key'),
    });
    const result = await provider.select({
      scriptPackage,
      profile,
      jobId: 'job-visual-failure',
      runtimePaths,
    });

    assert.equal(result.assetReferences.length, 0);
    assert.equal(
      result.warnings.some((warning) => /download failed/i.test(warning)),
      true
    );
    await assert.rejects(
      access(join(runtimePaths.tempDirectory, 'job-visual-failure', 'visuals', 'scene-1.mp4'))
    );
    await assert.rejects(
      access(join(runtimePaths.tempDirectory, 'job-visual-failure', 'visuals', 'scene-1.mp4.part'))
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('buildVisualScenePlan routes named historical figures to factual providers first', () => {
  const profile = createDefaultProfile();
  const scene = {
    order: 1,
    text: 'Nelson Mandela changed the political future of South Africa.',
    visualQuery: 'Nelson Mandela history',
    durationSeconds: 4,
    visualMode: 'auto' as const,
  };

  const result = buildVisualScenePlan(scene, profile, {
    topic: 'Nelson Mandela history',
    contentType: 'historical_topic',
    angle: 'Explain Mandela through real historical visuals.',
    factualClaims: ['Mandela served as President of South Africa.'],
    allowedSources: ['wikimedia.org'],
    keyEntities: ['Nelson Mandela'],
    desiredVisuals: ['Nelson Mandela'],
    toneGuidance: ['Keep it factual.'],
    evidence: { items: [], degraded: true },
    verificationStatus: 'degraded',
    exactEvidenceRequired: true,
    searchProvider: 'news',
    rerankProvider: 'heuristic',
    warnings: [],
  });

  assert.equal(result.plan.sceneKind, 'historical_topic');
  assert.equal(result.plan.preferredProviders[0], 'wikimedia');
  assert.equal(result.plan.exactMatchRequired, true);
});

test('buildVisualScenePlan routes generic business tips to stock providers first', () => {
  const profile = createDefaultProfile();
  const scene = {
    order: 1,
    text: 'A useful business tip is to validate customer demand before you build.',
    visualQuery: 'business idea validation',
    durationSeconds: 4,
    visualMode: 'auto' as const,
  };

  const result = buildVisualScenePlan(scene, profile, null);

  assert.equal(result.plan.sceneKind, 'generic_business_or_lifestyle');
  assert.equal(result.plan.preferredProviders[0], 'pexels');
  assert.equal(result.plan.allowStockFallback, true);
});

test('CompositeVisualProvider prefers factual providers before stock for entity scenes', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-composite-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const profile = createDefaultProfile();
  const scriptPackage: ScriptPackage = {
    id: 'script_entity',
    title: 'Nelson Mandela history',
    description: 'Testing factual provider preference.',
    tags: ['history'],
    scenes: [
      {
        order: 1,
        text: 'Nelson Mandela changed the political future of South Africa.',
        visualQuery: 'Nelson Mandela history',
        durationSeconds: 4,
        visualMode: 'auto',
      },
    ],
    totalDurationSeconds: 4,
  };

  const provider = new CompositeVisualProvider({
    contentBriefResolver: async () => ({
      topic: 'Nelson Mandela history',
      contentType: 'historical_topic',
      angle: 'Use real historical visuals.',
      factualClaims: ['Mandela served as President of South Africa.'],
      allowedSources: ['wikimedia.org'],
      keyEntities: ['Nelson Mandela'],
      desiredVisuals: ['Nelson Mandela'],
      toneGuidance: ['Keep it factual.'],
      evidence: { items: [], degraded: true },
      verificationStatus: 'degraded',
      exactEvidenceRequired: true,
      searchProvider: 'news',
      rerankProvider: 'heuristic',
      warnings: [],
    }),
    wikimedia: {
      family: 'wikimedia',
      async collectCandidates({ scene, plan }) {
        return {
          provider: 'wikimedia',
          warnings: [],
          data: [
            {
              asset: {
                kind: 'metadata',
                path: join(runtimePaths.tempDirectory, 'wikimedia.jpg'),
                label: 'Wikimedia Mandela asset',
                provider: 'wikimedia',
                sourceUrl: 'https://commons.wikimedia.org/wiki/File:Mandela.jpg',
                mimeType: 'image/jpeg',
                externalId: '42',
                sceneOrder: scene.order,
                query: plan.queries[0] ?? null,
                retrievalOrigin: 'entity',
                licenseLabel: 'CC BY-SA',
                rightsSummary: 'Historical portrait.',
                attributionRequired: true,
                entityLabel: 'Nelson Mandela',
              },
              score: 20,
              providerFamily: 'wikimedia',
              exactEntityMatch: true,
              matchedTerms: ['mandela'],
            },
          ],
        };
      },
    },
    pexels: {
      family: 'pexels',
      async collectCandidates({ scene, plan }) {
        return {
          provider: 'pexels',
          warnings: [],
          data: [
            {
              asset: {
                kind: 'video',
                path: join(runtimePaths.tempDirectory, 'stock.mp4'),
                label: 'Generic stock footage',
                provider: 'pexels',
                sourceUrl: 'https://www.pexels.com/video/example',
                mimeType: 'video/mp4',
                externalId: '7',
                sceneOrder: scene.order,
                query: plan.queries[0] ?? null,
                retrievalOrigin: 'stock',
                licenseLabel: 'Pexels License',
                rightsSummary: 'Generic stock clip.',
                attributionRequired: false,
                entityLabel: null,
              },
              score: 8,
              providerFamily: 'pexels',
              exactEntityMatch: false,
              matchedTerms: [],
            },
          ],
        };
      },
    },
  });

  try {
    const result = await provider.select({
      scriptPackage,
      profile,
      jobId: 'job-entity',
      runtimePaths,
    });

    assert.equal(result.assetReferences.length, 1);
    assert.equal(result.assetReferences[0]?.provider, 'wikimedia');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('CompositeVisualProvider refuses generic stock when a factual scene lacks an exact match', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-composite-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const profile = createDefaultProfile();
  const scriptPackage: ScriptPackage = {
    id: 'script_entity_miss',
    title: 'Nelson Mandela history',
    description: 'Testing factual provider failure.',
    tags: ['history'],
    scenes: [
      {
        order: 1,
        text: 'Nelson Mandela changed the political future of South Africa.',
        visualQuery: 'Nelson Mandela history',
        durationSeconds: 4,
        visualMode: 'auto',
      },
    ],
    totalDurationSeconds: 4,
  };

  const provider = new CompositeVisualProvider({
    contentBriefResolver: async () => ({
      topic: 'Nelson Mandela history',
      contentType: 'historical_topic',
      angle: 'Use real historical visuals.',
      factualClaims: ['Mandela served as President of South Africa.'],
      allowedSources: ['wikimedia.org'],
      keyEntities: ['Nelson Mandela'],
      desiredVisuals: ['Nelson Mandela'],
      toneGuidance: ['Keep it factual.'],
      evidence: { items: [], degraded: true },
      verificationStatus: 'degraded',
      exactEvidenceRequired: true,
      searchProvider: 'news',
      rerankProvider: 'heuristic',
      warnings: [],
    }),
    pexels: {
      family: 'pexels',
      async collectCandidates({ scene, plan }) {
        return {
          provider: 'pexels',
          warnings: [],
          data: [
            {
              asset: {
                kind: 'video',
                path: join(runtimePaths.tempDirectory, 'generic.mp4'),
                label: 'Generic stock footage',
                provider: 'pexels',
                sourceUrl: 'https://www.pexels.com/video/example',
                mimeType: 'video/mp4',
                externalId: '11',
                sceneOrder: scene.order,
                query: plan.queries[0] ?? null,
                retrievalOrigin: 'stock',
                licenseLabel: 'Pexels License',
                rightsSummary: 'Generic stock clip.',
                attributionRequired: false,
                entityLabel: null,
              },
              score: 9,
              providerFamily: 'pexels',
              exactEntityMatch: false,
              matchedTerms: ['mandela'],
            },
          ],
        };
      },
    },
  });

  try {
    const result = await provider.select({
      scriptPackage,
      profile,
      jobId: 'job-entity-miss',
      runtimePaths,
    });

    assert.equal(result.assetReferences.length, 0);
    assert.match(result.warnings.join('\n'), /could not find an exact factual visual match/i);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
