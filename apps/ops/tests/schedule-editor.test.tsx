import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ScheduleEditor } from '../src/features/ScheduleEditor';
import {
  buildScheduleCron,
  createScheduleEditor,
  describeSchedule,
  getNextScheduleRun,
} from '../src/lib/schedule';

test('schedule helpers round-trip preset schedules and preview the next run', () => {
  const editor = createScheduleEditor('0 8 * * *');

  assert.equal(editor.preset, 'daily');
  assert.equal(describeSchedule(editor), 'Runs daily at 08:00 local time.');
  assert.equal(buildScheduleCron({ ...editor, hour: 9, minute: 30 }), '30 09 * * *');

  const nextRun = getNextScheduleRun('0 8 * * *', new Date('2026-03-22T06:00:00.000Z'));
  assert.ok(nextRun);
  assert.equal(nextRun instanceof Date, true);
  assert.equal(nextRun?.getTime() > new Date('2026-03-22T06:00:00.000Z').getTime(), true);
});

test('ScheduleEditor renders a preset-first scheduling panel', () => {
  const markup = renderToStaticMarkup(
    <ScheduleEditor
      enabled={true}
      onEnabledChange={() => {}}
      onScheduleCronChange={() => {}}
      scheduleCron="0 8 * * *"
    />
  );

  assert.match(markup, /Daily at 08:00 local time/i);
  assert.match(markup, /Next Run/i);
  assert.match(markup, /Pause schedule/i);
  assert.match(markup, /Schedule source/i);
});
