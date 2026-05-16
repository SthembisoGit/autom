import React from 'react';

const LABEL_MAP: Record<string, string> = {
  drafting:                   'Drafting',
  review_pending:             'Needs review',
  approved:                   'Approved',
  publish_pending:            'Publishing…',
  published:                  'Published',
  failed:                     'Failed',
  cancelled:                  'Cancelled',
  cancelling:                 'Cancelling…',
  queued:                     'Queued',
  running:                    'Running',
  completed:                  'Completed',
  idle:                       'Idle',
  skipped:                    'Skipped',
  retry_scheduled:            'Retry scheduled',
  retryable:                  'Retryable',
  connected:                  'Connected',
  disconnected:               'Disconnected',
  expired:                    'Expired',
  not_configured:             'Not configured',
  pending_configuration:      'Pending setup',
  pending_processing:         'Processing',
  waiting_for_manual_clip:    'Awaiting clip',
  uploaded:                   'Uploaded',
  audio:                      'Audio',
  video:                      'Video',
  subtitle:                   'Subtitle',
  metadata:                   'Metadata',
  info:                       'Info',
};

type StatusBadgeProps = { status: string };

export function StatusBadge({ status }: StatusBadgeProps) {
  const key = status.replace(/-/g, '_');
  const label = LABEL_MAP[key] ?? status.replace(/_/g, ' ');
  const className = `badge badge-${status.replace(/_/g, '-')}`;
  return <span className={className}>{label}</span>;
}
