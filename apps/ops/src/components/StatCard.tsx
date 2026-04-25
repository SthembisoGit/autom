import React from 'react';

type StatCardProps = {
  label: string;
  value: number;
};

export function StatCard({ label, value }: StatCardProps) {
  return (
    <article className="card stat-card">
      <p className="muted">{label}</p>
      <strong className="stat-value">{value}</strong>
    </article>
  );
}
