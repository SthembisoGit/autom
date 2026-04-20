import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import type { GenerationJob, JobMonitorResponse } from '@autom/contracts';

import { RunsContent } from '../src/pages/RunsPage';

test('RunsContent groups active, failed, and completed runs into dedicated sections', () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <RunsContent
        historyJobs={[createPublishedJob('job_complete', 'Completed topic')]}
        isLoading={false}
        loadFailed={false}
        monitor={createMonitor()}
        onRetry={() => {}}
        onRetryJob={async () => {}}
        onRetryPublication={async () => {}}
        retryingJobId={null}
      />
    </MemoryRouter>
  );

  assert.match(markup, /In progress/i);
  assert.match(markup, /Failed and retryable/i);
  assert.match(markup, /Recently delivered/i);
  assert.match(markup, /Active topic/i);
  assert.match(markup, /Failed topic/i);
  assert.match(markup, /Completed topic/i);
});

function createMonitor(): JobMonitorResponse {
  return {
    active: [
      {
        job: createBaseJob('job_active', 'Active topic', 'drafting'),
        progress: {
          stage: 'generating_narration',
          title: 'Generating narration',
          detail: 'Voice generation is running.',
          tone: 'info',
          isTerminal: false,
          updatedAt: '2026-04-20T09:00:00.000Z',
        },
      },
    ],
    failed: [
      {
        job: createBaseJob('job_failed', 'Failed topic', 'failed'),
        progress: {
          stage: 'failed',
          title: 'Run failed',
          detail: 'Transient provider error.',
          tone: 'danger',
          retryable: true,
          isTerminal: true,
          updatedAt: '2026-04-20T09:05:00.000Z',
        },
      },
    ],
  };
}

function createPublishedJob(id: string, topic: string): GenerationJob {
  return {
    ...createBaseJob(id, topic, 'published'),
    publicationResults: [
      {
        platform: 'local',
        status: 'published',
        externalId: `${id}_local`,
        publishedAt: '2026-04-20T10:00:00.000Z',
        message: 'Archived locally.',
        connectorMode: 'live',
      },
    ],
  };
}

function createBaseJob(
  id: string,
  topic: string,
  status: GenerationJob['status']
): GenerationJob {
  return {
    id,
    profileId: 'profile_1',
    topic,
    status,
    scriptPackage: null,
    scriptMetadata: null,
    reviewPackage: null,
    manualClipBundle: null,
    publicationResults: [],
    errorMessage: null,
    createdAt: '2026-04-20T08:55:00.000Z',
    updatedAt: '2026-04-20T09:00:00.000Z',
  };
}
