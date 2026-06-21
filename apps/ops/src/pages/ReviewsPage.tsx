import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { GenerationJob } from '@autom/contracts';

import { apiClient } from '../api/client';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { type ReviewActionKind, ReviewActions } from '../features/ReviewActions';

async function fetchReviews(): Promise<GenerationJob[]> {
  return apiClient.listReviews();
}

export function ReviewsPage() {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyState, setBusyState] = useState<{
    jobId: string;
    action: ReviewActionKind;
  } | null>(null);
  const pushToast = useToast();

  const load = useCallback(
    async (options?: { background?: boolean }) => {
      try {
        if (!options?.background) {
          setIsLoading(true);
        }

        setJobs(await fetchReviews());
        setLoadFailed(false);
      } catch (value) {
        setLoadFailed(true);
        pushToast({
          tone: 'danger',
          title: 'Review queue refresh failed',
          message: value instanceof Error ? value.message : 'Unable to load reviews.',
        });
      } finally {
        if (!options?.background) {
          setIsLoading(false);
        }
      }
    },
    [pushToast]
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApprove(job: GenerationJob) {
    try {
      setBusyState({ jobId: job.id, action: 'approve' });
      await apiClient.approveReview(job.id, 'Approved from ops console.');
      await load({ background: true });
      pushToast({
        tone: 'success',
        title: 'Review approved',
        message: `"${job.topic}" is ready for publishing.`,
      });
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Approval failed',
        message: value instanceof Error ? value.message : 'Unable to approve the review.',
      });
    } finally {
      setBusyState(null);
    }
  }

  async function handleReject(job: GenerationJob) {
    try {
      setBusyState({ jobId: job.id, action: 'reject' });
      await apiClient.rejectReview(job.id, 'Rejected from ops console.');
      await load({ background: true });
      pushToast({
        tone: 'warning',
        title: 'Review rejected',
        message: `"${job.topic}" remains recorded and blocked from publishing.`,
      });
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Rejection failed',
        message: value instanceof Error ? value.message : 'Unable to reject the review.',
      });
    } finally {
      setBusyState(null);
    }
  }

  async function handlePublish(job: GenerationJob) {
    try {
      setBusyState({ jobId: job.id, action: 'publish' });
      await apiClient.publishJob(job.id);
      await load({ background: true });
      pushToast({
        tone: 'success',
        title: 'Publish triggered',
        message: `"${job.topic}" is moving through the publishing workflow.`,
      });
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Publish failed',
        message: value instanceof Error ? value.message : 'Unable to publish the job.',
      });
    } finally {
      setBusyState(null);
    }
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Review</p>
          <h2>Review Queue</h2>
          <p className="section-subtitle muted">
            Approve, reject, or publish runs from a single action surface.
          </p>
        </div>
      </header>

      <ReviewsContent
        busyState={busyState}
        isLoading={isLoading}
        jobs={jobs}
        loadFailed={loadFailed}
        onApprove={handleApprove}
        onPublish={handlePublish}
        onReject={handleReject}
        onRetry={() => void load()}
      />
    </section>
  );
}

type ReviewsContentProps = {
  jobs: GenerationJob[];
  isLoading: boolean;
  loadFailed: boolean;
  busyState: {
    jobId: string;
    action: ReviewActionKind;
  } | null;
  onRetry: () => void;
  onApprove: (job: GenerationJob) => Promise<void>;
  onReject: (job: GenerationJob) => Promise<void>;
  onPublish: (job: GenerationJob) => Promise<void>;
};

export function ReviewsContent({
  jobs,
  isLoading,
  loadFailed,
  busyState,
  onRetry,
  onApprove,
  onReject,
  onPublish,
}: ReviewsContentProps) {
  if (isLoading && jobs.length === 0) {
    return (
      <StatePanel
        description="Pulling the latest review-ready jobs and approval state."
        title="Loading review queue"
      />
    );
  }

  if (loadFailed && jobs.length === 0) {
    return (
      <StatePanel
        actionLabel="Retry"
        description="Refresh the queue after the connection recovers."
        onAction={onRetry}
        title="Review queue is temporarily unavailable"
        tone="danger"
      />
    );
  }

  if (jobs.length === 0) {
    return (
      <StatePanel
        description="Auto-publish is enabled. Jobs move from generation to publish without waiting in this queue."
        title="No jobs are waiting for review"
        tone="info"
      />
    );
  }

  return (
    <div className="stack">
      {jobs.map((job) => {
        const jobWarnings = job.reviewPackage?.warnings ?? [];
        const assetCount = job.reviewPackage?.assetBundle.assetReferences.length ?? 0;
        const busyAction = busyState?.jobId === job.id ? busyState.action : null;
        const isAnotherJobBusy = busyState !== null && busyState.jobId !== job.id;

        return (
          <article className="card review-card" key={job.id}>
            <div className="row-between">
              <div className="stack stack-tight">
                <div>
                  <Link className="job-link" to={`/runs/${job.id}`}>
                    {job.topic}
                  </Link>
                  <p className="muted">{job.scriptPackage?.title ?? 'Script pending'}</p>
                </div>
                <div className="review-meta-row">
                  <span className="profile-summary-chip">
                    {formatCount(job.scriptPackage?.scenes.length ?? 0, 'scene')}
                  </span>
                  <span className="profile-summary-chip">{formatCount(assetCount, 'asset')}</span>
                  <span className="profile-summary-chip">{job.status.replace(/_/g, ' ')}</span>
                </div>
              </div>
              <StatusBadge status={job.status} />
            </div>

            {jobWarnings.length > 0 ? (
              <div>
                <span className="warning-count-chip">
                  ⚠ {formatCount(jobWarnings.length, 'warning')} — review before approving
                </span>
              </div>
            ) : null}

            <ReviewActions
              busyAction={busyAction}
              disabled={job.status === 'publish_pending' || isAnotherJobBusy}
              jobLabel={job.topic}
              onApprove={() => onApprove(job)}
              onPublish={job.status === 'approved' ? () => onPublish(job) : undefined}
              onReject={() => onReject(job)}
            />
          </article>
        );
      })}
    </div>
  );
}

function formatCount(count: number, label: string) {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}
