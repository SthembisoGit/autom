import React from 'react';

type StatCardProps = {
  label: string;
  value: number;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  suffix?: string;
};

const TONE_STYLES: Record<NonNullable<StatCardProps['tone']>, React.CSSProperties> = {
  default: {},
  danger:  { color: 'var(--danger)' },
  warning: { color: 'var(--warning)' },
  success: { color: 'var(--success)' },
};

export function StatCard({ label, value, tone = 'default', suffix }: StatCardProps) {
  const valueStyle: React.CSSProperties = {
    ...TONE_STYLES[tone],
    display: 'block',
    marginTop: 8,
    fontSize: '2rem',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  };

  return (
    <article className="card stat-card">
      <p className="muted" style={{ margin: 0, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {label}
      </p>
      <strong style={valueStyle}>
        {value}
        {suffix ? <span style={{ fontSize: '0.9rem', fontWeight: 400, marginLeft: 2 }}>{suffix}</span> : null}
      </strong>
    </article>
  );
}
