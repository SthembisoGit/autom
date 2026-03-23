import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { DashboardSummary, JobMonitorResponse, SchedulerOverview } from '@autom/contracts';

import { apiClient } from '../api/client';
import { JobProgressStepper } from '../components/JobProgressStepper';
import { StatCard } from '../components/StatCard';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerOverview | null>(null);
  const [monitor, setMonitor] = useState<JobMonitorResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isRunningScheduler, setIsRunningScheduler] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const pushToast = useToast();
  const navigate = useNavigate();

  const load = useCallback(
    async (options?: { background?: boolean }) => {
      try {
        if (!options?.background) {
          setIsLoading(true);
        }

        const [dashboardSummary, schedulerOverview, jobMonitor] = await Promise.all([
          apiClient.getDashboard(),
          apiClient.getSchedulerOverview(),
          apiClient.getJobMonitor(),
        ]);
        setSummary(dashboardSummary);
        setScheduler(schedulerOverview);
        setMonitor(jobMonitor);
        setLoadFailed(false);
      } catch (value) {
        setLoadFailed(true);
        pushToast({
          tone: 'danger',
          title: 'Dashboard refresh failed',
          message: value instanceof Error ? value.message : 'Unable to load the dashboard.',
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

  const summaryCards = useMemo(
    () => [
      { label: 'Profiles', value: summary?.totalProfiles ?? 0 },
      { label: 'Enabled Profiles', value: summary?.enabledProfiles ?? 0 },
      { label: 'Draft Jobs', value: summary?.draftJobs ?? 0 },
      { label: 'Review Queue', value: summary?.reviewPendingJobs ?? 0 },
      { label: 'Published Jobs', value: summary?.publishedJobs ?? 0 },
    ],
    [summary]
  );

  async function handleRunScheduler() {
    try {
      setIsRunningScheduler(true);
      const [nextSchedulerState, nextMonitor] = await Promise.all([
        apiClient.runSchedulerNow(),
        apiClient.getJobMonitor(),
      ]);
      setScheduler(nextSchedulerState);
      setMonitor(nextMonitor);
      pushToast({
        tone: 'success',
        title: 'Scheduler run complete',
        message: 'The scheduler tick finished and the dashboard was refreshed.',
      });
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Scheduler run failed',
        message: value instanceof Error ? value.message : 'Unable to run the scheduler.',
      });
    } finally {
      setIsRunningScheduler(false);
    }
  }

  async function handleRetry(jobId: string) {
    try {
      setRetryingJobId(jobId);
      const retryJob = await apiClient.retryJob(jobId);
      pushToast(
        retryJob.status === 'failed'
          ? {
              tone: 'danger',
              title: 'Retry failed again',
              message: `A fresh run was created for ${retryJob.topic}, but it failed immediately.`,
            }
          : {
              tone: 'success',
              title: 'Retry started',
              message: `A fresh run was created for ${retryJob.topic}.`,
            }
      );
      navigate(`/runs/${retryJob.id}`);
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Retry failed',
        message: value instanceof Error ? value.message : 'Unable to retry the job.',
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
                message:
                  'The delivery step is still running. Review the platform messages below.',
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

  const hasValidatedLocalPublish = (summary?.publishedJobs ?? 0) > 0;
  const schedulerBadgeStatus =
    scheduler?.enabled === false
      ? 'skipped'
      : (scheduler?.activeRuns ?? 0) > 0 || (scheduler?.queuedRuns ?? 0) > 0
        ? 'running'
        : 'idle';

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>Production Snapshot</h2>
          <p className="section-subtitle muted">
            Live generation stays on the local archive path until the connected platforms are ready.
          </p>
        </div>
      </header>

      {isLoading && !summary ? (
        <StatePanel
          description="Pulling the latest profile and job counts from the control server."
          title="Loading production snapshot"
        />
      ) : loadFailed && !summary ? (
        <StatePanel
          actionLabel="Retry"
          description="Refresh the dashboard after the connection recovers."
          onAction={() => void load()}
          title="Dashboard is temporarily unavailable"
          tone="danger"
        />
      ) : (
        <div className="stack">
          {summary && Object.values(summary).every((metricValue) => metricValue === 0) ? (
            <StatePanel
              description="Profiles are configured, but no content runs have been generated yet."
              title="The system is ready for its first workload"
              tone="info"
            >
              <div className="action-bar">
                <Link className="button button-primary" to="/profiles">
                  Review profiles
                </Link>
                <Link className="button button-secondary" to="/reviews">
                  Open review queue
                </Link>
              </div>
            </StatePanel>
          ) : null}

          <article className="card">
            <div className="row-between">
              <div>
                <p className="eyebrow">Launch path</p>
                <h3>Current validation flow</h3>
                <p className="card-intro muted">
                  Keep the local archive copy available while you validate the live content flow.
                </p>
              </div>
              <span
                className={`badge ${hasValidatedLocalPublish ? 'badge-connected' : 'badge-queued'}`}
              >
                {hasValidatedLocalPublish ? 'local path verified' : 'local validation in progress'}
              </span>
            </div>

            <ol className="workflow-checklist">
              <li>Create a run with the live content providers.</li>
              <li>Approve the render package from the Review Queue.</li>
              <li>Confirm the local archive copy and history entry.</li>
              <li>Connect YouTube, then Facebook, when the accounts are ready.</li>
            </ol>

            <div className="action-bar">
              <Link className="button button-primary" to="/history">
                Review published runs
              </Link>
              <Link className="button button-secondary" to="/reviews">
                Open review queue
              </Link>
              <Link className="button button-secondary" to="/connections">
                Open connections
              </Link>
            </div>
          </article>

          <div className="grid">
            {summaryCards.map((item) => (
              <StatCard key={item.label} label={item.label} value={item.value} />
            ))}
          </div>

          <article className="card">
            <div className="row-between">
              <div>
                <p className="eyebrow">Live workflow</p>
                <h3>Job monitor</h3>
                <p className="muted">
                  Progress updates refresh automatically while generation or publishing is active.
                </p>
              </div>
            </div>

            {monitor && monitor.active.length > 0 ? (
              <div className="stack">
                {monitor.active.map((entry) => (
                  <div className="progress-card progress-card-live" key={entry.job.id}>
                    <div className="row-between">
                      <div className="stack stack-tight">
                        <Link className="job-link" to={`/runs/${entry.job.id}`}>
                          {entry.job.topic}
                        </Link>
                        <JobProgressStepper progress={entry.progress} />
                      </div>
                      <StatusBadge status={entry.job.status} />
                    </div>
                    <div className="action-bar">
                      <Link className="button button-secondary" to={`/runs/${entry.job.id}`}>
                        Open run detail
                      </Link>
                      {entry.job.status === 'review_pending' ? (
                        <Link className="button button-secondary" to="/reviews">
                          Open review queue
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No active generation or publish jobs are running right now.</p>
            )}

            {monitor && monitor.failed.length > 0 ? (
              <div className="stack">
                <h4 className="section-heading">Recent failures</h4>
                {monitor.failed.map((entry) => (
                  <div
                    className={`progress-card progress-card-danger ${
                      entry.progress.retryable ? 'progress-card-retryable' : ''
                    }`}
                    key={entry.job.id}
                  >
                    <div className="row-between">
                      <div>
                        <Link className="job-link" to={`/runs/${entry.job.id}`}>
                          {entry.job.topic}
                        </Link>
                        <p className="progress-title">{entry.progress.title}</p>
                        <p className="muted">{entry.progress.detail}</p>
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
                        Open run detail
                      </Link>
                      {entry.progress.retryable ? (
                        entry.job.reviewPackage &&
                        entry.job.publicationResults.some((result) => result.status !== 'published') ? (
                          <button
                            className="button button-primary"
                            disabled={retryingJobId === entry.job.id}
                            onClick={() =>
                              void handleRetryPublication(entry.job.id, entry.job.topic)
                            }
                            type="button"
                          >
                            {retryingJobId === entry.job.id
                              ? 'Retrying...'
                              : 'Retry publication'}
                          </button>
                        ) : (
                          <button
                            className="button button-primary"
                            disabled={retryingJobId === entry.job.id}
                            onClick={() => void handleRetry(entry.job.id)}
                            type="button"
                          >
                            {retryingJobId === entry.job.id ? 'Retrying...' : 'Retry job'}
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </article>

          <article className="card">
            <div className="row-between">
              <div>
                <p className="eyebrow">Automation</p>
                <h3>Scheduler</h3>
                <p className="muted">Poll interval: {scheduler?.pollIntervalSeconds ?? 0}s</p>
              </div>
              <StatusBadge status={schedulerBadgeStatus} />
            </div>

            <div className="grid">
              <StatCard label="Queued Runs" value={scheduler?.queuedRuns ?? 0} />
              <StatCard label="Active Runs" value={scheduler?.activeRuns ?? 0} />
              <StatCard label="Completed 24h" value={scheduler?.completedRuns24h ?? 0} />
              <StatCard label="Failed 24h" value={scheduler?.failedRuns24h ?? 0} />
            </div>

            <div className="detail-list detail-list-compact">
              <div>
                <dt>Last Tick Started</dt>
                <dd>
                  {scheduler?.lastTickStartedAt
                    ? formatDateTime(scheduler.lastTickStartedAt)
                    : 'Not recorded'}
                </dd>
              </div>
              <div>
                <dt>Last Tick Completed</dt>
                <dd>
                  {scheduler?.lastTickCompletedAt
                    ? formatDateTime(scheduler.lastTickCompletedAt)
                    : 'Not recorded'}
                </dd>
              </div>
            </div>

            <p className="muted">{describeSchedulerState(scheduler)}</p>

            <div className="action-bar">
              <button
                className="button button-primary"
                disabled={isRunningScheduler}
                onClick={() => void handleRunScheduler()}
                type="button"
              >
                {isRunningScheduler ? 'Running scheduler...' : 'Run scheduler now'}
              </button>
              <Link className="button button-secondary" to="/profiles">
                Review schedules
              </Link>
            </div>

            {scheduler && scheduler.recentRuns.length > 0 ? (
              <div className="stack">
                {scheduler.recentRuns.slice(0, 5).map((run) => (
                  <div className="row-between publication-row" key={run.id}>
                    <div>
                      <p>{run.topic}</p>
                      <p className="muted">{describeScheduledRun(run)}</p>
                    </div>
                    <StatusBadge status={run.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No scheduled runs have been recorded yet.</p>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function describeScheduledRun(run: SchedulerOverview['recentRuns'][number]) {
  if (run.status === 'completed') {
    return 'Completed and created a generation job.';
  }

  if (run.status === 'failed') {
    return 'The scheduled run failed before completing.';
  }

  return 'The scheduler is handling this run.';
}

function describeSchedulerState(scheduler: SchedulerOverview | null) {
  if (!scheduler) {
    return 'Scheduler status is not available yet.';
  }

  if (!scheduler.enabled) {
    return 'Scheduler is paused.';
  }

  if (scheduler.activeRuns > 0 || scheduler.queuedRuns > 0) {
    return 'Scheduler is processing queued runs.';
  }

  return 'Scheduler is ready for the next cadence.';
}
