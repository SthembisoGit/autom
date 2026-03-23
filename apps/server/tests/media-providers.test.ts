import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { PexelsVisualProvider } from '../src/providers/pexels-provider.js';

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
    const provider = new DeepgramVoiceProvider('test-key');
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
      runCommand: async (command, args, cwd) => {
        calls.push({ command, args, cwd });

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
    const provider = new PexelsVisualProvider('test-key');
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
        join(runtimePaths.tempDirectory, 'job-visuals', 'visuals', 'scene-1.mp4'),
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
    const provider = new PexelsVisualProvider('test-key');
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
