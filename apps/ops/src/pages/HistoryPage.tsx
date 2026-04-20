import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { GenerationJob } from '@autom/contracts';

import { apiClient } from '../api/client';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { formatPlatformLabel } from '../lib/platforms';

export function HistoryPage() {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const pushToast = useToast();

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setJobs(await apiClient.listHistory());
      setLoadFailed(false);
    } catch (value) {
      setLoadFailed(true);
      pushToast({
        tone: 'danger',
        title: 'History refresh failed',
        message: value instanceof Error ? value.message : 'Unable to load publishing history.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">History</p>
          <h2>Publishing History</h2>
          <p className="section-subtitle muted">
            Confirm what was published before you move to the next delivery target.
          </p>
        </div>
      </header>

      {isLoading && jobs.length === 0 ? (
        <StatePanel
          description="Loading platform outcomes, publication identifiers, and delivery history."
          title="Loading history"
        />
      ) : loadFailed && jobs.length === 0 ? (
        <StatePanel
          actionLabel="Retry"
          description="Refresh the page after the connection recovers."
          onAction={() => void load()}
          title="Publishing history is temporarily unavailable"
          tone="danger"
        />
      ) : jobs.length === 0 ? (
        <StatePanel
          description="Published runs will appear here once platform delivery is enabled."
          title="No publication history yet"
          tone="info"
        />
      ) : (
        <div className="stack">
          {jobs.map((job) => {
            const isPublicationSettled =
              job.status === 'publish_pending' &&
              !job.publicationResults.some((result) => result.status === 'pending_processing');
            const displayStatus = isPublicationSettled
              ? job.publicationResults.some((result) => result.status === 'failed')
                ? 'failed'
                : 'published'
              : job.status;

            return (
              <article className="card history-card" key={job.id}>
                <div className="row-between">
                  <div className="stack stack-tight history-main">
                    <div>
                      <Link className="job-link" to={`/runs/${job.id}`}>
                        {job.topic}
                      </Link>
                      <p className="muted">
                        {job.publicationResults
                          .map((result) => formatPlatformLabel(result.platform))
                          .join(', ')}
                      </p>
                      {hasPublishedLocalResult(job) ? (
                        <p className="muted">Local Archive validation is complete for this run.</p>
                      ) : null}
                    </div>
                    <div className="stack stack-tight">
                      {job.publicationResults.map((result) => (
                        <div
                          className="row-between publication-row publication-row-compact"
                          key={`${job.id}-${result.platform}`}
                        >
                          <div>
                            <p>{formatPlatformLabel(result.platform)}</p>
                            <p className="muted">{describePublicationResult(result)}</p>
                          </div>
                          <StatusBadge status={result.status} />
                        </div>
                      ))}
                    </div>
                    <div className="action-bar">
                      <Link className="button button-primary" to={`/runs/${job.id}`}>
                        Open run detail
                      </Link>
                      <a
                        className="button button-secondary"
                        href={apiClient.getRenderArtifactUrl(job.id, 'video')}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Watch rendered video
                      </a>
                      {hasPublishedLocalResult(job) ? (
                        <a
                          className="button button-secondary"
                          href={apiClient.getLocalPublicationArtifactUrl(job.id, 'video')}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Watch Local Archive copy
                        </a>
                      ) : null}
                      {hasPublishedLocalResult(job) ? (
                        <a
                          className="button button-secondary"
                          download="publication.json"
                          href={apiClient.getLocalPublicationArtifactUrl(job.id, 'manifest')}
                        >
                          Download manifest
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <StatusBadge status={displayStatus} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function hasPublishedLocalResult(job: GenerationJob) {
  return job.publicationResults.some(
    (result) => result.platform === 'local' && result.status === 'published'
  );
}

function describePublicationResult(result: GenerationJob['publicationResults'][number]) {
  if (result.status === 'published') {
    return result.message ?? `${formatPlatformLabel(result.platform)} delivery is complete.`;
  }

  if (result.status === 'failed') {
    return result.message
      ? `${formatPlatformLabel(result.platform)} delivery failed: ${result.message}`
      : `${formatPlatformLabel(result.platform)} delivery failed.`;
  }

  if (result.status === 'pending_processing') {
    return result.message
      ? `${formatPlatformLabel(result.platform)} delivery is still processing: ${result.message}`
      : `${formatPlatformLabel(result.platform)} delivery is still processing.`;
  }

  if (result.status === 'pending_configuration') {
    return result.message
      ? `${formatPlatformLabel(result.platform)} delivery is waiting on configuration: ${result.message}`
      : `${formatPlatformLabel(result.platform)} delivery is waiting on configuration.`;
  }

  return result.message ?? 'Waiting for delivery status.';
}
