import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { bootstrap } from '../src/lib/bootstrap.js';
import { StubRenderer } from '../src/media/ffmpeg-renderer.js';

function buildTestEnv(
  workspaceRoot: string,
  overrides?: Record<string, string>
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    MEDIA_ROOT: join(workspaceRoot, 'var'),
    DATABASE_URL: join(workspaceRoot, 'var', 'db', 'autom.sqlite'),
    SESSION_SECRET: 'test-session-secret',
    APP_URL: 'http://localhost:4010',
    OPS_URL: 'http://localhost:4173',
    GEMINI_API_KEY: '',
    DEEPGRAM_API_KEY: '',
    PEXELS_API_KEY: '',
    ENABLED_PUBLISHER_PLATFORMS: 'local,youtube',
    SCHEDULER_ENABLED: 'false',
    SCHEDULER_POLL_INTERVAL_SECONDS: '30',
    SCHEDULER_MAX_RETRIES: '2',
    SCHEDULER_RETRY_BASE_SECONDS: '60',
    YOUTUBE_CLIENT_ID: '',
    YOUTUBE_CLIENT_SECRET: '',
    YOUTUBE_REDIRECT_URI: '',
    TIKTOK_CLIENT_KEY: '',
    TIKTOK_CLIENT_SECRET: '',
    TIKTOK_REDIRECT_URI: '',
    META_APP_ID: '',
    META_APP_SECRET: '',
    META_REDIRECT_URI: '',
    META_PAGE_ID: '',
    ...overrides,
  };
}

test('scheduler routes expose overview and manual tick execution', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-scheduler-'));
  const env = buildTestEnv(workspaceRoot);

  const app = await createApp({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profile = profilesResponse.json()[0] as Record<string, unknown>;

    const updateProfileResponse = await app.inject({
      method: 'PUT',
      url: `/profiles/${profile.id}`,
      payload: {
        name: profile.name,
        niche: profile.niche,
        tone: profile.tone,
        visualStyle: profile.visualStyle,
        promptDirectives: profile.promptDirectives,
        preferredTopics: profile.preferredTopics,
        bannedTopics: profile.bannedTopics,
        bannedTerms: profile.bannedTerms,
        sceneCount: profile.sceneCount,
        maxDurationSeconds: profile.maxDurationSeconds,
        defaultHashtags: profile.defaultHashtags,
        callToActionStyle: profile.callToActionStyle,
        callToActionTemplate: profile.callToActionTemplate,
        callToActionGuardrails: profile.callToActionGuardrails,
        affiliateLinkTemplate: profile.affiliateLinkTemplate,
        requireAffiliateDisclosure: profile.requireAffiliateDisclosure,
        affiliateDisclosureTemplate: profile.affiliateDisclosureTemplate,
        enabled: true,
        scheduleCron: '* * * * *',
        targetPlatforms: profile.targetPlatforms,
        defaultVoice: profile.defaultVoice,
      },
    });
    assert.equal(updateProfileResponse.statusCode, 200);

    const runResponse = await app.inject({
      method: 'POST',
      url: '/scheduler/run',
      payload: {},
    });
    assert.equal(runResponse.statusCode, 200);
    assert.equal(runResponse.json().recentRuns[0].status, 'completed');

    const schedulerResponse = await app.inject({
      method: 'GET',
      url: '/scheduler',
    });
    assert.equal(schedulerResponse.statusCode, 200);
    assert.equal(schedulerResponse.json().completedRuns24h >= 1, true);

    const reviewsResponse = await app.inject({
      method: 'GET',
      url: '/reviews',
    });
    assert.equal(reviewsResponse.statusCode, 200);
    assert.equal(reviewsResponse.json().length >= 1, true);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('scheduler schedules retries and eventually marks a run as failed', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-scheduler-'));
  const env = buildTestEnv(workspaceRoot);

  const context = await bootstrap({
    env,
    mediaRenderer: {
      async render() {
        throw new Error('Transient renderer outage.');
      },
    },
  });

  try {
    const profile = context.profilesService.get('profile_default');
    assert.ok(profile);

    context.profilesService.upsert('profile_default', {
      name: profile.name,
      niche: profile.niche,
      tone: profile.tone,
      visualStyle: profile.visualStyle,
      promptDirectives: profile.promptDirectives,
      preferredTopics: profile.preferredTopics,
      bannedTopics: profile.bannedTopics,
      bannedTerms: profile.bannedTerms,
      sceneCount: profile.sceneCount,
      maxDurationSeconds: profile.maxDurationSeconds,
      defaultHashtags: profile.defaultHashtags,
      callToActionStyle: profile.callToActionStyle,
      callToActionTemplate: profile.callToActionTemplate,
      callToActionGuardrails: profile.callToActionGuardrails,
      affiliateLinkTemplate: profile.affiliateLinkTemplate,
      requireAffiliateDisclosure: profile.requireAffiliateDisclosure,
      affiliateDisclosureTemplate: profile.affiliateDisclosureTemplate,
      enabled: true,
      scheduleCron: '0 0 1 1 *',
      targetPlatforms: profile.targetPlatforms,
      defaultVoice: profile.defaultVoice,
    });

    const firstOverview = await context.schedulerService.runDueWork(
      new Date('2026-01-01T00:01:00.000Z')
    );
    assert.equal(firstOverview.recentRuns[0]?.status, 'retry_scheduled');
    assert.equal(firstOverview.recentRuns[0]?.nextRetryAt, '2026-01-01T00:02:00.000Z');

    const secondOverview = await context.schedulerService.runDueWork(
      new Date('2026-01-01T00:02:30.000Z')
    );
    assert.equal(secondOverview.recentRuns[0]?.status, 'failed');
    assert.match(secondOverview.recentRuns[0]?.errorMessage ?? '', /Transient renderer outage/i);
  } finally {
    await context.schedulerService.stop();
    context.repository.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('bootstrap marks interrupted scheduler runs as failed on startup', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-scheduler-recovery-'));
  const env = buildTestEnv(workspaceRoot);

  const firstContext = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  let staleRunId: string | null = null;

  try {
    const profile = firstContext.profilesService.get('profile_default');
    assert.ok(profile);

    const scheduledRun = firstContext.repository.ensureSchedulerRun({
      profileId: profile.id,
      topic: 'stalled scheduler run',
      scheduledFor: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      maxAttempts: 3,
    });
    const runningRun = firstContext.repository.claimSchedulerRun(scheduledRun.run.id);
    assert.ok(runningRun);
    staleRunId = runningRun.id;
  } finally {
    await firstContext.schedulerService.stop();
    firstContext.repository.close();
  }

  const secondContext = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    assert.ok(staleRunId);

    const recoveredRun = secondContext.repository.getSchedulerRun(staleRunId);
    assert.ok(recoveredRun);
    assert.equal(recoveredRun.status, 'failed');
    assert.equal(
      recoveredRun.errorMessage,
      'Scheduler run was interrupted by a server restart and was marked failed.'
    );

    const overview = secondContext.schedulerService.getOverview();
    assert.equal(overview.activeRuns, 0);
    assert.equal(overview.recentRuns[0]?.status, 'failed');
  } finally {
    await secondContext.schedulerService.stop();
    secondContext.repository.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('scheduler does not backfill slots from before a profile was re-enabled', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-scheduler-'));
  const env = buildTestEnv(workspaceRoot);

  const context = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    const profile = context.profilesService.get('profile_default');
    assert.ok(profile);

    context.profilesService.upsert('profile_default', {
      name: profile.name,
      niche: profile.niche,
      tone: profile.tone,
      visualStyle: profile.visualStyle,
      promptDirectives: profile.promptDirectives,
      preferredTopics: profile.preferredTopics,
      bannedTopics: profile.bannedTopics,
      bannedTerms: profile.bannedTerms,
      sceneCount: profile.sceneCount,
      maxDurationSeconds: profile.maxDurationSeconds,
      defaultHashtags: profile.defaultHashtags,
      callToActionStyle: profile.callToActionStyle,
      callToActionTemplate: profile.callToActionTemplate,
      callToActionGuardrails: profile.callToActionGuardrails,
      affiliateLinkTemplate: profile.affiliateLinkTemplate,
      requireAffiliateDisclosure: profile.requireAffiliateDisclosure,
      affiliateDisclosureTemplate: profile.affiliateDisclosureTemplate,
      enabled: false,
      scheduleCron: '* * * * *',
      targetPlatforms: profile.targetPlatforms,
      defaultVoice: profile.defaultVoice,
    });

    const nextTick = new Date();
    nextTick.setSeconds(0, 0);
    nextTick.setMinutes(nextTick.getMinutes() + 3);
    const lastTickCompletedAt = new Date(nextTick.getTime() - 8 * 60 * 1000).toISOString();

    context.profilesService.upsert('profile_default', {
      name: profile.name,
      niche: profile.niche,
      tone: profile.tone,
      visualStyle: profile.visualStyle,
      promptDirectives: profile.promptDirectives,
      preferredTopics: profile.preferredTopics,
      bannedTopics: profile.bannedTopics,
      bannedTerms: profile.bannedTerms,
      sceneCount: profile.sceneCount,
      maxDurationSeconds: profile.maxDurationSeconds,
      defaultHashtags: profile.defaultHashtags,
      callToActionStyle: profile.callToActionStyle,
      callToActionTemplate: profile.callToActionTemplate,
      callToActionGuardrails: profile.callToActionGuardrails,
      affiliateLinkTemplate: profile.affiliateLinkTemplate,
      requireAffiliateDisclosure: profile.requireAffiliateDisclosure,
      affiliateDisclosureTemplate: profile.affiliateDisclosureTemplate,
      enabled: true,
      scheduleCron: '* * * * *',
      targetPlatforms: profile.targetPlatforms,
      defaultVoice: profile.defaultVoice,
    });

    const resumeAt = context.repository.getSchedulerProfileResumeAt('profile_default');
    assert.ok(resumeAt);

    const schedulerHarness = context.schedulerService as unknown as {
      queueDueRuns(now: Date, lastTickCompletedAt: string | null): number;
    };
    const created = schedulerHarness.queueDueRuns(nextTick, lastTickCompletedAt);
    assert.equal(created >= 1, true);
    assert.equal(
      context.repository.listRecentSchedulerRuns(20).every((run) => run.scheduledFor >= resumeAt),
      true
    );
  } finally {
    await context.schedulerService.stop();
    context.repository.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('scheduler queues the current slot on the first exact-boundary tick', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-scheduler-'));
  const env = buildTestEnv(workspaceRoot);

  const context = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    const profile = context.profilesService.get('profile_default');
    assert.ok(profile);

    context.profilesService.upsert('profile_default', {
      name: profile.name,
      niche: profile.niche,
      tone: profile.tone,
      visualStyle: profile.visualStyle,
      promptDirectives: profile.promptDirectives,
      preferredTopics: profile.preferredTopics,
      bannedTopics: profile.bannedTopics,
      bannedTerms: profile.bannedTerms,
      sceneCount: profile.sceneCount,
      maxDurationSeconds: profile.maxDurationSeconds,
      defaultHashtags: profile.defaultHashtags,
      callToActionStyle: profile.callToActionStyle,
      callToActionTemplate: profile.callToActionTemplate,
      callToActionGuardrails: profile.callToActionGuardrails,
      affiliateLinkTemplate: profile.affiliateLinkTemplate,
      requireAffiliateDisclosure: profile.requireAffiliateDisclosure,
      affiliateDisclosureTemplate: profile.affiliateDisclosureTemplate,
      enabled: true,
      scheduleCron: '* * * * *',
      targetPlatforms: profile.targetPlatforms,
      defaultVoice: profile.defaultVoice,
    });

    const boundaryTick = new Date('2030-01-01T00:00:00.000Z');
    const overview = await context.schedulerService.runDueWork(boundaryTick);

    assert.equal(overview.recentRuns[0]?.scheduledFor, boundaryTick.toISOString());
  } finally {
    await context.schedulerService.stop();
    context.repository.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
