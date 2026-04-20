import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { GenerationJob, JobMonitorResponse } from '@autom/contracts';

import { apiClient } from '../api/client';
import { JobProgressStepper } from '../components/JobProgressStepper';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';

type RunsContentProps = {
  isLoading: boolean;
  loadFailed: boolean;
  monitor: JobMonitorResponse | null;
  historyJobs: GenerationJob[];
  retryingJobId: string | null;
  onRetry: () => void;
  onRetryJob: (jobId: string) => Promise<void>;
  onRetryPublication: (jobId: string, topic: string) => Promise<void>;
};

export function RunsPage() {
  const [monitor, setMonitor] = useState<JobMonitorResponse | null>(null);
  const [historyJobs, setHistoryJobs] = useState<GenerationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const pushToast = useToast();
  const navigate = useNavigate();

  const load = useCallback(
    async (options?: { background?: boolean }) => {
      try {
        if (!options?.background) {
          setIsLoading(true);
        }

        const [jobMonitor, publishedHistory] = await Promise.all([
          apiClient.getJobMonitor(),
          apiClient.listHistory(),
        ]);
        setMonitor(jobMonitor);
        setHistoryJobs(publishedHistory);
        setLoadFailed(false);
      } catch (value) {
        setLoadFailed(true);
        pushToast({
          tone: 'danger',
          title: 'Runs refresh failed',
          message: value instanceof Error ? value.message : 'Unable to load the run monitor.',
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

  useEffect(() => {
    const timer = setInterval(() => {
      void load({ background: true });
    }, 5000);

    return () => clearInterval(timer);
  }, [load]);

  async function handleRetry(jobId: string) {
    try {
      setRetryingJobId(jobId);
      const retryJob = await apiClient.retryJob(jobId);
      pushToast({
        tone: retryJob.status === 'failed' ? 'danger' : 'success',
        title: retryJob.status === 'failed' ? 'Retry failed again' : 'Retry started',
        message:
          retryJob.status === 'failed'
            ? `A fresh run was created for ${retryJob.topic}, but it failed immediately.`
            : `A fresh run was created for ${retryJob.topic}.`,
      });
      navigate(`/runs/${retryJob.id}`);
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Retry failed',
        message: value instanceof Error ? value.message : 'Unable to retry the run.',
      });
    } finally {
      setRetryingJobId(null);
    }
  }

  async function handleRetryPublication(jobId: string, topic: string) {
    try {
      setRetryingJobId(jobId);
      const retryJob = await apiClient.publishJob(jobId);
      pushToast(
        retryJob.status === 'published'
          ? {
              tone: 'success',
              title: 'Publication retried',
              message: `"${topic}" is published successfully.`,
            }
          : retryJob.status === 'failed'
            ? {
                tone: 'danger',
                title: 'Publication retry failed',
                message:
                  retryJob.errorMessage ??
                  'The publication retry failed again. Review the platform messages below.',
              }
            : {
                tone: 'warning',
                title: 'Publication retry in progress',
                message: 'The delivery step is still running. Review the platform messages below.',
              }
      );
      await load({ background: true });
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Publication retry failed',
        message: value instanceof Error ? value.message : 'Unable to retry publication.',
      });
    } finally {
      setRetryingJobId(null);
    }
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Runs</p>
          <h2>Run Monitor</h2>
          <p className="section-subtitle muted">
            Watch active work, recover failed jobs, and review recent completed runs from one page.
          </p>
        </div>
      </header>

      <RunsContent
        historyJobs={historyJobs}
        isLoading={isLoading}
        loadFailed={loadFailed}
        monitor={monitor}
        onRetry={() => void load()}
        onRetryJob={handleRetry}
        onRetryPublication={handleRetryPublication}
        retryingJobId={retryingJobId}
      />
    </section>
  );
}

export function RunsContent({
  isLoading,
  loadFailed,
  monitor,
  historyJobs,
  retryingJobId,
  onRetry,
  onRetryJob,
  onRetryPublication,
}: RunsContentProps) {
  const recentCompleted = historyJobs.slice(0, 6);

  if (isLoading && !monitor) {
    return (
      <StatePanel
        description="Loading active workflow, recent failures, and recently completed runs."
        title="Loading run monitor"
      />
    );
  }

  if (loadFailed && !monitor) {
    return (
      <StatePanel
        actionLabel="Retry"
        description="Refresh the page after the connection recovers."
        onAction={onRetry}
        title="Run monitor is temporarily unavailable"
        tone="danger"
      />
    );
  }

  return (
    <div className="stack">
      <section className="dashboard-section">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Active</p>
            <h3>In progress</h3>
          </div>
          <span className="badge badge-info">{monitor?.active.length ?? 0}</span>
        </div>

        {monitor && monitor.active.length > 0 ? (
          <div className="stack">
            {monitor.active.map((entry) => (
              <article className="card run-row-card" key={entry.job.id}>
                <div className="row-between">
                  <div className="stack stack-tight run-row-main">
                    <div>
                      <Link className="job-link" to={`/runs/${entry.job.id}`}>
                        {entry.job.topic}
                      </Link>
                    </div>
                    <JobProgressStepper progress={entry.progress} />
                  </div>
                  <StatusBadge status={entry.job.status} />
                </div>
                <div className="action-bar">
                  <Link className="button button-secondary" to={`/runs/${entry.job.id}`}>
                    Open run
                  </Link>
                  {entry.job.status === 'review_pending' ? (
                    <Link className="button button-secondary" to="/reviews">
                      Open review
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <article className="card compact-empty-card">
            <p className="muted">No active generation or publish jobs are running right now.</p>
          </article>
        )}
      </section>

      <section className="dashboard-section">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Recovery</p>
            <h3>Failed and retryable</h3>
          </div>
          <span className="badge badge-warning">{monitor?.failed.length ?? 0}</span>
        </div>

        {monitor && monitor.failed.length > 0 ? (
          <div className="stack">
            {monitor.failed.map((entry) => (
              <article className="card alert-card alert-card-danger run-row-card" key={entry.job.id}>
                <div className="row-between">
                  <div className="stack stack-tight run-row-main">
                    <div>
                      <Link className="job-link" to={`/runs/${entry.job.id}`}>
                        {entry.job.topic}
                      </Link>
                      <p className="progress-title">{entry.progress.title}</p>
                      <p className="muted">{entry.progress.detail}</p>
                    </div>
                    {entry.progress.retryable ? (
                      <div className="monitor-status">
                        <span
                          className="monitor-status-dot monitor-status-dot-warning"
                          aria-hidden="true"
                        />
                        <span>Retry available</span>
                      </div>
                    ) : null}
                  </div>
                  <StatusBadge status={entry.job.status} />
                </div>
                <div className="action-bar">
                  <Link className="button button-secondary" to={`/runs/${entry.job.id}`}>
                    Open run
                  </Link>
                  {entry.progress.retryable ? (
                    entry.job.reviewPackage &&
                    entry.job.publicationResults.some((result) => result.status !== 'published') ? (
                      <button
                        className="button button-primary"
                        disabled={retryingJobId === entry.job.id}
                        onClick={() => void onRetryPublication(entry.job.id, entry.job.topic)}
                        type="button"
                      >
                        {retryingJobId === entry.job.id ? 'Retrying...' : 'Retry publication'}
                      </button>
                    ) : (
                      <button
                        className="button button-primary"
                        disabled={retryingJobId === entry.job.id}
                        onClick={() => void onRetryJob(entry.job.id)}
                        type="button"
                      >
                        {retryingJobId === entry.job.id ? 'Retrying...' : 'Retry job'}
                      </button>
                    )
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <article className="card compact-empty-card">
            <p className="muted">No failed runs need attention right now.</p>
          </article>
        )}
      </section>

      <section className="dashboard-section">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Completed</p>
            <h3>Recently delivered</h3>
          </div>
          <Link className="button button-secondary" to="/history">
            Open history
          </Link>
        </div>

        {recentCompleted.length > 0 ? (
          <div className="stack">
            {recentCompleted.map((job) => (
              <article className="card run-summary-row" key={job.id}>
                <div className="row-between">
                  <div className="stack stack-tight run-row-main">
                    <div>
                      <Link className="job-link" to={`/runs/${job.id}`}>
                        {job.topic}
                      </Link>
                      <p className="muted">
                        {job.publicationResults.length > 0
                          ? `${job.publicationResults.length} publication result${
                              job.publicationResults.length === 1 ? '' : 's'
                            }`
                          : 'No publication results recorded.'}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={job.status === 'publish_pending' ? 'published' : job.status} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <article className="card compact-empty-card">
            <p className="muted">Completed runs will appear here after the first publish finishes.</p>
          </article>
        )}
      </section>
    </div>
  );
}
