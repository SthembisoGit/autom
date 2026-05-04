import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import type { DashboardSummary, JobMonitorResponse, SchedulerOverview } from '@autom/contracts';

import { DashboardContent } from '../src/pages/DashboardPage';

test('DashboardContent caps failure previews and hands off to dedicated pages', () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <DashboardContent
        isLoading={false}
        isRunningScheduler={false}
        loadFailed={false}
        monitor={createMonitor()}
        onRetry={() => {}}
        onRunScheduler={async () => {}}
        scheduler={createScheduler()}
        schedulerBadgeStatus="idle"
        summary={createSummary()}
        summaryCards={[
          { label: 'Profiles', value: 1 },
          { label: 'Enabled', value: 1 },
          { label: 'Drafting', value: 0 },
          { label: 'Pending review', value: 2 },
          { label: 'Published', value: 5 },
        ]}
      />
    </MemoryRouter>
  );

  assert.match(markup, /Urgent next actions/i);
  assert.match(markup, /Open runs/i);
  assert.match(markup, /Open review/i);
  assert.match(markup, /Showing 3 of 4 failures/i);
  assert.doesNotMatch(markup, /Failure topic 4/i);
});

function createSummary(): DashboardSummary {
  return {
    totalProfiles: 1,
    enabledProfiles: 1,
    draftJobs: 0,
    reviewPendingJobs: 2,
    publishedJobs: 5,
  };
}

function createScheduler(): SchedulerOverview {
  return {
    enabled: true,
    running: false,
    pollIntervalSeconds: 30,
    queuedRuns: 0,
    activeRuns: 0,
    completedRuns24h: 3,
    failedRuns24h: 1,
    lastTickStartedAt: '2026-04-20T10:00:00.000Z',
    lastTickCompletedAt: '2026-04-20T10:00:05.000Z',
    recentRuns: [],
  };
}

function createMonitor(): JobMonitorResponse {
  return {
    active: [],
    failed: [1, 2, 3, 4].map((index) => ({
      job: {
        id: `job_${index}`,
        profileId: 'profile_1',
        topic: `Failure topic ${index}`,
        status: 'failed',
        scriptPackage: null,
        scriptMetadata: null,
        reviewPackage: null,
        manualClipBundle: null,
        publicationResults: [],
        errorMessage: 'Failure detail',
        archivedAt: null,
        archivedReason: null,
        createdAt: '2026-04-20T09:00:00.000Z',
        updatedAt: '2026-04-20T09:05:00.000Z',
      },
      progress: {
        stage: 'failed',
        title: 'Run failed',
        detail: 'Failure detail.',
        tone: 'danger',
        retryable: true,
        isTerminal: true,
        updatedAt: '2026-04-20T09:05:00.000Z',
      },
    })),
  };
}
