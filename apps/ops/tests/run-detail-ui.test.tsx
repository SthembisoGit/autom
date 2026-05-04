import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import type { GenerationJob, JobDetailResponse } from '@autom/contracts';

import { RunDetailContent } from '../src/pages/RunDetailPage';

test('RunDetailContent renders a loading state before detail data arrives', () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <RunDetailContent detail={null} isLoading loadFailed={false} onRetry={() => {}} />
    </MemoryRouter>
  );

  assert.match(markup, /Loading run detail/i);
  assert.match(markup, /render outputs, and delivery status/i);
});

test('RunDetailContent renders render outputs, warnings, and asset provenance', () => {
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <RunDetailContent
        detail={createRunDetail()}
        isLoading={false}
        loadFailed={false}
        onRetry={() => {}}
      />
    </MemoryRouter>
  );

  assert.match(markup, /Render Outputs/i);
  assert.match(markup, /Live Progress/i);
  assert.match(markup, /Ready for review/i);
  assert.match(markup, /Local validation is complete/i);
  assert.match(markup, /Open connections/i);
  assert.match(markup, /Open rendered video/i);
  assert.match(markup, /artifacts\/render\/video/i);
  assert.match(markup, /thumbnail\.jpg/i);
  assert.match(markup, /Local Archive Copy/i);
  assert.match(markup, /Review warnings/i);
  assert.match(markup, /Provider/i);
  assert.match(markup, /Scene/i);
  assert.match(markup, /Publication Results/i);
  assert.match(markup, /YouTube/i);
  assert.match(markup, /Local Archive/i);
  assert.match(markup, /Local artifact/i);
});

function createRunDetail(): JobDetailResponse {
  return {
    job: {
      id: 'job_42',
      profileId: 'profile_2',
      topic: 'Professional automation checklist',
      status: 'published',
      scriptPackage: {
        id: 'script_42',
        title: 'Automation checklist',
        description: 'Checklist description.',
        tags: ['automation'],
        scenes: [
          {
            order: 1,
            text: 'Define your operator checkpoints.',
            visualQuery: 'planning board',
            durationSeconds: 6,
          },
        ],
        totalDurationSeconds: 6,
      },
      scriptMetadata: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        promptVersion: 'v2',
        mode: 'live',
        attemptCount: 2,
        repaired: true,
      },
      reviewPackage: {
        summary: 'Approved render package.',
        warnings: ['Double-check platform hashtags before posting.'],
        generatedAt: '2026-03-18T12:00:00.000Z',
        renderBundle: {
          outputVideoPath: 'var/output/job_42/preview.mp4',
          subtitlesPath: 'var/output/job_42/subtitles.srt',
          thumbnailPath: 'var/output/job_42/thumbnail.jpg',
          durationSeconds: 30,
          renderedDurationSeconds: 32,
          narrationDurationSeconds: 32,
          subtitleCueCount: 8,
          subtitleTimingSource: 'voice_timeline',
        },
        assetBundle: {
          selectedVisualQueries: ['planning board'],
          assetReferences: [
            {
              kind: 'video',
              path: 'var/temp/job_42/clip-1.mp4',
              label: 'Planning footage',
              provider: 'pexels',
              sourceUrl: 'https://example.com/footage',
              mimeType: 'video/mp4',
              externalId: 'pexels_42',
              sceneOrder: 1,
              query: 'planning board',
            },
            {
              kind: 'metadata',
              path: 'var/temp/job_42/narration.json',
              label: 'Narration metadata',
              provider: 'deepgram',
              sourceUrl: null,
              mimeType: 'application/json',
              externalId: null,
              sceneOrder: null,
              query: null,
            },
          ],
        },
      },
      manualClipBundle: null,
      publicationResults: [
        {
          platform: 'local',
          status: 'published',
          externalId: 'local_job_42',
          publishedAt: '2026-03-18T12:09:00.000Z',
          message: 'Archived to Local Archive for in-app testing.',
          connectorMode: 'live',
        },
        {
          platform: 'youtube',
          status: 'published',
          externalId: 'yt_123',
          publishedAt: '2026-03-18T12:10:00.000Z',
          message: 'Upload complete.',
          connectorMode: 'live',
        },
      ],
      errorMessage: null,
      archivedAt: null,
      archivedReason: null,
      createdAt: '2026-03-18T11:55:00.000Z',
      updatedAt: '2026-03-18T12:11:00.000Z',
    },
    audit: [
      {
        id: 'audit_1',
        jobId: 'job_42',
        level: 'info',
        message: 'Render bundle persisted.',
        createdAt: '2026-03-18T12:01:00.000Z',
      },
    ],
    progress: {
      stage: 'ready_for_review',
      title: 'Ready for review',
      detail: 'The preview video, captions, and asset bundle are ready for operator review.',
      tone: 'success',
      isTerminal: false,
      updatedAt: '2026-03-18T12:00:00.000Z',
    },
  };
}
