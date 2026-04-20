import { useEffect, useRef, useState } from 'react';

import type { JobProgress, JobProgressStage } from '@autom/contracts';

type ProgressStep = {
  stage: JobProgressStage;
  label: string;
  percent: number;
};

const PROGRESS_STEPS: ProgressStep[] = [
  { stage: 'starting', label: 'Queued', percent: 0 },
  { stage: 'generating_script', label: 'Script', percent: 20 },
  { stage: 'generating_narration', label: 'Voice', percent: 40 },
  { stage: 'selecting_visuals', label: 'Visuals', percent: 60 },
  { stage: 'rendering_review', label: 'Render', percent: 80 },
  { stage: 'publishing', label: 'Publish', percent: 100 },
];

const STAGE_INDEX: Record<JobProgressStage, number> = {
  starting: 0,
  generating_script: 1,
  waiting_for_manual_clip: 1,
  generating_narration: 2,
  selecting_visuals: 3,
  rendering_review: 4,
  ready_for_review: 4,
  approved: 4,
  publishing: 5,
  published: 5,
  failed: 5,
};

const ACTIVE_STAGES: JobProgressStage[] = [
  'starting',
  'generating_script',
  'generating_narration',
  'selecting_visuals',
  'rendering_review',
  'publishing',
];

export function JobProgressStepper({ progress }: { progress: JobProgress }) {
  const currentIndex = STAGE_INDEX[progress.stage];
  const isPublished = progress.stage === 'published';
  const isActive = ACTIVE_STAGES.includes(progress.stage);
  const targetPercent = isPublished
    ? 100
    : progress.stage === 'failed'
      ? Math.min(PROGRESS_STEPS[Math.max(0, currentIndex - 1)]?.percent ?? 0, 80)
      : PROGRESS_STEPS[currentIndex]?.percent ?? 0;

  const [displayedPercent, setDisplayedPercent] = useState(targetPercent);
  const displayedPercentRef = useRef(displayedPercent);

  useEffect(() => {
    displayedPercentRef.current = displayedPercent;
  }, [displayedPercent]);

  useEffect(() => {
    const startPercent = displayedPercentRef.current;
    if (startPercent === targetPercent) {
      return;
    }

    let animationFrame = 0;
    const animationDurationMs = isActive ? 720 : 360;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / animationDurationMs);
      const eased = 1 - (1 - elapsed) ** 3;
      const nextPercent = Math.round(startPercent + (targetPercent - startPercent) * eased);
      setDisplayedPercent(nextPercent);

      if (elapsed < 1) {
        animationFrame = requestAnimationFrame(tick);
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [isActive, targetPercent]);

  return (
    <section className={`progress-stepper progress-stepper-${progress.tone}`}>
      <div className="progress-stepper-summary">
        <div>
          <p className="eyebrow">Live progress</p>
          <h4>{progress.title}</h4>
          <p className="muted">{progress.detail}</p>
        </div>
        <div className="progress-stepper-summary-meta">
          <span className="progress-stepper-summary-percent" aria-live="polite">
            {displayedPercent}%
          </span>
          <span className={`badge badge-${progress.tone}`}>
            {progress.stage.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      <div className="progress-stepper-track" aria-label="Job progress steps">
        {PROGRESS_STEPS.map((step, index) => {
          const isCompleted = isPublished || index < currentIndex;
          const isCurrent = isActive && index === currentIndex;

          return (
            <div
              className={`progress-stepper-step ${
                isCompleted
                  ? 'progress-stepper-step-complete'
                  : isCurrent
                    ? 'progress-stepper-step-active'
                    : 'progress-stepper-step-pending'
              }`}
              key={step.stage}
            >
              <div className="progress-stepper-node">
                {isCompleted ? (
                  <span className="progress-stepper-node-mark" aria-hidden="true">
                    ✓
                  </span>
                ) : isCurrent ? (
                  <>
                    <span className="progress-stepper-node-spinner" aria-hidden="true" />
                    <span className="progress-stepper-node-mark">{step.percent}%</span>
                  </>
                ) : (
                  <span className="progress-stepper-node-mark">{step.percent}%</span>
                )}
              </div>
              <div className="progress-stepper-copy">
                <span className="progress-stepper-label">{step.label}</span>
                <span className="progress-stepper-percent">{step.percent}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
