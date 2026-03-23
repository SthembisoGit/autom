import assert from 'node:assert/strict';
import test from 'node:test';

import { apiClient } from '../src/api/client';

const originalFetch = globalThis.fetch;

test('api client surfaces backend error messages for failed actions', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'Job cannot be published yet.' }), {
      status: 409,
      headers: {
        'Content-Type': 'application/json',
      },
    });

  await assert.rejects(apiClient.publishJob('job_123'), /Job cannot be published yet\./);
});

test('api client falls back to a generic message when the backend payload is unreadable', async () => {
  globalThis.fetch = async () =>
    new Response('not-json', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
      },
    });

  await assert.rejects(apiClient.listProfiles(), /Request failed\./);
});

test('api client builds artifact URLs from the configured API base URL', () => {
  assert.equal(
    apiClient.getRenderArtifactUrl('job_123', 'video'),
    'http://localhost:4010/jobs/job_123/artifacts/render/video'
  );
  assert.equal(
    apiClient.getLocalPublicationArtifactUrl('job_123', 'manifest'),
    'http://localhost:4010/jobs/job_123/artifacts/publications/local/manifest'
  );
});

test('api client requests the job monitor feed from the backend', async () => {
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ active: [], failed: [] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  };

  const payload = await apiClient.getJobMonitor();
  assert.equal(requestedUrl, 'http://localhost:4010/jobs/monitor');
  assert.deepEqual(payload, { active: [], failed: [] });
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
