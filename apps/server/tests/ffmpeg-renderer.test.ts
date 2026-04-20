import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AppEnv, RuntimePaths } from '@autom/config';
import type { ContentProfile, GenerationJob, ScriptPackage } from '@autom/contracts';

import { createDefaultProfile } from '../src/lib/default-profile.js';
import { FfmpegRenderer } from '../src/media/ffmpeg-renderer.js';

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

function createEnv(): AppEnv {
  return {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:4010',
    APP_PORT: 4010,
    SESSION_SECRET: 'test-secret',
    DATABASE_URL: 'var/db/autom.sqlite',
    MEDIA_ROOT: 'var',
    FFMPEG_PATH: 'fake-ffmpeg',
    FFPROBE_PATH: 'fake-ffprobe',
    FFMPEG_COMMAND_TIMEOUT_SECONDS: 600,
    GEMINI_API_KEY: undefined,
    GEMINI_SCRIPT_MODEL: 'gemini-2.5-flash',
    GROQ_API_KEY: undefined,
    GROQ_SCRIPT_MODEL: 'llama-3.3-70b-versatile',
    GROQ_SCRIPT_TIMEOUT_SECONDS: 45,
    GROQ_TRANSCRIPTION_MODEL: 'whisper-large-v3-turbo',
    GROQ_TRANSCRIPTION_TIMEOUT_SECONDS: 120,
    DEEPGRAM_API_KEY: undefined,
    PEXELS_API_KEY: undefined,
    YOUTUBE_CLIENT_ID: undefined,
    YOUTUBE_CLIENT_SECRET: undefined,
    YOUTUBE_REDIRECT_URI: undefined,
    TIKTOK_CLIENT_KEY: undefined,
    TIKTOK_CLIENT_SECRET: undefined,
    TIKTOK_REDIRECT_URI: undefined,
    META_APP_ID: undefined,
    META_APP_SECRET: undefined,
    META_REDIRECT_URI: undefined,
    META_PAGE_ID: undefined,
  };
}

function createJob(): GenerationJob {
  return {
    id: 'job_render',
    profileId: 'profile_default',
    topic: 'render systems',
    status: 'drafting',
    scriptPackage: null,
    scriptMetadata: null,
    manualClipBundle: null,
    reviewPackage: null,
    publicationResults: [],
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createScriptPackage(): ScriptPackage {
  return {
    id: 'script_render',
    title: 'Render Script',
    description: 'Render pipeline test.',
    tags: ['render'],
    scenes: [
      {
        order: 1,
        text: 'Discipline starts with a deliberate first step.',
        visualQuery: 'discipline portrait vertical',
        durationSeconds: 4,
      },
      {
        order: 2,
        text: 'The second scene uses a fallback background.',
        visualQuery: 'city architecture vertical',
        durationSeconds: 4,
      },
    ],
    totalDurationSeconds: 8,
  };
}

test('FfmpegRenderer composes footage, narration, subtitles, and thumbnail outputs', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-render-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const profile = createDefaultProfile();
  const job = createJob();
  const scriptPackage = createScriptPackage();
  const sourceVideoPath = join(workspaceRoot, 'source-scene.mp4');
  const narrationPath = join(workspaceRoot, 'narration.mp3');
  await writeFile(sourceVideoPath, 'video-source', 'utf8');
  await writeFile(narrationPath, 'narration-source', 'utf8');

  const calls: CommandCall[] = [];
  const progressMessages: string[] = [];
  const renderer = new FfmpegRenderer(async (command, args, cwd) => {
    calls.push({ command, args, cwd });

    if (command === 'fake-ffmpeg') {
      const outputName = args.at(-1);
      if (typeof outputName === 'string' && /\.(mp4|jpg)$/i.test(outputName)) {
        await writeFile(join(cwd, outputName), `${outputName}-artifact`, 'utf8');
      }

      return { stdout: '', stderr: '' };
    }

    if (command === 'fake-ffprobe') {
      return { stdout: '8.0\n', stderr: '' };
    }

    throw new Error(`Unexpected command ${command}`);
  });

  try {
    const reviewPackage = await renderer.render({
      env: createEnv(),
      profile,
      job,
      scriptPackage,
      selectedVisualQueries: scriptPackage.scenes.map((scene) => scene.visualQuery),
      assetReferences: [
        {
          kind: 'video',
          path: sourceVideoPath,
          label: 'Scene one clip',
          provider: 'pexels',
          sourceUrl: 'https://www.pexels.com/video/example',
          mimeType: 'video/mp4',
          externalId: 'pexels-1',
          sceneOrder: 1,
          query: scriptPackage.scenes[0]?.visualQuery ?? null,
        },
        {
          kind: 'audio',
          path: narrationPath,
          label: 'Narration',
          provider: 'deepgram',
          sourceUrl: 'https://api.deepgram.com/v1/speak',
          mimeType: 'audio/mpeg',
          externalId: null,
          sceneOrder: null,
          query: null,
        },
      ],
      warnings: [],
      narrationPath,
      runtimePaths,
      onProgress: (message) => {
        progressMessages.push(message);
      },
    });

    assert.equal(reviewPackage.renderBundle.thumbnailPath !== null, true);
    assert.equal(reviewPackage.renderBundle.renderedDurationSeconds, 8);
    assert.equal(reviewPackage.renderBundle.narrationDurationSeconds, 8);
    assert.equal(reviewPackage.renderBundle.subtitleCueCount >= 1, true);
    assert.equal(reviewPackage.renderBundle.subtitleTimingSource, 'scene_duration');
    assert.match(reviewPackage.summary, /1 sourced clip/i);
    assert.match(reviewPackage.summary, /mixed narration/i);
    assert.equal(
      reviewPackage.assetBundle.assetReferences.some(
        (reference) => reference.kind === 'subtitle' && reference.provider === 'system'
      ),
      true
    );

    const footageCall = calls.find(
      (call) => call.command === 'fake-ffmpeg' && call.args.includes(sourceVideoPath)
    );
    assert.equal(Boolean(footageCall), true);

    const fallbackCall = calls.find(
      (call) =>
        call.command === 'fake-ffmpeg' &&
        call.args.includes('lavfi') &&
        call.args.some((value) => value.includes('color=c=0x0f172a'))
    );
    assert.equal(Boolean(fallbackCall), true);

    const previewCall = calls.find(
      (call) =>
        call.command === 'fake-ffmpeg' &&
        call.args.includes('preview.mp4') &&
        call.args.includes(narrationPath)
    );
    assert.equal(Boolean(previewCall), true);

    const thumbnailCall = calls.find(
      (call) => call.command === 'fake-ffmpeg' && call.args.includes('thumbnail.jpg')
    );
    assert.equal(Boolean(thumbnailCall), true);

    const ffprobeCall = calls.find((call) => call.command === 'fake-ffprobe');
    assert.equal(Boolean(ffprobeCall), true);
    assert.equal(progressMessages.includes('Rendering scene 1 of 2.'), true);
    assert.equal(progressMessages.includes('Rendering scene 2 of 2.'), true);
    assert.equal(progressMessages.includes('Subtitle timing source used: scene_duration.'), true);
    assert.equal(progressMessages.includes('Concatenating rendered scenes.'), true);
    assert.equal(progressMessages.includes('Encoding final preview video.'), true);
    assert.equal(progressMessages.includes('Extracting review thumbnail.'), true);
    assert.equal(progressMessages.includes('Validating rendered preview.'), true);
    assert.equal(
      progressMessages.some((message) => message.startsWith('Render telemetry: scene 1 completed')),
      true
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('FfmpegRenderer uses narration timeline to split subtitles into readable cues', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-render-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const renderer = new FfmpegRenderer(async (command, args, cwd) => {
    if (command === 'fake-ffmpeg') {
      const outputName = args.at(-1);
      if (typeof outputName === 'string' && /\.(mp4|jpg)$/i.test(outputName)) {
        await writeFile(join(cwd, outputName), `${outputName}-artifact`, 'utf8');
      }

      return { stdout: '', stderr: '' };
    }

    if (command === 'fake-ffprobe') {
      return { stdout: '12.0\n', stderr: '' };
    }

    throw new Error(`Unexpected command ${command}`);
  });

  try {
    const reviewPackage = await renderer.render({
      env: createEnv(),
      profile: createDefaultProfile(),
      job: createJob(),
      scriptPackage: {
        ...createScriptPackage(),
        scenes: [
          {
            order: 1,
            text:
              'This subtitle test uses a much longer sentence so the renderer must break it into smaller, readable cues instead of one oversized paragraph on screen.',
            visualQuery: 'subtitle wrapping test',
            durationSeconds: 12,
          },
        ],
        totalDurationSeconds: 12,
      },
      selectedVisualQueries: ['subtitle wrapping test'],
      assetReferences: [],
      warnings: [],
      narrationPath: null,
      sceneNarrationTimeline: [
        {
          sceneOrder: 1,
          startSeconds: 0,
          endSeconds: 12,
        },
      ],
      runtimePaths,
    });

    const captions = await readFile(reviewPackage.renderBundle.subtitlesPath, 'utf8');
    const contentLines = captions
      .split('\n')
      .filter((line) => line && !/^\d+$/.test(line) && !line.includes('-->'));

    assert.equal(reviewPackage.renderBundle.subtitleCueCount > 1, true);
    assert.equal(reviewPackage.renderBundle.renderedDurationSeconds, 12);
    assert.equal(reviewPackage.renderBundle.narrationDurationSeconds, null);
    assert.equal(reviewPackage.renderBundle.subtitleTimingSource, 'voice_timeline');
    assert.equal(contentLines.every((line) => line.length <= 32), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('FfmpegRenderer rejects narration that exceeds the duration budget', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-render-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const narrationPath = join(workspaceRoot, 'narration.mp3');
  await writeFile(narrationPath, 'narration-source', 'utf8');
  const renderer = new FfmpegRenderer(async (command, args, cwd) => {
    if (command === 'fake-ffprobe' && args.includes(narrationPath)) {
      return { stdout: '40.0\n', stderr: '' };
    }

    if (command === 'fake-ffprobe') {
      return { stdout: '40.0\n', stderr: '' };
    }

    if (command === 'fake-ffmpeg') {
      const outputName = args.at(-1);
      if (typeof outputName === 'string' && /\.(mp4|jpg)$/i.test(outputName)) {
        await writeFile(join(cwd, outputName), `${outputName}-artifact`, 'utf8');
      }

      return { stdout: '', stderr: '' };
    }

    throw new Error(`Unexpected command ${command}`);
  });

  try {
    await assert.rejects(
      renderer.render({
        env: createEnv(),
        profile: createDefaultProfile(),
        job: createJob(),
        scriptPackage: {
          ...createScriptPackage(),
          scenes: [
            {
              order: 1,
              text: 'A script that is far too verbose for the configured runtime budget.',
              visualQuery: 'duration budget',
              durationSeconds: 30,
            },
          ],
          totalDurationSeconds: 30,
        },
        selectedVisualQueries: ['duration budget'],
        assetReferences: [],
        warnings: [],
        narrationPath,
        runtimePaths,
      }),
      /duration budget/i
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('FfmpegRenderer extends timeouts for longer configured durations', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-render-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const job = createJob();
  const profile = createDefaultProfile();
  const scriptPackage: ScriptPackage = {
    ...createScriptPackage(),
    scenes: Array.from({ length: 6 }, (_, index) => ({
      order: index + 1,
      text: `Scene ${index + 1} about scaled runtime.`,
      visualQuery: `runtime scene ${index + 1}`,
      durationSeconds: 30,
    })),
    totalDurationSeconds: 180,
  };
  const calls: CommandCall[] = [];
  const renderer = new FfmpegRenderer(async (command, args, cwd, timeoutMs) => {
    calls.push({ command, args, cwd, timeoutMs });

    if (command === 'fake-ffmpeg') {
      const outputName = args.at(-1);
      if (typeof outputName === 'string' && /\.(mp4|jpg)$/i.test(outputName)) {
        await writeFile(join(cwd, outputName), `${outputName}-artifact`, 'utf8');
      }

      return { stdout: '', stderr: '' };
    }

    if (command === 'fake-ffprobe') {
      return { stdout: '180.0\n', stderr: '' };
    }

    throw new Error(`Unexpected command ${command}`);
  });

  try {
    await renderer.render({
      env: {
        ...createEnv(),
        FFMPEG_COMMAND_TIMEOUT_SECONDS: 60,
      },
      profile,
      job,
      scriptPackage,
      selectedVisualQueries: scriptPackage.scenes.map((scene) => scene.visualQuery),
      assetReferences: [],
      warnings: [],
      narrationPath: null,
      runtimePaths,
    });

    const previewCall = calls.find(
      (call) => call.command === 'fake-ffmpeg' && call.args.includes('preview.mp4')
    );
    assert.equal(previewCall?.timeoutMs, 1_350_000);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('FfmpegRenderer rejects previews that fail validation', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-render-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const renderer = new FfmpegRenderer(async (command, args, cwd) => {
    if (command === 'fake-ffmpeg') {
      const outputName = args.at(-1);
      if (typeof outputName === 'string' && /\.(mp4|jpg)$/i.test(outputName)) {
        await writeFile(join(cwd, outputName), `${outputName}-artifact`, 'utf8');
      }

      return { stdout: '', stderr: '' };
    }

    return { stdout: '0\n', stderr: '' };
  });

  try {
    await assert.rejects(
      renderer.render({
        env: createEnv(),
        profile: createDefaultProfile(),
        job: createJob(),
        scriptPackage: createScriptPackage(),
        selectedVisualQueries: ['discipline portrait vertical'],
        assetReferences: [],
        warnings: [],
        narrationPath: null,
        runtimePaths,
      }),
      /validation failed/i
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('FfmpegRenderer surfaces which render step timed out', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-render-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const renderer = new FfmpegRenderer(async (command, _args, _cwd) => {
    if (command === 'fake-ffmpeg') {
        throw new Error('fake-ffmpeg timed out after 600000ms.');
    }

    return { stdout: '8.0\n', stderr: '' };
  });

  try {
    await assert.rejects(
      renderer.render({
        env: createEnv(),
        profile: createDefaultProfile(),
        job: createJob(),
        scriptPackage: createScriptPackage(),
        selectedVisualQueries: ['discipline portrait vertical'],
        assetReferences: [],
        warnings: [],
        narrationPath: null,
        runtimePaths,
      }),
      /Scene 1 render failed: fake-ffmpeg timed out after 600000ms\./i
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('FfmpegRenderer renders dialogue scenes with character assets and Groq-timed subtitles', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-render-'));
  const runtimePaths = createRuntimePaths(workspaceRoot);
  const job = createJob();
  const profile: ContentProfile = {
    ...createDefaultProfile(),
    contentMode: 'dialogue',
    dialogueCharacterPresetId: 'studio_duo_v2',
    dialogueHostAName: 'Maya',
    dialogueHostBName: 'Theo',
    dialogueVoiceA: 'aura-2-thalia-en',
    dialogueVoiceB: 'aura-2-orion-en',
  };
  const scriptPackage: ScriptPackage = {
    ...createScriptPackage(),
    scenes: [
      {
        order: 1,
        text: 'Maya and Theo explain the new workflow.',
        visualQuery: 'dashboard walkthrough',
        durationSeconds: 6,
      },
    ],
    totalDurationSeconds: 6,
    dialogue: {
      speakers: [
        { id: 'host_a', name: 'Maya', role: 'lead' },
        { id: 'host_b', name: 'Theo', role: 'analyst' },
      ],
      turns: [
        {
          order: 1,
          speakerId: 'host_a',
          sceneOrder: 1,
          text: 'Let us start with the workflow problem.',
          shotType: 'speaker_focus',
          shotNote: 'Open on Maya.',
          visualQuery: null,
        },
        {
          order: 2,
          speakerId: 'host_b',
          sceneOrder: 1,
          text: 'Then show the software step that fixes it.',
          shotType: 'duo',
          shotNote: 'Theo replies with the practical fix.',
          visualQuery: null,
        },
      ],
    },
  };
  const calls: CommandCall[] = [];
  const progressMessages: string[] = [];
  const renderer = new FfmpegRenderer(async (command, args, cwd) => {
    calls.push({ command, args, cwd });

    if (command === 'fake-ffmpeg') {
      const outputName = args.at(-1);
      if (typeof outputName === 'string' && /\.(mp4|jpg)$/i.test(outputName)) {
        await writeFile(join(cwd, outputName), `${outputName}-artifact`, 'utf8');
      }

      return { stdout: '', stderr: '' };
    }

    if (command === 'fake-ffprobe') {
      return { stdout: '6.0\n', stderr: '' };
    }

    throw new Error(`Unexpected command ${command}`);
  });

  try {
    const reviewPackage = await renderer.render({
      env: createEnv(),
      profile,
      job,
      scriptPackage,
      selectedVisualQueries: ['dashboard walkthrough'],
      assetReferences: [],
      warnings: [],
      narrationPath: null,
      sceneNarrationTimeline: [
        {
          sceneOrder: 1,
          startSeconds: 0,
          endSeconds: 6,
        },
      ],
      dialogueTurnTimeline: [
        {
          turnOrder: 1,
          sceneOrder: 1,
          speakerId: 'host_a',
          startSeconds: 0,
          endSeconds: 2.8,
          text: 'Let us start with the workflow problem.',
          shotType: 'speaker_focus',
        },
        {
          turnOrder: 2,
          sceneOrder: 1,
          speakerId: 'host_b',
          startSeconds: 2.8,
          endSeconds: 6,
          text: 'Then show the software step that fixes it.',
          shotType: 'duo',
        },
      ],
      transcriptWords: [
        { word: 'Let', startSeconds: 0, endSeconds: 0.2, confidence: 0.9 },
        { word: 'us', startSeconds: 0.2, endSeconds: 0.32, confidence: 0.9 },
        { word: 'start', startSeconds: 0.32, endSeconds: 0.6, confidence: 0.9 },
        { word: 'Then', startSeconds: 2.8, endSeconds: 3.1, confidence: 0.9 },
        { word: 'show', startSeconds: 3.1, endSeconds: 3.4, confidence: 0.9 },
      ],
      contentMode: 'dialogue',
      runtimePaths,
      onProgress: (message) => {
        progressMessages.push(message);
      },
    });

    assert.equal(reviewPackage.renderBundle.contentMode, 'dialogue');
    assert.equal(reviewPackage.renderBundle.subtitleTimingSource, 'groq_word_timestamps');
    assert.deepEqual(reviewPackage.renderBundle.dialogueSpeakerNames, ['Maya', 'Theo']);
    assert.equal(reviewPackage.renderBundle.dialogueTurnCount, 2);

    const dialogueSceneCall = calls.find(
      (call) =>
        call.command === 'fake-ffmpeg' &&
        call.args.includes('scene-1.mp4') &&
        call.args.some((value) => /host-a[\\/].*base\.png$/i.test(value))
    );
    assert.equal(Boolean(dialogueSceneCall), true);
    assert.equal(progressMessages.includes('Subtitle timing source used: groq_word_timestamps.'), true);
    assert.equal(progressMessages.includes('Dialogue character preset used: studio_duo_v2.'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
