import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { JobDetailResponse } from '@autom/contracts';

import { apiClient } from '../api/client';
import { JobProgressStepper } from '../components/JobProgressStepper';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { type ToastInput, useToast } from '../components/Toast';
import { formatPlatformLabel } from '../lib/platforms';


const CRITICAL_WARNING_CODES = new Set([
  'VISUAL_EXACT_NOT_FOUND',
  'VISUAL_NO_CANDIDATE',
  'RENDER_TIMEOUT',
  'RENDER_FAILED',
]);

function isCriticalWarning(warning: string): boolean {
  const match = warning.match(/^\[([A-Z0-9_]+)\]/);
  return match ? CRITICAL_WARNING_CODES.has(match[1] ?? '') : false;
}

function WarningTriage({ warnings }: { warnings: string[] }) {
  const [showAll, setShowAll] = React.useState(false);
  const critical = warnings.filter(isCriticalWarning);
  const info = warnings.filter((w) => !isCriticalWarning(w));

  return (
    <article className="card">
      <div className="row-between">
        <div>
          <h3>Review warnings</h3>
          <p className="muted">Check these items before approving the run.</p>
        </div>
        <span className="badge badge-warning">{warnings.length}</span>
      </div>

      {critical.length > 0 ? (
        <div className="stack stack-tight">
          <p className="warning-triage-label warning-triage-label--critical">
            {critical.length} critical — resolve before approving
          </p>
          {critical.map((w) => (
            <div className="warning-row warning-row--critical" key={w}>
              <span className="warning-row-icon" aria-hidden="true">!</span>
              <p className="warning-row-text">{w}</p>
            </div>
          ))}
        </div>
      ) : null}

      {info.length > 0 ? (
        <div className="stack stack-tight">
          {critical.length > 0 ? (
            <p className="warning-triage-label">{info.length} informational</p>
          ) : null}
          {(showAll ? info : info.slice(0, 3)).map((w) => (
            <div className="warning-row" key={w}>
              <span className="muted">{w}</span>
            </div>
          ))}
          {info.length > 3 && !showAll ? (
            <button
              className="button button-ghost"
              onClick={() => setShowAll(true)}
              type="button"
            >
              Show {info.length - 3} more
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function RunDetailPage() {
  const { jobId = '' } = useParams();
  const [detail, setDetail] = useState<JobDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const pushToast = useToast();
  const navigate = useNavigate();

  const load = useCallback(
    async (options?: { background?: boolean }) => {
      try {
        if (!options?.background) {
          setIsLoading(true);
        }

        setDetail(await apiClient.getJob(jobId));
        setLoadFailed(false);
      } catch (value) {
        setLoadFailed(true);
        pushToast({
          tone: 'danger',
          title: 'Run detail refresh failed',
          message: value instanceof Error ? value.message : 'Unable to load the run detail.',
        });
      } finally {
        if (!options?.background) {
          setIsLoading(false);
        }
      }
    },
    [jobId, pushToast]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail || !shouldPollJob(detail.job)) {
      return;
    }

    const timer = setInterval(() => {
      void load({ background: true });
    }, 4000);

    return () => clearInterval(timer);
  }, [detail, load]);

  async function handleRetry() {
    if (!detail) {
      return;
    }

    try {
      setRetrying(true);
      const retryJob = await apiClient.retryJob(detail.job.id);
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
        message: value instanceof Error ? value.message : 'Unable to retry the run.',
      });
    } finally {
      setRetrying(false);
    }
  }

  async function handleRetryPublication() {
    if (!detail) {
      return;
    }

    try {
      setRetrying(true);
      const retryJob = await apiClient.publishJob(detail.job.id);
      pushToast(
        retryJob.status === 'published'
          ? {
              tone: 'success',
              title: 'Publication retried',
              message: `"${retryJob.topic}" is published successfully.`,
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
      setRetrying(false);
    }
  }

  async function handleCancel() {
    if (!detail) {
      return;
    }

    if (
      !confirmAction(
        `Cancel "${detail.job.topic}"?\n\nThis stops the run after the current safe step.`
      )
    ) {
      return;
    }

    try {
      setIsCancelling(true);
      const updatedJob = await apiClient.cancelJob(detail.job.id);
      pushToast({
        tone: 'warning',
        title: updatedJob.status === 'cancelled' ? 'Run cancelled' : 'Cancellation requested',
        message:
          updatedJob.status === 'cancelled'
            ? `"${detail.job.topic}" was cancelled.`
            : `"${detail.job.topic}" will stop after the current safe step.`,
      });
      await load({ background: true });
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Cancel failed',
        message: value instanceof Error ? value.message : 'Unable to cancel the run.',
      });
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleArchive() {
    if (!detail) {
      return;
    }

    if (
      !confirmAction(
        `Delete "${detail.job.topic}" from the normal lists?\n\nThis keeps the records and files, but removes the run from the main ops views.`
      )
    ) {
      return;
    }

    try {
      setIsArchiving(true);
      await apiClient.archiveJob(detail.job.id);
      pushToast({
        tone: 'success',
        title: 'Run removed from list',
        message: `"${detail.job.topic}" is now hidden from the normal ops views.`,
      });
      navigate('/runs');
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Delete failed',
        message: value instanceof Error ? value.message : 'Unable to remove the run from the list.',
      });
    } finally {
      setIsArchiving(false);
    }
  }

  const effectiveStatus = detail
    ? detail.job.status === 'publish_pending' && !shouldPollJob(detail.job)
      ? detail.progress.stage === 'published'
        ? 'published'
        : 'failed'
      : detail.job.status
    : null;

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Run Detail</p>
          <h2>{detail?.job.topic ?? 'Job'}</h2>
          <p className="section-subtitle muted">
            Review the render outputs, confirm the local archive copy, and keep technical details
            tucked away unless you need them.
          </p>
        </div>
        {effectiveStatus ? <StatusBadge status={effectiveStatus} /> : null}
      </header>

      <RunDetailContent
        detail={detail}
        isLoading={isLoading}
        loadFailed={loadFailed}
        onRetryJob={handleRetry}
        onRetryPublication={handleRetryPublication}
        onCancelJob={handleCancel}
        onArchiveJob={handleArchive}
        retrying={retrying}
        cancelling={isCancelling}
        archiving={isArchiving}
        onRefreshBackground={() => load({ background: true })}
        onRetry={() => void load()}
        pushToast={pushToast}
      />
    </section>
  );
}

type RunDetailContentProps = {
  detail: JobDetailResponse | null;
  isLoading: boolean;
  loadFailed: boolean;
  onRetryJob?: () => Promise<void>;
  onRetryPublication?: () => Promise<void>;
  onCancelJob?: () => Promise<void>;
  onArchiveJob?: () => Promise<void>;
  retrying?: boolean;
  cancelling?: boolean;
  archiving?: boolean;
  onRefreshBackground?: () => Promise<void>;
  onRetry: () => void;
  pushToast?: (toast: ToastInput) => void;
};

export function RunDetailContent({
  detail,
  isLoading,
  loadFailed,
  onRetryJob = async () => {},
  onRetryPublication = async () => {},
  onCancelJob = async () => {},
  onArchiveJob = async () => {},
  retrying = false,
  cancelling = false,
  archiving = false,
  onRefreshBackground = async () => {},
  onRetry,
  pushToast = () => {},
}: RunDetailContentProps) {
  if (isLoading && !detail) {
    return (
      <StatePanel
        description="Loading the job trace, render outputs, and delivery status."
        title="Loading run detail"
      />
    );
  }

  if (loadFailed && !detail) {
    return (
      <StatePanel
        actionLabel="Retry"
        description="Refresh the page after the connection recovers."
        onAction={onRetry}
        title="Run detail is temporarily unavailable"
        tone="danger"
      />
    );
  }

  if (!detail) {
    return (
      <StatePanel
        description="This run does not exist in the current database."
        title="Run not found"
        tone="warning"
      />
    );
  }

  const warnings = detail.job.reviewPackage?.warnings ?? [];
  const assetReferences = detail.job.reviewPackage?.assetBundle.assetReferences ?? [];
  const publicationResults = detail.job.publicationResults;
  const isPublicationSettled =
    detail.job.status === 'publish_pending' && !shouldPollJob(detail.job);
  const effectiveStatus = isPublicationSettled
    ? detail.progress.stage === 'published'
      ? 'published'
      : 'failed'
    : detail.job.status;
  const hasPublicationFailure = publicationResults.some((result) => result.status === 'failed');
  const canRetryPublication =
    detail.job.reviewPackage !== null &&
    publicationResults.length > 0 &&
    hasPublicationFailure &&
    detail.progress.retryable;
  const hasLocalPublication = publicationResults.some(
    (result) => result.platform === 'local' && result.status === 'published'
  );
  const renderThumbnailPath = detail.job.reviewPackage?.renderBundle.thumbnailPath ?? null;
  const dialogueSpeakerNames = detail.job.reviewPackage?.renderBundle.dialogueSpeakerNames ?? [];
  const sceneVisualOutcomes = detail.job.reviewPackage?.renderBundle.sceneVisualOutcomes ?? [];
  const canCancel =
    detail.job.status === 'drafting' ||
    detail.job.status === 'cancelling' ||
    detail.job.status === 'publish_pending';
  const canArchive =
    !detail.job.archivedAt && ['failed', 'published', 'cancelled'].includes(detail.job.status);

  return (
    <div className="stack">
      <article className={`card progress-card progress-card-${detail.progress.tone}`}>
        <div className="row-between">
          <JobProgressStepper progress={detail.progress} />
          <StatusBadge status={effectiveStatus} />
        </div>
        <dl className="detail-list detail-list-compact">
          <div>
            <dt>Workflow state</dt>
            <dd>{detail.progress.stage.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>
              {detail.progress.updatedAt ? formatDateTime(detail.progress.updatedAt) : 'Unknown'}
            </dd>
          </div>
        </dl>
      </article>

      <article className="card summary-card">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Run summary</p>
            <h3>What matters first</h3>
            <p className="card-intro muted">
              Open the render, check the warning state, and move to review or recovery from here.
            </p>
          </div>
        </div>
        <div className="detail-list detail-list-compact">
          <div>
            <dt>Review state</dt>
            <dd>{detail.job.status.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt>Scenes</dt>
            <dd>{detail.job.scriptPackage?.scenes.length ?? 0}</dd>
          </div>
          <div>
            <dt>Warnings</dt>
            <dd>{warnings.length}</dd>
          </div>
          {detail.job.scriptPackage?.nextVideoSuggestion ? (
            <div>
              <dt>Watch next</dt>
              <dd>
                <span className="next-video-chip">
                  <span className="next-video-chip-label">→</span>
                  {detail.job.scriptPackage.nextVideoSuggestion}
                </span>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Assets</dt>
            <dd>{assetReferences.length}</dd>
          </div>
          <div>
            <dt>Background bed</dt>
            <dd>
              {detail.job.reviewPackage?.renderBundle.backgroundAudioPresent ? 'Present' : 'None'}
            </dd>
          </div>
        </div>
        <div className="action-bar">
          {detail.job.reviewPackage ? (
            <a
              className="button button-primary"
              href={apiClient.getRenderArtifactUrl(detail.job.id, 'video')}
              rel="noreferrer"
              target="_blank"
            >
              Open rendered video
            </a>
          ) : null}
          <Link className="button button-secondary" to="/reviews">
            Open review
          </Link>
          {canCancel ? (
            <button
              className="button button-secondary"
              disabled={cancelling}
              onClick={() => void onCancelJob()}
              type="button"
            >
              {cancelling ? 'Cancelling...' : 'Cancel run'}
            </button>
          ) : null}
          {canArchive ? (
            <button
              className="button button-secondary"
              disabled={archiving}
              onClick={() => void onArchiveJob()}
              type="button"
            >
              {archiving ? 'Removing...' : 'Delete from list'}
            </button>
          ) : null}
          <Link className="button button-secondary" to="/runs">
            Back to runs
          </Link>
        </div>
      </article>

      {detail.progress.stage === 'failed' ? (
        <article className="card">
          <div className="row-between">
            <div>
              <p className="eyebrow">Status</p>
              <h3>{detail.progress.retryable ? 'Retry recommended' : 'Run failed'}</h3>
              <p className="card-intro muted">
                {canRetryPublication
                  ? 'The run rendered successfully, but one or more delivery targets failed.'
                  : detail.progress.retryable
                    ? 'This failure looks transient. Retry once the machine or network is stable.'
                    : 'Open the details section to inspect the failure.'}
              </p>
              {detail.job.errorMessage ? (
                <div className="failed-step-hint">
                  <span className="failed-step-label">Failed at: </span>
                  <span className="failed-step-value">
                    {inferFailedStep(detail.job.errorMessage, detail.progress.title)}
                  </span>
                  <p className="failed-step-message muted">{detail.job.errorMessage.slice(0, 200)}</p>
                </div>
              ) : null}
            </div>
            <StatusBadge status="failed" />
          </div>
          <div className="action-bar">
            <Link className="button button-secondary" to="/reviews">
              Review queue
            </Link>
            <Link className="button button-secondary" to="/history">
              History
            </Link>
            {canRetryPublication ? (
              <button
                className="button button-primary"
                disabled={retrying}
                onClick={() => void onRetryPublication()}
                type="button"
              >
                {retrying ? 'Retrying...' : 'Retry publication'}
              </button>
            ) : detail.progress.retryable ? (
              <button
                className="button button-primary"
                disabled={retrying}
                onClick={() => void onRetryJob()}
                type="button"
              >
                {retrying ? 'Retrying...' : 'Retry job'}
              </button>
            ) : null}
          </div>
        </article>
      ) : null}

      {hasLocalPublication ? (
        <article className="card">
          <div className="row-between">
            <div>
              <p className="eyebrow">Next step</p>
              <h3>Local validation is complete</h3>
              <p className="card-intro muted">
                This run proves the live generation, review, and local publish path is working.
              </p>
            </div>
          </div>
          <div className="action-bar">
            <Link className="button button-primary" to="/connections">
              Open connections
            </Link>
            <a
              className="button button-secondary"
              href={apiClient.getLocalPublicationArtifactUrl(detail.job.id, 'video')}
              rel="noreferrer"
              target="_blank"
            >
              Watch Local Archive copy
            </a>
            <a
              className="button button-secondary"
              download="publication.json"
              href={apiClient.getLocalPublicationArtifactUrl(detail.job.id, 'manifest')}
            >
              Download manifest
            </a>
          </div>
        </article>
      ) : null}

      <div className="grid grid-two">
        <article className="card">
          <h3>Review package</h3>
          <p className="muted">
            {detail.job.reviewPackage?.summary ?? 'No review summary recorded.'}
          </p>
          <dl className="detail-list">
            <div>
              <dt>Scenes</dt>
              <dd>{detail.job.scriptPackage?.scenes.length ?? 0}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{detail.job.reviewPackage?.renderBundle.contentMode ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Target duration</dt>
              <dd>
                {detail.job.reviewPackage
                  ? `${detail.job.reviewPackage.renderBundle.durationSeconds}s`
                  : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>Narration duration</dt>
              <dd>
                {formatDurationSeconds(
                  detail.job.reviewPackage?.renderBundle.narrationDurationSeconds ?? null,
                  'Not measured'
                )}
              </dd>
            </div>
            <div>
              <dt>Rendered duration</dt>
              <dd>
                {detail.job.reviewPackage
                  ? formatDurationSeconds(
                      detail.job.reviewPackage.renderBundle.renderedDurationSeconds,
                      'Not recorded'
                    )
                  : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>Subtitle cues</dt>
              <dd>
                {detail.job.reviewPackage
                  ? detail.job.reviewPackage.renderBundle.subtitleCueCount > 0
                    ? detail.job.reviewPackage.renderBundle.subtitleCueCount
                    : 'Not recorded'
                  : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>Subtitle timing</dt>
              <dd>
                {detail.job.reviewPackage?.renderBundle.subtitleTimingSource ?? 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>Scene outcomes</dt>
              <dd>{sceneVisualOutcomes.length || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Speakers</dt>
              <dd>{dialogueSpeakerNames.length ? dialogueSpeakerNames.join(', ') : 'n/a'}</dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd>
                {detail.job.reviewPackage
                  ? formatDateTime(detail.job.reviewPackage.generatedAt)
                  : 'Not recorded'}
              </dd>
            </div>
          </dl>
        </article>

        <article className="card">
          <h3>Render outputs</h3>
          {detail.job.reviewPackage ? (
            <div className="stack">
              <div className="media-preview">
                <video
                  controls
                  preload="metadata"
                  src={apiClient.getRenderArtifactUrl(detail.job.id, 'video')}
                >
                  <track
                    default
                    kind="captions"
                    label="Generated captions"
                    src={apiClient.getRenderArtifactUrl(detail.job.id, 'subtitles')}
                    srcLang="en"
                  />
                </video>
              </div>

              <div className="artifact-links">
                <a
                  className="artifact-link"
                  href={apiClient.getRenderArtifactUrl(detail.job.id, 'video')}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open rendered video
                </a>
                <a
                  className="artifact-link"
                  download="captions.srt"
                  href={apiClient.getRenderArtifactUrl(detail.job.id, 'subtitles')}
                >
                  Download subtitles
                </a>
                {renderThumbnailPath ? (
                  <a
                    className="artifact-link"
                    download="thumbnail.jpg"
                    href={apiClient.getRenderArtifactUrl(detail.job.id, 'thumbnail')}
                  >
                    Download thumbnail
                  </a>
                ) : null}
              </div>

              <div className="action-bar">
                <Link className="button button-secondary" to="/reviews">
                  Open review
                </Link>
                <Link className="button button-secondary" to="/history">
                  Open history
                </Link>
              </div>
            </div>
          ) : (
            <p className="muted">Render outputs are not available for this run yet.</p>
          )}
        </article>
      </div>

      {hasLocalPublication ? (
        <article className="card">
          <h3>Local Archive copy</h3>
          <p className="muted">
            This approved run was copied into Local Archive and can be verified without any social
            platform connection.
          </p>
          <div className="artifact-links">
            <a
              className="artifact-link"
              href={apiClient.getLocalPublicationArtifactUrl(detail.job.id, 'video')}
              rel="noreferrer"
              target="_blank"
            >
              Open archived video
            </a>
            {renderThumbnailPath ? (
              <a
                className="artifact-link"
                download="thumbnail.jpg"
                href={apiClient.getLocalPublicationArtifactUrl(detail.job.id, 'thumbnail')}
              >
                Download archived thumbnail
              </a>
            ) : null}
            <a
              className="artifact-link"
              download="publication.json"
              href={apiClient.getLocalPublicationArtifactUrl(detail.job.id, 'manifest')}
            >
              Download archive manifest
            </a>
          </div>
          <div className="action-bar">
            <Link className="button button-secondary" to="/history">
              Back to history
            </Link>
            <Link className="button button-secondary" to="/connections">
              Connect platforms
            </Link>
          </div>
        </article>
      ) : null}

      {warnings.length > 0 ? (
        <WarningTriage warnings={warnings} />
      ) : null}

      {sceneVisualOutcomes.length > 0 ? (
        <article className="card">
          <div className="row-between">
            <div>
              <h3>Scene visuals</h3>
              <p className="muted">Requested premium mode versus the visual path actually used.</p>
            </div>
          </div>
          <div className="stack stack-tight">
            {sceneVisualOutcomes.map((outcome) => (
              <div className="asset-reference" key={`scene-outcome-${outcome.sceneOrder}`}>
                <div className="row-between">
                  <div>
                    <p className="asset-reference-title">Scene {outcome.sceneOrder}</p>
                    <p className="muted">
                      Requested {outcome.requestedVisualMode.replace(/_/g, ' ')} and rendered with{' '}
                      {outcome.providerUsed}.
                    </p>
                  </div>
                  <StatusBadge
                    status={outcome.usedFallback ? 'pending_configuration' : 'published'}
                  />
                </div>
                <dl className="detail-list detail-list-compact">
                  <div>
                    <dt>Requested</dt>
                    <dd>{outcome.requestedVisualMode}</dd>
                  </div>
                  <div>
                    <dt>Provider used</dt>
                    <dd>{outcome.providerUsed}</dd>
                  </div>
                  <div>
                    <dt>Fallback used</dt>
                    <dd>{outcome.usedFallback ? 'Yes' : 'No'}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <article className="card">
        <div className="row-between">
          <div>
            <h3>Technical details</h3>
            <p className="muted">
              {assetReferences.length} asset reference{assetReferences.length === 1 ? '' : 's'} were
              recorded for this run.
            </p>
          </div>
          <p className="muted">
            {detail.job.reviewPackage?.assetBundle.selectedVisualQueries.join(', ') ||
              'No visual queries recorded.'}
          </p>
        </div>

        <details className="system-details">
          <summary>More details</summary>
          <div className="stack">
            {detail.job.errorMessage || detail.progress.stage === 'failed' ? (
              <div>
                <p className="eyebrow">Failure detail</p>
                <p className="muted">{detail.job.errorMessage ?? detail.progress.detail}</p>
              </div>
            ) : null}

            {detail.job.scriptMetadata ? (
              <div>
                <p className="eyebrow">Metadata</p>
                <dl className="detail-list detail-list-compact">
                  <div>
                    <dt>Generator</dt>
                    <dd>
                      {`${detail.job.scriptMetadata.provider} (${detail.job.scriptMetadata.mode})`}
                    </dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>{detail.job.scriptMetadata.model}</dd>
                  </div>
                  <div>
                    <dt>Prompt version</dt>
                    <dd>{detail.job.scriptMetadata.promptVersion}</dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>{detail.job.scriptMetadata.attemptCount}</dd>
                  </div>
                  <div>
                    <dt>Repair flow</dt>
                    <dd>{detail.job.scriptMetadata.repaired ? 'Used' : 'Not needed'}</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>{detail.job.scriptMetadata.categoryLabel ?? 'n/a'}</dd>
                  </div>
                  <div>
                    <dt>Platform fit</dt>
                    <dd>{detail.job.scriptMetadata.platformFit ?? 'n/a'}</dd>
                  </div>
                  <div>
                    <dt>Monetization score</dt>
                    <dd>{detail.job.scriptMetadata.monetizationScore ?? 'n/a'}</dd>
                  </div>
                  <div>
                    <dt>Hook style</dt>
                    <dd>{detail.job.scriptMetadata.hookStyle ?? 'n/a'}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {detail.audit.length > 0 ? (
              <div>
                {detail.audit.map((entry) => (
                  <div
                    className="audit-entry"
                    key={`${entry.createdAt}-${entry.message}`}
                  >
                    <span className="audit-timestamp">
                      {formatTimeOnly(entry.createdAt)}
                    </span>
                    <span
                      className={
                        entry.level === 'warn'
                          ? 'audit-level-warn'
                          : entry.level === 'error'
                            ? 'audit-level-error'
                            : ''
                      }
                    >
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No audit events were recorded for this run.</p>
            )}

            {assetReferences.length > 0 ? (
              <div className="stack">
                {assetReferences.map((reference) => (
                  <div className="asset-reference" key={`${reference.kind}-${reference.path}`}>
                    <div className="row-between">
                      <div>
                        <p className="asset-reference-title">{reference.label}</p>
                        <p className="muted">{reference.path}</p>
                      </div>
                      <StatusBadge status={reference.kind} />
                    </div>
                    <dl className="detail-list detail-list-compact">
                      <div>
                        <dt>Provider</dt>
                        <dd>{reference.provider}</dd>
                      </div>
                      <div>
                        <dt>Scene</dt>
                        <dd>{reference.sceneOrder ?? 'n/a'}</dd>
                      </div>
                      <div>
                        <dt>Query</dt>
                        <dd>{reference.query ?? 'n/a'}</dd>
                      </div>
                      <div>
                        <dt>Source</dt>
                        <dd>{reference.sourceUrl ?? 'Local artifact'}</dd>
                      </div>
                      <div>
                        <dt>Match quality</dt>
                        <dd>{reference.matchQuality ?? 'n/a'}</dd>
                      </div>
                      <div>
                        <dt>Reuse status</dt>
                        <dd>{reference.reuseStatus ?? 'n/a'}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No asset references were persisted for this run.</p>
            )}
          </div>
        </details>
      </article>

      <article className="card">
        <h3>Publication results</h3>
        {publicationResults.length > 0 ? (
          <div className="stack stack-tight">
            {publicationResults.map((result) => (
              <div
                className="row-between publication-row"
                key={`${result.platform}-${result.status}`}
              >
                <div>
                  <p>{formatPlatformLabel(result.platform)}</p>
                  <p className="muted">{describePublicationResult(result)}</p>
                </div>
                <StatusBadge status={result.status} />
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">This run has not produced any publication records yet.</p>
        )}
      </article>
    </div>
  );
}

function inferFailedStep(errorMessage: string, progressTitle: string): string {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('script') || msg.includes('gemini') || msg.includes('groq') || msg.includes('generate')) return 'Script generation';
  if (msg.includes('voice') || msg.includes('tts') || msg.includes('narration') || msg.includes('audio')) return 'Voice synthesis';
  if (msg.includes('visual') || msg.includes('pexels') || msg.includes('pixabay') || msg.includes('archive') || msg.includes('nasa')) return 'Visual selection';
  if (msg.includes('render') || msg.includes('ffmpeg') || msg.includes('video')) return 'Video render';
  if (msg.includes('publish') || msg.includes('youtube') || msg.includes('facebook') || msg.includes('tiktok')) return 'Publishing';
  if (msg.includes('review') || msg.includes('approve')) return 'Review gate';
  // Fall back to progress title if no pattern matches
  return progressTitle || 'Unknown step';
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimeOnly(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDurationSeconds(value: number | null, fallback = 'Not recorded') {
  if (value === null || value <= 0) {
    return fallback;
  }

  return Number.isInteger(value) ? `${value}s` : `${value.toFixed(1)}s`;
}

function shouldPollJob(detail: JobDetailResponse['job']) {
  if (detail.status === 'drafting' || detail.status === 'cancelling') {
    return true;
  }

  if (detail.status === 'publish_pending') {
    return detail.publicationResults.some((result) => result.status === 'pending_processing');
  }

  return false;
}

function confirmAction(message: string) {
  if (typeof globalThis.confirm === 'function') {
    return globalThis.confirm(message);
  }

  return true;
}

function describePublicationResult(result: JobDetailResponse['job']['publicationResults'][number]) {
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
