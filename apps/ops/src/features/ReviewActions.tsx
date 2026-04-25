import React from 'react';

export type ReviewActionKind = 'approve' | 'reject' | 'publish';

type ReviewActionsProps = {
  jobLabel: string;
  busyAction?: ReviewActionKind | null;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onPublish?: () => Promise<void>;
  disabled?: boolean;
  confirmAction?: (message: string) => boolean;
};

export function ReviewActions({
  jobLabel,
  busyAction = null,
  onApprove,
  onReject,
  onPublish,
  disabled = false,
  confirmAction = defaultConfirmAction,
}: ReviewActionsProps) {
  const controlsDisabled = disabled || busyAction !== null;

  function runAction(action: ReviewActionKind, callback: () => Promise<void>) {
    if (controlsDisabled) {
      return;
    }

    const confirmed = confirmAction(getReviewActionConfirmation(action, jobLabel));

    if (!confirmed) {
      return;
    }

    void callback();
  }

  return (
    <div className="stack stack-tight">
      <div className="action-row">
        <button
          className="button button-primary"
          disabled={controlsDisabled}
          onClick={() => runAction('approve', onApprove)}
          type="button"
        >
          {busyAction === 'approve' ? 'Approving...' : 'Approve'}
        </button>
        <button
          className="button button-secondary"
          disabled={controlsDisabled}
          onClick={() => runAction('reject', onReject)}
          type="button"
        >
          {busyAction === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
        {onPublish ? (
          <button
            className="button button-accent"
            disabled={controlsDisabled}
            onClick={() => runAction('publish', onPublish)}
            type="button"
          >
            {busyAction === 'publish' ? 'Publishing...' : 'Publish'}
          </button>
        ) : null}
      </div>
      <p className="muted action-hint">
        {onPublish
          ? 'Publish after the review and profile settings look correct.'
          : 'Approve or reject the draft before publishing becomes available.'}
      </p>
    </div>
  );
}

export function getReviewActionConfirmation(action: ReviewActionKind, jobLabel: string) {
  const quotedJobLabel = `"${jobLabel}"`;

  switch (action) {
    case 'approve':
      return `Approve ${quotedJobLabel} and move it into the publish-ready queue?`;
    case 'reject':
      return `Reject ${quotedJobLabel}? The run will stay recorded, but publishing will remain blocked.`;
    case 'publish':
      return `Publish ${quotedJobLabel} now? This sends the approved run to its configured platforms.`;
  }
}

function defaultConfirmAction(message: string) {
  if (typeof globalThis.confirm === 'function') {
    return globalThis.confirm(message);
  }

  return true;
}
