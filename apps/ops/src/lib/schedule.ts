import { CronExpressionParser } from 'cron-parser';

export const SCHEDULE_PRESETS = ['daily', 'weekdays', 'weekly', 'custom'] as const;
export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number];

export type ScheduleEditorState = {
  preset: SchedulePreset;
  hour: number;
  minute: number;
  weekday: number;
  customCron: string;
};

export const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const;

export function createScheduleEditor(scheduleCron: string): ScheduleEditorState {
  const normalized = trimCron(scheduleCron);
  const daily = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (daily) {
    return {
      preset: 'daily',
      minute: clampMinute(Number(daily[1])),
      hour: clampHour(Number(daily[2])),
      weekday: 1,
      customCron: normalized,
    };
  }

  const weekdays = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* 1-5$/);
  if (weekdays) {
    return {
      preset: 'weekdays',
      minute: clampMinute(Number(weekdays[1])),
      hour: clampHour(Number(weekdays[2])),
      weekday: 1,
      customCron: normalized,
    };
  }

  const weekly = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-7])$/);
  if (weekly) {
    return {
      preset: 'weekly',
      minute: clampMinute(Number(weekly[1])),
      hour: clampHour(Number(weekly[2])),
      weekday: normalizeWeekday(Number(weekly[3])),
      customCron: normalized,
    };
  }

  return {
    preset: 'custom',
    minute: 0,
    hour: 8,
    weekday: 1,
    customCron: normalized,
  };
}

export function buildScheduleCron(editor: ScheduleEditorState): string {
  const minute = pad2(editor.minute);
  const hour = pad2(editor.hour);

  switch (editor.preset) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`;
    case 'weekly':
      return `${minute} ${hour} * * ${normalizeWeekday(editor.weekday)}`;
    case 'custom':
      return trimCron(editor.customCron);
  }
}

export function describeSchedule(editor: ScheduleEditorState): string {
  const time = formatTime(editor.hour, editor.minute);

  switch (editor.preset) {
    case 'daily':
      return `Runs daily at ${time} local time.`;
    case 'weekdays':
      return `Runs on weekdays at ${time} local time.`;
    case 'weekly':
      return `Runs every ${weekdayLabel(editor.weekday)} at ${time} local time.`;
    case 'custom':
      return 'Runs on a custom cron schedule.';
  }
}

export function getNextScheduleRun(scheduleCron: string, from = new Date()): Date | null {
  try {
    const interval = CronExpressionParser.parse(normalizeCronForParser(scheduleCron), {
      currentDate: from,
      strict: true,
    });

    if (!interval.hasNext()) {
      return null;
    }

    return interval.next().toDate();
  } catch {
    return null;
  }
}

export function formatTime(hour: number, minute: number): string {
  return `${pad2(clampHour(hour))}:${pad2(clampMinute(minute))}`;
}

export function trimCron(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeCronForParser(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const parts = normalized.split(' ');

  return parts.length === 5 ? `0 ${normalized}` : normalized;
}

function weekdayLabel(value: number): string {
  return WEEKDAY_OPTIONS[normalizeWeekday(value)]?.label.toLowerCase() ?? 'Sunday';
}

function normalizeWeekday(value: number): number {
  if (value === 7) {
    return 0;
  }

  return Math.max(0, Math.min(6, Math.trunc(value)));
}

function clampHour(value: number): number {
  return Math.max(0, Math.min(23, Math.trunc(value)));
}

function clampMinute(value: number): number {
  return Math.max(0, Math.min(59, Math.trunc(value)));
}

function pad2(value: number): string {
  return Math.trunc(value).toString().padStart(2, '0');
}
