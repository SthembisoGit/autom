import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import type { GenerationJob } from '@autom/contracts';

import { ReviewActions, getReviewActionConfirmation } from '../src/features/ReviewActions';
import { ReviewsContent } from '../src/pages/ReviewsPage';

test('ReviewsContent renders a helpful empty state when the queue is clear', () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <ReviewsContent
        busyState={null}
        isLoading={false}
        jobs={[]}
        loadFailed={false}
        onApprove={async () => {}}
        onPublish={async () => {}}
        onReject={async () => {}}
        onRetry={() => {}}
      />
    </MemoryRouter>
  );

  assert.match(markup, /No jobs are waiting for review/i);
  assert.match(markup, /Approved work will appear here/i);
});

test('ReviewsContent surfaces warnings and job stats for pending review work', () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <ReviewsContent
        busyState={{ jobId: 'job_1', action: 'approve' }}
        isLoading={false}
        jobs={[createReviewJob()]}
        loadFailed={false}
        onApprove={async () => {}}
        onPublish={async () => {}}
        onReject={async () => {}}
        onRetry={() => {}}
      />
    </MemoryRouter>
  );

  assert.match(markup, /2 scenes, 2 assets/i);
  assert.match(markup, /Review warnings: 1 warning before approval/i);
  assert.match(markup, /Review warnings/i);
  assert.match(markup, /Approving\.\.\./i);
});

test('ReviewActions exposes explicit confirmation copy for publish actions', () => {
  const message = getReviewActionConfirmation('publish', 'AI workflow demo');

  assert.match(message, /AI workflow demo/);
  assert.match(message, /configured platforms/i);
});

test('ReviewActions renders publish guidance when publish is available', () => {
  const markup = renderToStaticMarkup(
    <ReviewActions
      jobLabel="AI workflow demo"
      onApprove={async () => {}}
      onPublish={async () => {}}
      onReject={async () => {}}
    />
  );

  assert.match(markup, /Publish after the review and profile settings look correct/i);
  assert.match(markup, /Publish/i);
});

function createReviewJob(): GenerationJob {
  return {
    id: 'job_1',
    profileId: 'profile_1',
    topic: 'AI workflow demo',
    status: 'approved',
    scriptPackage: {
      id: 'script_1',
      title: 'Build a reliable review workflow',
      description: 'Demo script.',
      tags: ['ops'],
      scenes: [
        { order: 1, text: 'Scene 1', visualQuery: 'workflow', durationSeconds: 5 },
        { order: 2, text: 'Scene 2', visualQuery: 'review', durationSeconds: 5 },
      ],
      totalDurationSeconds: 10,
    },
    scriptMetadata: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      promptVersion: 'v1',
      mode: 'live',
      attemptCount: 1,
      repaired: false,
    },
    reviewPackage: {
      summary: 'Ready for approval.',
      warnings: ['Check the CTA wording.'],
      generatedAt: '2026-03-18T10:00:00.000Z',
      renderBundle: {
        outputVideoPath: 'var/output/job_1/preview.mp4',
        subtitlesPath: 'var/output/job_1/subtitles.srt',
        thumbnailPath: 'var/output/job_1/thumbnail.jpg',
        durationSeconds: 10,
        renderedDurationSeconds: 10,
        narrationDurationSeconds: 10,
        subtitleCueCount: 4,
      },
      assetBundle: {
        selectedVisualQueries: ['workflow', 'review'],
        assetReferences: [
          {
            kind: 'video',
            path: 'var/temp/job_1/clip-1.mp4',
            label: 'Clip 1',
            provider: 'pexels',
            sourceUrl: 'https://example.com/clip-1',
            mimeType: 'video/mp4',
            externalId: 'clip_1',
            sceneOrder: 1,
            query: 'workflow',
          },
          {
            kind: 'audio',
            path: 'var/temp/job_1/narration.mp3',
            label: 'Narration',
            provider: 'deepgram',
            sourceUrl: null,
            mimeType: 'audio/mpeg',
            externalId: null,
            sceneOrder: null,
            query: null,
          },
        ],
      },
    },
    publicationResults: [],
    errorMessage: null,
    createdAt: '2026-03-18T09:59:00.000Z',
    updatedAt: '2026-03-18T10:01:00.000Z',
  };
}
