import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { PlatformConnection, PublicationResult } from '@autom/contracts';

import { createApp } from '../src/app.js';
import { writeArtifactFile } from '../src/lib/artifacts.js';
import { bootstrap } from '../src/lib/bootstrap.js';
import type { Publisher, ScriptProvider, VisualProvider, VoiceProvider } from '../src/lib/types.js';
import { StubRenderer, type CommandRunner } from '../src/media/ffmpeg-renderer.js';

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

test('production env accepts public origins and restricts CORS to the ops host', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-production-'));
  const productionSessionSecret = 'production-session-secret-000000000000';
  const env = buildTestEnv(workspaceRoot, {
    NODE_ENV: 'production',
    APP_URL: 'https://api.example.com',
    OPS_URL: 'https://app.example.com',
    ENABLED_PUBLISHER_PLATFORMS: 'local,youtube',
    SCHEDULER_ENABLED: 'false',
    YOUTUBE_CLIENT_ID: 'test-client-id',
    YOUTUBE_CLIENT_SECRET: 'test-client-secret',
    YOUTUBE_REDIRECT_URI: 'https://api.example.com/publications/connections/youtube/callback',
    SESSION_SECRET: productionSessionSecret,
  });

  const app = await createApp({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    const allowedResponse = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        origin: 'https://app.example.com',
      },
    });

    assert.equal(allowedResponse.statusCode, 200);
    assert.equal(allowedResponse.headers['access-control-allow-origin'], 'https://app.example.com');

    const blockedResponse = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        origin: 'https://evil.example.com',
      },
    });

    assert.equal(blockedResponse.statusCode, 200);
    assert.equal(blockedResponse.headers['access-control-allow-origin'], undefined);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

async function createTestContext(options?: {
  publishers?: Publisher[];
  env?: Record<string, string>;
  commandRunner?: CommandRunner;
  scriptProvider?: ScriptProvider;
  voiceProvider?: VoiceProvider;
  visualProvider?: VisualProvider;
}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-test-'));
  const env = buildTestEnv(workspaceRoot, options?.env);
  const app = await createApp({
    env,
    mediaRenderer: new StubRenderer(),
    publishers: options?.publishers,
    commandRunner: options?.commandRunner,
    scriptProvider: options?.scriptProvider,
    voiceProvider: options?.voiceProvider,
    visualProvider: options?.visualProvider,
  });

  return {
    app,
    workspaceRoot,
  };
}

function createPublisherStub(platform: 'youtube' | 'tiktok' | 'facebook'): Publisher {
  let connected = false;

  return {
    platform,
    async getConnection() {
      return {
        platform,
        status: connected ? 'connected' : 'disconnected',
        configured: true,
        connected,
        accountLabel: connected ? `${platform}-account` : null,
        connectedAt: connected ? new Date().toISOString() : null,
        expiresAt: null,
        connectorMode: 'live',
        message: connected ? null : `No ${platform} account connected.`,
      };
    },
    async getAuthorizationUrl() {
      return `https://example.com/${platform}/oauth`;
    },
    async completeAuthorization() {
      connected = true;
      return this.getConnection();
    },
    async disconnect() {
      connected = false;
      return this.getConnection();
    },
    async publish(job) {
      return {
        platform,
        status: 'published',
        externalId: `${platform}_${job.id}`,
        publishedAt: new Date().toISOString(),
        message: `${platform} published`,
        connectorMode: 'live',
      };
    },
  };
}

function createConnectionSummary(platform: 'youtube' | 'tiktok' | 'facebook'): PlatformConnection {
  return {
    platform,
    status: 'disconnected',
    configured: true,
    connected: false,
    accountLabel: null,
    connectedAt: null,
    expiresAt: null,
    connectorMode: 'live',
    message: `No ${platform} account connected.`,
  };
}

function createSequencePublisher(
  platform: 'youtube' | 'tiktok' | 'facebook',
  results: PublicationResult[]
): {
  publisher: Publisher;
  getPublishCount(): number;
} {
  let publishCount = 0;

  return {
    publisher: {
      platform,
      async getConnection() {
        return createConnectionSummary(platform);
      },
      async getAuthorizationUrl() {
        return `https://example.com/${platform}/oauth`;
      },
      async completeAuthorization() {
        return createConnectionSummary(platform);
      },
      async disconnect() {
        return createConnectionSummary(platform);
      },
      async publish() {
        const result = results[Math.min(publishCount, results.length - 1)];
        publishCount += 1;
        return (
          result ?? {
            platform,
            status: 'failed',
            externalId: null,
            publishedAt: null,
            message: `${platform} publish sequence exhausted.`,
            connectorMode: 'live',
          }
        );
      },
    },
    getPublishCount() {
      return publishCount;
    },
  };
}

function createFailingAuthorizationPublisher(
  platform: 'youtube' | 'tiktok' | 'facebook'
): Publisher {
  return {
    platform,
    async getConnection() {
      return createConnectionSummary(platform);
    },
    async getAuthorizationUrl() {
      return `https://example.com/${platform}/oauth`;
    },
    async completeAuthorization(input) {
      throw new Error(input.errorDescription ?? `${platform} authorization failed.`);
    },
    async disconnect() {
      return createConnectionSummary(platform);
    },
    async publish() {
      return {
        platform,
        status: 'published',
        externalId: `${platform}_published`,
        publishedAt: new Date().toISOString(),
        message: `${platform} published`,
        connectorMode: 'live',
      };
    },
  };
}

test('server workflow creates, reviews, and publishes a job', async () => {
  const { app, workspaceRoot } = await createTestContext();

  try {
    const rootResponse = await app.inject({
      method: 'GET',
      url: '/',
    });
    assert.equal(rootResponse.statusCode, 200);
    assert.equal(rootResponse.json().ok, true);

    const connectionsResponse = await app.inject({
      method: 'GET',
      url: '/publications/connections',
    });
    assert.equal(connectionsResponse.statusCode, 200);
    assert.equal(
      connectionsResponse
        .json()
        .some(
          (connection: { platform: string; connected: boolean; configured: boolean }) =>
            connection.platform === 'local' && connection.connected && connection.configured
        ),
      true
    );

    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profiles = profilesResponse.json() as Array<{
      id: string;
      name: string;
      niche: string;
      preferredTopics: string[];
      targetPlatforms: string[];
      defaultHashtags: string[];
    }>;
    assert.equal(profiles[0]?.name, 'autoM Media');
    assert.equal(profiles[0]?.niche, 'high-intent finance, SaaS, and digital growth');
    assert.equal(profiles[0]?.maxDurationSeconds, 90);
    assert.deepEqual(profiles[0]?.preferredTopics.slice(0, 3), [
      'Best CRM for 2026',
      'AI workflow automation',
      'SEO and programmatic SEO guides',
    ]);
    assert.deepEqual(profiles[0]?.defaultHashtags, ['finance', 'saas', 'automation', 'seo']);
    assert.deepEqual(profiles[0]?.targetPlatforms, ['local']);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId: profiles[0]?.id,
        topic: 'discipline over hype',
      },
    });
    assert.equal(createResponse.statusCode, 200);

    const createdJob = createResponse.json() as {
      id: string;
      status: string;
      scriptMetadata: { provider: string; promptVersion: string };
    };
    assert.equal(createdJob.status, 'review_pending');
    assert.equal(createdJob.scriptMetadata.provider, 'local');
    assert.equal(createdJob.scriptMetadata.promptVersion, 'local-script-template-v1');
    assert.equal(createResponse.json().reviewPackage.renderBundle.thumbnailPath !== null, true);
    assert.equal(
      createResponse
        .json()
        .reviewPackage.assetBundle.assetReferences.some(
          (reference: { kind: string; provider: string }) =>
            reference.kind === 'metadata' && reference.provider === 'local'
        ),
      true
    );
    assert.equal(
      createResponse
        .json()
        .reviewPackage.assetBundle.assetReferences.some(
          (reference: { kind: string; provider: string }) =>
            reference.kind === 'subtitle' && reference.provider === 'system'
        ),
      true
    );

    const monitorResponse = await app.inject({
      method: 'GET',
      url: '/jobs/monitor',
    });
    assert.equal(monitorResponse.statusCode, 200);
    assert.equal(monitorResponse.json().active[0].job.id, createdJob.id);
    assert.equal(monitorResponse.json().active[0].progress.stage, 'ready_for_review');

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/jobs/${createdJob.id}`,
    });
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.json().progress.stage, 'ready_for_review');

    const reviewResponse = await app.inject({
      method: 'POST',
      url: `/reviews/${createdJob.id}/approve`,
      payload: {
        note: 'Looks ready for the queue.',
      },
    });
    assert.equal(reviewResponse.statusCode, 200);
    assert.equal(reviewResponse.json().status, 'approved');

    const localManifestBeforePublishResponse = await app.inject({
      method: 'GET',
      url: `/jobs/${createdJob.id}/artifacts/publications/local/manifest`,
    });
    assert.equal(localManifestBeforePublishResponse.statusCode, 404);

    const publishResponse = await app.inject({
      method: 'POST',
      url: `/publications/${createdJob.id}/publish`,
      payload: {},
    });
    assert.equal(publishResponse.statusCode, 200);
    assert.equal(publishResponse.json().status, 'published');
    assert.equal(publishResponse.json().publicationResults[0].platform, 'local');

    await access(join(workspaceRoot, 'var', 'published', 'local', createdJob.id, 'video.mp4'));
    await access(join(workspaceRoot, 'var', 'published', 'local', createdJob.id, 'captions.srt'));
    await access(
      join(workspaceRoot, 'var', 'published', 'local', createdJob.id, 'publication.json')
    );

    const renderVideoResponse = await app.inject({
      method: 'GET',
      url: `/jobs/${createdJob.id}/artifacts/render/video`,
    });
    assert.equal(renderVideoResponse.statusCode, 200);
    assert.match(String(renderVideoResponse.headers['content-type'] ?? ''), /video\/mp4/i);

    const localManifestResponse = await app.inject({
      method: 'GET',
      url: `/jobs/${createdJob.id}/artifacts/publications/local/manifest`,
    });
    assert.equal(localManifestResponse.statusCode, 200);
    assert.equal(localManifestResponse.json().jobId, createdJob.id);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('server pauses for a manual clip and resumes after upload', async () => {
  const commandRunner: CommandRunner = async () => ({
    stdout: JSON.stringify({
      streams: [
        {
          width: 1080,
          height: 1920,
          codec_name: 'h264',
        },
      ],
      format: {
        duration: '8.0',
      },
    }),
    stderr: '',
  });

  const scriptProvider: ScriptProvider = {
    async generate() {
      return {
        scriptPackage: {
          id: 'script_manual_clip',
          title: 'Manual Clip Script',
          description: 'Testing manual clip intake.',
          tags: ['crm', 'demo'],
          scenes: [
            {
              order: 1,
              text: 'Show the CRM dashboard while a founder clicks through a clean product demo.',
              visualQuery: 'CRM dashboard product demo',
              durationSeconds: 12,
            },
          ],
          totalDurationSeconds: 12,
        },
        scriptMetadata: {
          provider: 'local',
          model: null,
          promptVersion: 'manual-clip-test-v1',
          mode: 'stub',
          attemptCount: 1,
          repaired: false,
        },
      };
    },
  };

  const voiceProvider: VoiceProvider = {
    async synthesize() {
      return {
        narrationPath: null,
        assetReferences: [],
        warnings: [],
        sceneNarrationTimeline: null,
      };
    },
  };

  const { app, workspaceRoot } = await createTestContext({
    commandRunner,
    scriptProvider,
    voiceProvider,
  });

  try {
    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profiles = profilesResponse.json() as Array<{ id: string }>;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId: profiles[0]?.id,
        topic: 'Best CRM for 2026',
      },
    });
    assert.equal(createResponse.statusCode, 200);
    assert.equal(createResponse.json().status, 'waiting_for_manual_clip');

    const manualClipBundle = createResponse.json().manualClipBundle as {
      requests: Array<{
        sceneOrder: number;
        prompt: string;
        audioDirective: string;
        status: string;
      }>;
    };
    assert.equal(manualClipBundle.requests.length, 1);
    assert.match(manualClipBundle.requests[0]?.prompt ?? '', /Manual Veo clip brief/i);
    assert.match(manualClipBundle.requests[0]?.audioDirective ?? '', /no spoken dialogue/i);

    const uploadResponse = await app.inject({
      method: 'POST',
      url: `/jobs/${createResponse.json().id}/manual-clips/${manualClipBundle.requests[0]?.sceneOrder}`,
      headers: {
        'content-type': 'video/mp4',
        'x-file-name': 'manual-clip.mp4',
      },
      payload: Buffer.from('fake-mp4-data'),
    });
    assert.equal(uploadResponse.statusCode, 200);
    assert.equal(uploadResponse.json().status, 'review_pending');

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/jobs/${createResponse.json().id}`,
    });
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.json().job.status, 'review_pending');
    assert.equal(detailResponse.json().progress.stage, 'ready_for_review');
    assert.equal(
      detailResponse
        .json()
        .job.reviewPackage.assetBundle.assetReferences.some(
          (reference: { provider: string }) => reference.provider === 'veo'
        ),
      true
    );
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('server returns useful error codes and blocks invalid state transitions', async () => {
  const { app, workspaceRoot } = await createTestContext();

  try {
    const invalidCreateResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {},
    });
    assert.equal(invalidCreateResponse.statusCode, 400);
    assert.equal(invalidCreateResponse.json().message, 'Invalid request payload.');

    const missingProfileResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId: 'missing-profile',
        topic: 'systems thinking',
      },
    });
    assert.equal(missingProfileResponse.statusCode, 404);
    assert.equal(missingProfileResponse.json().message, 'Profile missing-profile not found.');

    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profiles = profilesResponse.json() as Array<{ id: string }>;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId: profiles[0]?.id,
        topic: 'quality loops',
      },
    });
    assert.equal(createResponse.statusCode, 200);
    const createdJob = createResponse.json() as { id: string };

    const missingReviewResponse = await app.inject({
      method: 'POST',
      url: '/reviews/missing-job/approve',
      payload: {},
    });
    assert.equal(missingReviewResponse.statusCode, 404);
    assert.equal(missingReviewResponse.json().message, 'Job missing-job not found.');

    const rejectApprovedResponse = await app.inject({
      method: 'POST',
      url: `/reviews/${createdJob.id}/approve`,
      payload: {},
    });
    assert.equal(rejectApprovedResponse.statusCode, 200);

    const rejectFromApprovedResponse = await app.inject({
      method: 'POST',
      url: `/reviews/${createdJob.id}/reject`,
      payload: {},
    });
    assert.equal(rejectFromApprovedResponse.statusCode, 200);

    const rejectDraftingResponse = await app.inject({
      method: 'POST',
      url: `/reviews/${createdJob.id}/reject`,
      payload: {},
    });
    assert.equal(rejectDraftingResponse.statusCode, 409);
    assert.equal(
      rejectDraftingResponse.json().message,
      `Job ${createdJob.id} cannot be rejected from status drafting.`
    );

    const publishDraftingResponse = await app.inject({
      method: 'POST',
      url: `/publications/${createdJob.id}/publish`,
      payload: {},
    });
    assert.equal(publishDraftingResponse.statusCode, 409);
    assert.equal(
      publishDraftingResponse.json().message,
      `Job ${createdJob.id} must be approved before publishing.`
    );
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('server blocks duplicate active jobs for the same profile and topic', async () => {
  const { app, workspaceRoot } = await createTestContext();

  try {
    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profiles = profilesResponse.json() as Array<{ id: string }>;
    const profileId = profiles[0]?.id;

    const firstCreateResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId,
        topic: 'repeatable systems',
      },
    });
    assert.equal(firstCreateResponse.statusCode, 200);

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId,
        topic: '  repeatable systems  ',
      },
    });
    assert.equal(duplicateResponse.statusCode, 409);
    assert.match(duplicateResponse.json().message, /active job already exists/i);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('bootstrap upgrades an untouched tech profile to the balanced strategy', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-bootstrap-'));
  const env = buildTestEnv(workspaceRoot);

  const firstContext = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    const seededProfile = firstContext.repository.getProfile('profile_default');
    assert.ok(seededProfile);

    firstContext.repository.upsertProfile({
      ...seededProfile,
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
      ],
      bannedTerms: [
        'guaranteed income',
        'overnight success',
        'secret loophole',
        'must-buy before it sells out',
      ],
      defaultHashtags: ['finance', 'saas', 'automation', 'seo'],
      callToActionStyle: 'educational',
      callToActionTemplate: 'Follow autoM Media for the next tool, strategy, or comparison worth knowing.',
      callToActionGuardrails:
        'Keep the CTA short, honest, and product-led. Do not use fake urgency or promise personal, financial, or life-changing outcomes.',
      targetPlatforms: ['local', 'youtube'],
    });
  } finally {
    await firstContext.schedulerService.stop();
    firstContext.repository.close();
  }

  const secondContext = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    const migratedProfile = secondContext.repository.getProfile('profile_default');
    assert.ok(migratedProfile);
    assert.equal(migratedProfile.name, 'autoM Media');
    assert.equal(migratedProfile.niche, 'high-intent finance, SaaS, and digital growth');
    assert.equal(migratedProfile.maxDurationSeconds, 90);
    assert.deepEqual(migratedProfile.preferredTopics.slice(0, 3), [
      'Best CRM for 2026',
      'AI workflow automation',
      'SEO and programmatic SEO guides',
    ]);
    assert.deepEqual(migratedProfile.defaultHashtags, ['finance', 'saas', 'automation', 'seo']);
    assert.deepEqual(migratedProfile.targetPlatforms, ['local', 'youtube']);
  } finally {
    await secondContext.schedulerService.stop();
    secondContext.repository.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('bootstrap still upgrades the older stoic legacy profile to the balanced strategy', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-bootstrap-'));
  const env = buildTestEnv(workspaceRoot);

  const firstContext = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    const seededProfile = firstContext.repository.getProfile('profile_default');
    assert.ok(seededProfile);

    firstContext.repository.upsertProfile({
      ...seededProfile,
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
      targetPlatforms: ['local', 'youtube'],
    });
  } finally {
    await firstContext.schedulerService.stop();
    firstContext.repository.close();
  }

  const secondContext = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    const migratedProfile = secondContext.repository.getProfile('profile_default');
    assert.ok(migratedProfile);
    assert.equal(migratedProfile.niche, 'high-intent finance, SaaS, and digital growth');
    assert.equal(migratedProfile.maxDurationSeconds, 90);
    assert.deepEqual(migratedProfile.preferredTopics.slice(0, 3), [
      'Best CRM for 2026',
      'AI workflow automation',
      'SEO and programmatic SEO guides',
    ]);
    assert.deepEqual(migratedProfile.defaultHashtags, ['finance', 'saas', 'automation', 'seo']);
    assert.deepEqual(migratedProfile.targetPlatforms, ['local', 'youtube']);
  } finally {
    await secondContext.schedulerService.stop();
    secondContext.repository.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('bootstrap marks interrupted draft jobs as failed on startup', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-bootstrap-recovery-'));
  const env = buildTestEnv(workspaceRoot);
  const firstContext = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  let staleJobId: string | null = null;

  try {
    const profile = firstContext.repository.getProfile('profile_default');
    assert.ok(profile);

    const staleJob = firstContext.repository.createJob({
      profileId: profile.id,
      topic: 'stalled render',
    });
    staleJobId = staleJob.id;
  } finally {
    await firstContext.schedulerService.stop();
    firstContext.repository.close();
  }

  const secondContext = await bootstrap({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    assert.ok(staleJobId);

    const recoveredJob = secondContext.repository.getJob(staleJobId);
    assert.ok(recoveredJob);
    assert.equal(recoveredJob.status, 'failed');
    assert.equal(
      recoveredJob.errorMessage,
      'Draft job was interrupted by a server restart and was marked failed.'
    );

    const auditMessages = secondContext.auditService.list(staleJobId).map((event) => event.message);
    assert.match(
      auditMessages.join('\n'),
      /Draft job was interrupted by a server restart and was marked failed\./
    );
  } finally {
    await secondContext.schedulerService.stop();
    secondContext.repository.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('failed jobs marked retryable can be retried from the run detail flow', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-retry-'));
  const env = buildTestEnv(workspaceRoot);
  let renderAttempts = 0;
  const renderer = new StubRenderer();

  const app = await createApp({
    env,
    mediaRenderer: {
      async render(input) {
        renderAttempts += 1;

        if (renderAttempts === 1) {
          throw new Error('Transient renderer outage.');
        }

        return renderer.render(input);
      },
    },
  });

  try {
    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profile = profilesResponse.json()[0] as { id: string };

    const createResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId: profile.id,
        topic: 'retryable workflow check',
      },
    });
    assert.equal(createResponse.statusCode, 200);
    assert.equal(createResponse.json().status, 'failed');

    const failedJobId = createResponse.json().id as string;
    const failedDetailResponse = await app.inject({
      method: 'GET',
      url: `/jobs/${failedJobId}`,
    });
    assert.equal(failedDetailResponse.statusCode, 200);
    assert.equal(failedDetailResponse.json().progress.retryable, true);

    const retryResponse = await app.inject({
      method: 'POST',
      url: `/jobs/${failedJobId}/retry`,
    });
    assert.equal(retryResponse.statusCode, 200);
    assert.equal(retryResponse.json().status, 'review_pending');
    assert.notEqual(retryResponse.json().id, failedJobId);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('profile updates validate richer prompt rules and policy constraints', async () => {
  const { app, workspaceRoot } = await createTestContext();

  try {
    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profiles = profilesResponse.json() as Array<{ id: string }>;
    const profileId = profiles[0]?.id;

    const invalidProfileResponse = await app.inject({
      method: 'PUT',
      url: `/profiles/${profileId}`,
      payload: {
        name: 'Operator Profile',
        niche: 'automation systems',
        tone: 'clear and decisive',
        visualStyle: 'architectural black and white footage',
        promptDirectives: 'Use crisp practical guidance.',
        preferredTopics: ['systems', 'habits'],
        bannedTopics: ['medical advice'],
        bannedTerms: ['guaranteed outcome'],
        sceneCount: 7,
        maxDurationSeconds: 18,
        defaultHashtags: ['systems', 'discipline'],
        callToActionStyle: 'affiliate',
        callToActionTemplate: 'Use the link below.',
        callToActionGuardrails: 'No unrealistic promises.',
        affiliateLinkTemplate: '',
        requireAffiliateDisclosure: true,
        affiliateDisclosureTemplate: '',
        enabled: true,
        scheduleCron: '0 7 * * *',
        targetPlatforms: ['youtube'],
        defaultVoice: 'aura-2-thalia-en',
      },
    });
    assert.equal(invalidProfileResponse.statusCode, 400);
    assert.equal(invalidProfileResponse.json().message, 'Invalid request payload.');

    const validProfileResponse = await app.inject({
      method: 'PUT',
      url: `/profiles/${profileId}`,
      payload: {
        name: 'Operator Profile',
        niche: 'automation systems',
        tone: 'clear and decisive',
        visualStyle: 'architectural black and white footage',
        promptDirectives: 'Use crisp practical guidance.',
        preferredTopics: ['systems', 'habits'],
        bannedTopics: ['medical advice'],
        bannedTerms: ['guaranteed outcome'],
        sceneCount: 6,
        maxDurationSeconds: 180,
        defaultHashtags: ['systems', 'discipline'],
        callToActionStyle: 'affiliate',
        callToActionTemplate: 'Use the link below.',
        callToActionGuardrails: 'No unrealistic promises.',
        affiliateLinkTemplate: 'https://example.com/product',
        requireAffiliateDisclosure: true,
        affiliateDisclosureTemplate: 'Disclosure: this may include an affiliate link.',
        enabled: true,
        scheduleCron: '0 7 * * *',
        targetPlatforms: ['local', 'youtube'],
        defaultVoice: 'aura-2-thalia-en',
      },
    });
    assert.equal(validProfileResponse.statusCode, 200);
    assert.equal(validProfileResponse.json().callToActionStyle, 'affiliate');
    assert.deepEqual(validProfileResponse.json().preferredTopics, ['systems', 'habits']);

    const oversizedProfileResponse = await app.inject({
      method: 'PUT',
      url: `/profiles/${profileId}`,
      payload: {
        name: 'Operator Profile',
        niche: 'automation systems',
        tone: 'clear and decisive',
        visualStyle: 'architectural black and white footage',
        promptDirectives: 'Use crisp practical guidance.',
        preferredTopics: ['systems', 'habits'],
        bannedTopics: ['medical advice'],
        bannedTerms: ['guaranteed outcome'],
        sceneCount: 6,
        maxDurationSeconds: 181,
        defaultHashtags: ['systems', 'discipline'],
        callToActionStyle: 'affiliate',
        callToActionTemplate: 'Use the link below.',
        callToActionGuardrails: 'No unrealistic promises.',
        affiliateLinkTemplate: 'https://example.com/product',
        requireAffiliateDisclosure: true,
        affiliateDisclosureTemplate: 'Disclosure: this may include an affiliate link.',
        enabled: true,
        scheduleCron: '0 7 * * *',
        targetPlatforms: ['local', 'youtube'],
        defaultVoice: 'aura-2-thalia-en',
      },
    });
    assert.equal(oversizedProfileResponse.statusCode, 400);
    assert.equal(oversizedProfileResponse.json().message, 'Invalid request payload.');

    const blockedTopicResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId,
        topic: 'Medical advice for entrepreneurs',
      },
    });
    assert.equal(blockedTopicResponse.statusCode, 400);
    assert.match(blockedTopicResponse.json().message, /violates profile policy/i);

    const profileSchemaResponse = await app.inject({
      method: 'GET',
      url: '/profiles/schema',
    });
    assert.equal(profileSchemaResponse.statusCode, 200);
    assert.match(profileSchemaResponse.body, /visualStyle/);
    assert.deepEqual(profileSchemaResponse.json().availableTargetPlatforms, ['local', 'youtube']);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('default launch scope seeds local targets, hides TikTok, and rejects explicit TikTok publish requests', async () => {
  const { app, workspaceRoot } = await createTestContext();

  try {
    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profile = profilesResponse.json()[0] as { id: string; targetPlatforms: string[] };
    assert.deepEqual(profile.targetPlatforms, ['local']);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId: profile.id,
        topic: 'launch scope check',
      },
    });
    assert.equal(createResponse.statusCode, 200);

    const createdJob = createResponse.json() as { id: string };
    const approveResponse = await app.inject({
      method: 'POST',
      url: `/reviews/${createdJob.id}/approve`,
      payload: {},
    });
    assert.equal(approveResponse.statusCode, 200);

    const publishResponse = await app.inject({
      method: 'POST',
      url: `/publications/${createdJob.id}/publish`,
      payload: {
        targets: ['tiktok'],
      },
    });
    assert.equal(publishResponse.statusCode, 400);
    assert.match(publishResponse.json().message, /not enabled for this deployment/i);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('artifact routes return 404 for missing jobs or unavailable local publication files', async () => {
  const { app, workspaceRoot } = await createTestContext();

  try {
    const missingRenderResponse = await app.inject({
      method: 'GET',
      url: '/jobs/missing-job/artifacts/render/video',
    });
    assert.equal(missingRenderResponse.statusCode, 404);

    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profiles = profilesResponse.json() as Array<{ id: string }>;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId: profiles[0]?.id,
        topic: 'artifact route checks',
      },
    });
    assert.equal(createResponse.statusCode, 200);

    const createdJob = createResponse.json() as { id: string };
    const localArtifactResponse = await app.inject({
      method: 'GET',
      url: `/jobs/${createdJob.id}/artifacts/publications/local/video`,
    });
    assert.equal(localArtifactResponse.statusCode, 404);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('server cleans partial job assets when rendering fails', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-test-'));
  const env = buildTestEnv(workspaceRoot);

  const app = await createApp({
    env,
    voiceProvider: {
      async synthesize(_scriptPackage, _profile, jobId, runtimePaths) {
        const outputPath = join(runtimePaths.tempDirectory, jobId, 'voice', 'narration.mp3');
        await writeArtifactFile(outputPath, Buffer.from('voice-bytes'));
        return {
          narrationPath: outputPath,
          assetReferences: [
            {
              kind: 'audio',
              path: outputPath,
              label: 'Custom narration',
              provider: 'deepgram',
              sourceUrl: 'https://api.deepgram.com/v1/speak',
              mimeType: 'audio/mpeg',
              externalId: null,
              sceneOrder: null,
              query: null,
            },
          ],
          warnings: [],
        };
      },
    },
    visualProvider: {
      async select({ jobId, runtimePaths, scriptPackage }) {
        const outputPath = join(runtimePaths.tempDirectory, jobId, 'visuals', 'scene-1.mp4');
        await mkdir(join(runtimePaths.tempDirectory, jobId, 'visuals'), { recursive: true });
        await writeFile(outputPath, 'visual-bytes', 'utf8');
        return {
          selectedVisualQueries: [scriptPackage.scenes[0]?.visualQuery ?? 'fallback-query'],
          assetReferences: [
            {
              kind: 'video',
              path: outputPath,
              label: 'Custom clip',
              provider: 'pexels',
              sourceUrl: 'https://www.pexels.com/video/example',
              mimeType: 'video/mp4',
              externalId: 'asset-1',
              sceneOrder: 1,
              query: scriptPackage.scenes[0]?.visualQuery ?? 'fallback-query',
            },
          ],
          warnings: [],
        };
      },
    },
    mediaRenderer: {
      async render() {
        throw new Error('Render crashed.');
      },
    },
  });

  try {
    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profiles = profilesResponse.json() as Array<{ id: string }>;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId: profiles[0]?.id,
        topic: 'cleanup check',
      },
    });
    assert.equal(createResponse.statusCode, 200);
    assert.equal(createResponse.json().status, 'failed');

    const jobId = createResponse.json().id as string;
    await assert.rejects(access(join(workspaceRoot, 'var', 'temp', jobId)));
    await assert.rejects(access(join(workspaceRoot, 'var', 'output', jobId)));
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('publication connection routes expose start, callback, and disconnect flows', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-test-'));
  const env = buildTestEnv(workspaceRoot);

  const app = await createApp({
    env,
    mediaRenderer: new StubRenderer(),
    publishers: [createPublisherStub('youtube')],
  });

  try {
    const listBefore = await app.inject({
      method: 'GET',
      url: '/publications/connections',
    });
    assert.equal(listBefore.statusCode, 200);
    assert.equal(listBefore.json()[0].status, 'disconnected');

    const startResponse = await app.inject({
      method: 'GET',
      url: '/publications/connections/youtube/start?format=json',
    });
    assert.equal(startResponse.statusCode, 200);
    assert.equal(startResponse.json().authorizationUrl, 'https://example.com/youtube/oauth');

    const callbackResponse = await app.inject({
      method: 'GET',
      url: '/publications/connections/youtube/callback?format=json&code=demo-code&state=demo-state',
    });
    assert.equal(callbackResponse.statusCode, 200);
    assert.equal(callbackResponse.json().status, 'connected');

    const disconnectResponse = await app.inject({
      method: 'DELETE',
      url: '/publications/connections/youtube',
    });
    assert.equal(disconnectResponse.statusCode, 200);
    assert.equal(disconnectResponse.json().status, 'disconnected');
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('youtube authorization requests upload and readonly scopes', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-test-'));
  const env = buildTestEnv(workspaceRoot, {
    YOUTUBE_CLIENT_ID: 'test-client-id',
    YOUTUBE_CLIENT_SECRET: 'test-client-secret',
    YOUTUBE_REDIRECT_URI: 'http://localhost:4010/publications/connections/youtube/callback',
  });

  const app = await createApp({
    env,
    mediaRenderer: new StubRenderer(),
  });

  try {
    const startResponse = await app.inject({
      method: 'GET',
      url: '/publications/connections/youtube/start?format=json',
    });

    assert.equal(startResponse.statusCode, 200);

    const authorizationUrl = new URL(startResponse.json().authorizationUrl as string);
    const scopes = new Set((authorizationUrl.searchParams.get('scope') ?? '').split(' '));
    assert.equal(scopes.has('https://www.googleapis.com/auth/youtube.upload'), true);
    assert.equal(scopes.has('https://www.googleapis.com/auth/youtube.readonly'), true);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('publish retries only retry unfinished platforms and preserve successful results', async () => {
  const youtubePublisher = createSequencePublisher('youtube', [
    {
      platform: 'youtube',
      status: 'published',
      externalId: 'yt_first',
      publishedAt: '2026-03-18T12:00:00.000Z',
      message: 'YouTube published',
      connectorMode: 'live',
    },
  ]);
  const facebookPublisher = createSequencePublisher('facebook', [
    {
      platform: 'facebook',
      status: 'published',
      externalId: 'fb_first',
      publishedAt: '2026-03-18T12:00:00.000Z',
      message: 'Facebook published',
      connectorMode: 'live',
    },
  ]);
  const tiktokPublisher = createSequencePublisher('tiktok', [
    {
      platform: 'tiktok',
      status: 'failed',
      externalId: null,
      publishedAt: null,
      message: 'TikTok upload failed',
      connectorMode: 'live',
    },
    {
      platform: 'tiktok',
      status: 'published',
      externalId: 'tt_retry',
      publishedAt: '2026-03-18T12:05:00.000Z',
      message: 'TikTok published on retry',
      connectorMode: 'live',
    },
  ]);
  const { app, workspaceRoot } = await createTestContext({
    publishers: [
      youtubePublisher.publisher,
      tiktokPublisher.publisher,
      facebookPublisher.publisher,
    ],
  });

  try {
    const profilesResponse = await app.inject({
      method: 'GET',
      url: '/profiles',
    });
    const profiles = profilesResponse.json() as Array<{ id: string }>;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/jobs/generate',
      payload: {
        profileId: profiles[0]?.id,
        topic: 'retry publish safety',
      },
    });
    assert.equal(createResponse.statusCode, 200);
    const createdJob = createResponse.json() as { id: string };

    const approveResponse = await app.inject({
      method: 'POST',
      url: `/reviews/${createdJob.id}/approve`,
      payload: {},
    });
    assert.equal(approveResponse.statusCode, 200);

    const firstPublishResponse = await app.inject({
      method: 'POST',
      url: `/publications/${createdJob.id}/publish`,
      payload: {
        targets: ['youtube', 'tiktok', 'facebook'],
      },
    });
    assert.equal(firstPublishResponse.statusCode, 200);
    assert.equal(firstPublishResponse.json().status, 'failed');
    assert.match(
      firstPublishResponse.json().errorMessage,
      /TikTok upload failed/i
    );
    assert.equal(youtubePublisher.getPublishCount(), 1);
    assert.equal(tiktokPublisher.getPublishCount(), 1);
    assert.equal(facebookPublisher.getPublishCount(), 1);

    const retryPublishResponse = await app.inject({
      method: 'POST',
      url: `/publications/${createdJob.id}/publish`,
      payload: {
        targets: ['youtube', 'tiktok', 'facebook'],
      },
    });
    assert.equal(retryPublishResponse.statusCode, 200);
    assert.equal(retryPublishResponse.json().status, 'published');
    assert.equal(youtubePublisher.getPublishCount(), 1);
    assert.equal(tiktokPublisher.getPublishCount(), 2);
    assert.equal(facebookPublisher.getPublishCount(), 1);
    assert.deepEqual(
      retryPublishResponse
        .json()
        .publicationResults.map((result: { platform: string; externalId: string | null }) => ({
          platform: result.platform,
          externalId: result.externalId,
        })),
      [
        { platform: 'youtube', externalId: 'yt_first' },
        { platform: 'tiktok', externalId: 'tt_retry' },
        { platform: 'facebook', externalId: 'fb_first' },
      ]
    );
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('publication callback page escapes payloads before embedding them in inline script', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'autom-test-'));
  const env = buildTestEnv(workspaceRoot);

  const app = await createApp({
    env,
    mediaRenderer: new StubRenderer(),
    publishers: [createFailingAuthorizationPublisher('youtube')],
  });
  const maliciousMessage = '</script><script>window.attack=1</script>';

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/publications/connections/youtube/callback?error=access_denied&error_description=${encodeURIComponent(maliciousMessage)}`,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.includes(maliciousMessage), false);
    assert.match(
      response.body,
      /\\u003c\/script\\u003e\\u003cscript\\u003ewindow\.attack=1\\u003c\/script\\u003e/
    );
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
