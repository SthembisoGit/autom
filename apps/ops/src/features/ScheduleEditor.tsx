import React, { type ChangeEvent } from 'react';

import {
  SCHEDULE_PRESETS,
  type SchedulePreset,
  WEEKDAY_OPTIONS,
  buildScheduleCron,
  createScheduleEditor,
  describeSchedule,
  formatTime,
  getNextScheduleRun,
} from '../lib/schedule';

type ScheduleEditorProps = {
  scheduleCron: string;
  enabled: boolean;
  onScheduleCronChange: (value: string) => void;
  onEnabledChange: (value: boolean) => void;
};

export function ScheduleEditor({
  scheduleCron,
  enabled,
  onScheduleCronChange,
  onEnabledChange,
}: ScheduleEditorProps) {
  const editor = createScheduleEditor(scheduleCron);
  const nextRun = getNextScheduleRun(scheduleCron);

  function updatePreset(preset: SchedulePreset) {
    onScheduleCronChange(
      buildScheduleCron({
        ...editor,
        preset,
      })
    );
  }

  function updateTime(event: ChangeEvent<HTMLInputElement>) {
    const [nextHour, nextMinute] = event.target.value.split(':').map((value) => Number(value));
    onScheduleCronChange(
      buildScheduleCron({
        ...editor,
        hour: Number.isFinite(nextHour) ? nextHour : editor.hour,
        minute: Number.isFinite(nextMinute) ? nextMinute : editor.minute,
      })
    );
  }

  function updateWeekday(event: ChangeEvent<HTMLSelectElement>) {
    onScheduleCronChange(
      buildScheduleCron({
        ...editor,
        weekday: Number(event.target.value),
      })
    );
  }

  function updateCustomCron(event: ChangeEvent<HTMLInputElement>) {
    onScheduleCronChange(event.target.value);
  }

  return (
    <section className="schedule-builder">
      <div className="row-between">
        <div className="schedule-summary">
          <p className="eyebrow">Schedule</p>
          <h4>{describeSchedule(editor)}</h4>
          <p className="muted">
            Local machine time. The scheduler uses this cadence automatically.
          </p>
        </div>
        <span className={`badge ${enabled ? 'badge-connected' : 'badge-skipped'}`}>
          {enabled ? 'active' : 'paused'}
        </span>
      </div>

      <div className="detail-list detail-list-compact">
        <div>
          <dt>Next Run</dt>
          <dd>{nextRun ? nextRun.toLocaleString() : 'Unable to calculate'}</dd>
        </div>
        <div>
          <dt>Schedule source</dt>
          <dd>Preset controls or custom cron</dd>
        </div>
      </div>

      <div className="form-grid schedule-grid">
        <label>
          <span>Preset</span>
          <select
            value={editor.preset}
            onChange={(event) => updatePreset(event.target.value as SchedulePreset)}
          >
            {SCHEDULE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {formatPresetLabel(preset)}
              </option>
            ))}
          </select>
        </label>

        {editor.preset !== 'custom' ? (
          <label>
            <span>Time</span>
            <input
              type="time"
              value={formatTime(editor.hour, editor.minute)}
              onChange={updateTime}
            />
          </label>
        ) : null}

        {editor.preset === 'weekly' ? (
          <label>
            <span>Day of week</span>
            <select value={editor.weekday} onChange={updateWeekday}>
              {WEEKDAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {editor.preset === 'custom' ? (
          <details className="schedule-advanced label-wide">
            <summary>Advanced cron</summary>
            <div className="stack stack-tight">
              <label>
                <span>Cron expression</span>
                <input value={scheduleCron} onChange={updateCustomCron} placeholder="0 8 * * *" />
              </label>
              <small className="field-note">
                Use a five-field cron expression. The scheduler validates it on save.
              </small>
            </div>
          </details>
        ) : null}
      </div>

      <div className="action-row">
        <button
          className="button button-secondary"
          onClick={() => onEnabledChange(!enabled)}
          type="button"
        >
          {enabled ? 'Pause schedule' : 'Resume schedule'}
        </button>
      </div>
    </section>
  );
}

function formatPresetLabel(value: SchedulePreset): string {
  switch (value) {
    case 'daily':
      return 'Daily';
    case 'weekdays':
      return 'Weekdays';
    case 'weekly':
      return 'Weekly';
    case 'custom':
      return 'Custom cron';
  }
}
