import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { DashboardSummary, JobMonitorResponse, SchedulerOverview } from '@autom/contracts';

import { apiClient } from '../api/client';
import { StatCard } from '../components/StatCard';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';

const FAILURE_PREVIEW_LIMIT = 3;

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerOverview | null>(null);
  const [monitor, setMonitor] = useState<JobMonitorResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isRunningScheduler, setIsRunningScheduler] = useState(false);
  const pushToast = useToast();

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
      { label: 'Enabled', value: summary?.enabledProfiles ?? 0 },
      { label: 'Drafting', value: summary?.draftJobs ?? 0 },
      { label: 'Pending review', value: summary?.reviewPendingJobs ?? 0 },
      { label: 'Published', value: summary?.publishedJobs ?? 0 },
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
        message: 'The scheduler tick finished and the overview was refreshed.',
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
            See what needs attention now, where active work stands, and what the scheduler is about
            to do next.
          </p>
        </div>
      </header>

      <DashboardContent
        isLoading={isLoading}
        isRunningScheduler={isRunningScheduler}
        loadFailed={loadFailed}
        monitor={monitor}
        onRetry={() => void load()}
        onRunScheduler={handleRunScheduler}
        scheduler={scheduler}
        schedulerBadgeStatus={schedulerBadgeStatus}
        summary={summary}
        summaryCards={summaryCards}
      />
    </section>
  );
}

type DashboardContentProps = {
  summary: DashboardSummary | null;
  scheduler: SchedulerOverview | null;
  monitor: JobMonitorResponse | null;
  isLoading: boolean;
  loadFailed: boolean;
  isRunningScheduler: boolean;
  schedulerBadgeStatus: string;
  summaryCards: Array<{ label: string; value: number }>;
  onRetry: () => void;
  onRunScheduler: () => Promise<void>;
};

export function DashboardContent({
  summary,
  scheduler,
  monitor,
  isLoading,
  loadFailed,
  isRunningScheduler,
  schedulerBadgeStatus,
  summaryCards,
  onRetry,
  onRunScheduler,
}: DashboardContentProps) {
  if (isLoading && !summary) {
    return (
      <StatePanel
        description="Pulling the latest run counts, queue health, and scheduler status."
        title="Loading overview"
      />
    );
  }

  if (loadFailed && !summary) {
    return (
      <StatePanel
        actionLabel="Retry"
        description="Refresh the overview after the connection recovers."
        onAction={onRetry}
        title="Overview is temporarily unavailable"
        tone="danger"
      />
    );
  }

  return (
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
            <Link className="button button-secondary" to="/connections">
              Check connections
            </Link>
          </div>
        </StatePanel>
      ) : null}

      <section className="dashboard-section">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Snapshot</p>
            <h3>Key metrics</h3>
          </div>
        </div>
        <div className="grid">
          {summaryCards.map((item) => (
            <StatCard key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </section>

      <div className="dashboard-grid">
        <article className="card summary-card">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Attention</p>
              <h3>Urgent next actions</h3>
              <p className="card-intro muted">
                Keep the overview short. Handle retries and approvals from their dedicated pages.
              </p>
            </div>
          </div>

          <div className="stack stack-tight">
            <div className="summary-row">
              <div>
                <p className="summary-row-title">Pending review</p>
                <p className="muted">
                  {summary?.reviewPendingJobs
                    ? `${summary.reviewPendingJobs} run(s) are waiting for operator approval.`
                    : 'No runs are waiting in the review queue.'}
                </p>
              </div>
              <Link className="button button-secondary" to="/reviews">
                Open review
              </Link>
            </div>

            <div className="summary-row">
              <div>
                <p className="summary-row-title">Failures</p>
                <p className="muted">
                  {(monitor?.failed.length ?? 0) > 0
                    ? `${monitor?.failed.length ?? 0} run(s) need recovery or inspection.`
                    : 'No failed runs need attention right now.'}
                </p>
              </div>
              <Link className="button button-secondary" to="/runs">
                Open runs
              </Link>
            </div>

            {(monitor?.failed.length ?? 0) > 0 ? (
              <div className="stack stack-tight">
                {monitor?.failed.slice(0, FAILURE_PREVIEW_LIMIT).map((entry) => (
                  <div className="compact-status-row" key={entry.job.id}>
                    <div className="compact-status-copy">
                      <Link className="job-link" to={`/runs/${entry.job.id}`}>
                        {entry.job.topic}
                      </Link>
                      <p className="muted">{entry.progress.title}</p>
                    </div>
                    <StatusBadge status={entry.job.status} />
                  </div>
                ))}
                {(monitor?.failed.length ?? 0) > FAILURE_PREVIEW_LIMIT ? (
                  <p className="muted">
                    Showing {FAILURE_PREVIEW_LIMIT} of {monitor?.failed.length ?? 0} failures.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </article>

        <article className="card summary-card">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Workflow</p>
              <h3>Active status</h3>
              <p className="card-intro muted">
                Active generation and publishing stays visible here without taking over the page.
              </p>
            </div>
          </div>

          {(monitor?.active.length ?? 0) > 0 ? (
            <div className="stack stack-tight">
              {monitor?.active.slice(0, 2).map((entry) => (
                <div className="compact-progress-card" key={entry.job.id}>
                  <div className="row-between">
                    <Link className="job-link" to={`/runs/${entry.job.id}`}>
                      {entry.job.topic}
                    </Link>
                    <StatusBadge status={entry.job.status} />
                  </div>
                  <p className="muted">{entry.progress.title}</p>
                </div>
              ))}
              <div className="action-bar">
                <Link className="button button-primary" to="/runs">
                  Open run monitor
                </Link>
              </div>
            </div>
          ) : (
            <div className="stack stack-tight">
              <p className="muted">No active generation or publish jobs are running right now.</p>
              <div className="action-bar">
                <Link className="button button-secondary" to="/runs">
                  Open run monitor
                </Link>
              </div>
            </div>
          )}
        </article>
      </div>

      <article className="card summary-card">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Automation</p>
            <h3>Scheduler summary</h3>
            <p className="card-intro muted">
              Review cadence health, run the scheduler manually, and open profiles if schedules
              need changes.
            </p>
          </div>
          <StatusBadge status={schedulerBadgeStatus} />
        </div>

        <div className="grid">
          <StatCard label="Queued runs" value={scheduler?.queuedRuns ?? 0} />
          <StatCard label="Active runs" value={scheduler?.activeRuns ?? 0} />
          <StatCard label="Completed 24h" value={scheduler?.completedRuns24h ?? 0} />
          <StatCard label="Failed 24h" value={scheduler?.failedRuns24h ?? 0} />
        </div>

        <div className="detail-list detail-list-compact">
          <div>
            <dt>Poll interval</dt>
            <dd>{scheduler?.pollIntervalSeconds ?? 0}s</dd>
          </div>
          <div>
            <dt>Last tick started</dt>
            <dd>
              {scheduler?.lastTickStartedAt ? formatDateTime(scheduler.lastTickStartedAt) : 'Not recorded'}
            </dd>
          </div>
          <div>
            <dt>Last tick completed</dt>
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
            onClick={() => void onRunScheduler()}
            type="button"
          >
            {isRunningScheduler ? 'Running scheduler...' : 'Run scheduler now'}
          </button>
          <Link className="button button-secondary" to="/profiles">
            Review schedules
          </Link>
        </div>
      </article>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function describeSchedulerState(scheduler: SchedulerOverview | null) {
  if (!scheduler) {
    return 'Scheduler status is not available yet.';
  }

  if (!scheduler.enabled) {
    return 'Scheduler is paused.';
  }

  if (scheduler.activeRuns > 0 || scheduler.queuedRuns > 0) {
    return 'Scheduler is currently processing the next batch of scheduled work.';
  }

  return 'Scheduler is idle and ready for the next cadence.';
}
