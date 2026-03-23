import type { ReactNode } from 'react';

import type { NoticeTone } from './NoticeBanner';

type StatePanelProps = {
  title: string;
  description: string;
  tone?: NoticeTone;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
};

export function StatePanel({
  title,
  description,
  tone = 'neutral',
  actionLabel,
  onAction,
  children,
}: StatePanelProps) {
  return (
    <article className={`card state-panel state-panel-${tone}`}>
      <p className="eyebrow">Status</p>
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {children ? <div className="stack stack-tight">{children}</div> : null}
      {actionLabel && onAction ? (
        <div className="action-row">
          <button className="button button-primary" onClick={onAction} type="button">
            {actionLabel}
          </button>
        </div>
      ) : null}
    </article>
  );
}
