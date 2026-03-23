import { useEffect, useMemo, useState } from 'react';

import type { ContentProfile, Platform } from '@autom/contracts';

import { callToActionStyleOptions } from '../api/client';
import { Modal } from '../components/Modal';
import { formatPlatformLabel } from '../lib/platforms';
import { createScheduleEditor, describeSchedule } from '../lib/schedule';
import { ScheduleEditor } from './ScheduleEditor';

type ProfileEditorModalProps = {
  open: boolean;
  profile: ContentProfile | null;
  availableTargetPlatforms: Platform[];
  onClose: () => void;
  onSave: (profile: ContentProfile) => Promise<void>;
  saving: boolean;
};

type ValidationErrors = Partial<Record<keyof ContentProfile, string>>;

export function ProfileEditorModal({
  open,
  profile,
  availableTargetPlatforms,
  onClose,
  onSave,
  saving,
}: ProfileEditorModalProps) {
  const [draft, setDraft] = useState<ContentProfile | null>(null);
  const [errors, setErrors] = useState<ValidationErrors>({});

  useEffect(() => {
    const nextProfile = profile;

    if (!open || !nextProfile) {
      return;
    }

    setDraft(cloneProfile(nextProfile));
    setErrors({});
  }, [open, profile]);

  const schedulePreview = useMemo(() => {
    if (!draft) {
      return null;
    }

    return describeSchedule(createScheduleEditor(draft.scheduleCron));
  }, [draft]);

  if (!open || !draft || !profile) {
    return null;
  }

  function updateDraft(updates: Partial<ContentProfile>) {
    setDraft((current) => (current ? { ...current, ...updates } : current));
  }

  async function handleSave() {
    if (!draft) {
      return;
    }

    const nextErrors = validateProfile(draft, availableTargetPlatforms);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    await onSave(draft);
    onClose();
  }

  return (
    <Modal
      description="Edit the profile voice, timing, and delivery targets without cluttering the main page."
      onClose={onClose}
      open={open}
      title={draft.name}
    >
      <div className="stack profile-modal-body">
        <section className="profile-section">
          <div className="profile-section-heading">
            <h3>Core identity</h3>
            <p className="muted">Keep the profile focused and specific.</p>
          </div>

          <div className="form-grid">
            <label>
              <span>Name</span>
              <input
                aria-invalid={Boolean(errors.name)}
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
              />
              {errors.name ? <small className="error-text">{errors.name}</small> : null}
            </label>

            <label>
              <span>Niche</span>
              <input
                aria-invalid={Boolean(errors.niche)}
                value={draft.niche}
                onChange={(event) => updateDraft({ niche: event.target.value })}
              />
              {errors.niche ? <small className="error-text">{errors.niche}</small> : null}
            </label>

            <label>
              <span>Tone</span>
              <input
                aria-invalid={Boolean(errors.tone)}
                value={draft.tone}
                onChange={(event) => updateDraft({ tone: event.target.value })}
              />
              {errors.tone ? <small className="error-text">{errors.tone}</small> : null}
            </label>

            <label>
              <span>Visual style</span>
              <input
                aria-invalid={Boolean(errors.visualStyle)}
                value={draft.visualStyle}
                onChange={(event) => updateDraft({ visualStyle: event.target.value })}
              />
              {errors.visualStyle ? (
                <small className="error-text">{errors.visualStyle}</small>
              ) : null}
            </label>
          </div>
        </section>

        <section className="profile-section">
          <div className="profile-section-heading">
            <h3>Prompt rules</h3>
            <p className="muted">These settings keep generation focused and safe.</p>
          </div>

          <div className="form-grid">
            <label className="label-wide">
              <span>Prompt directives</span>
              <textarea
                rows={4}
                value={draft.promptDirectives}
                onChange={(event) => updateDraft({ promptDirectives: event.target.value })}
              />
            </label>

            <label>
              <span>Preferred topics</span>
              <textarea
                rows={4}
                value={formatList(draft.preferredTopics)}
                onChange={(event) =>
                  updateDraft({
                    preferredTopics: parseList(event.target.value),
                  })
                }
              />
              <small className="field-note">One per line or comma separated.</small>
            </label>

            <label>
              <span>Banned topics</span>
              <textarea
                rows={4}
                value={formatList(draft.bannedTopics)}
                onChange={(event) =>
                  updateDraft({
                    bannedTopics: parseList(event.target.value),
                  })
                }
              />
              <small className="field-note">Generation skips matching topics.</small>
            </label>

            <label>
              <span>Banned terms</span>
              <textarea
                rows={4}
                value={formatList(draft.bannedTerms)}
                onChange={(event) =>
                  updateDraft({
                    bannedTerms: parseList(event.target.value),
                  })
                }
              />
              <small className="field-note">Useful for compliance language and exclusions.</small>
            </label>

            <label>
              <span>Scene count</span>
              <input
                aria-invalid={Boolean(errors.sceneCount)}
                min={3}
                max={8}
                type="number"
                value={draft.sceneCount}
                onChange={(event) => updateDraft({ sceneCount: Number(event.target.value) || 0 })}
              />
              {errors.sceneCount ? <small className="error-text">{errors.sceneCount}</small> : null}
            </label>

            <label>
              <span>Runtime budget seconds</span>
              <input
                aria-invalid={Boolean(errors.maxDurationSeconds)}
                min={15}
                max={180}
                type="number"
                value={draft.maxDurationSeconds}
                onChange={(event) =>
                  updateDraft({ maxDurationSeconds: Number(event.target.value) || 0 })
                }
              />
              <small className="field-note">
                Extended runs can target 90, 120, or 180 seconds.
              </small>
              {errors.maxDurationSeconds ? (
                <small className="error-text">{errors.maxDurationSeconds}</small>
              ) : null}
            </label>

            <label className="label-wide">
              <span>Default hashtags</span>
              <textarea
                rows={3}
                value={formatList(draft.defaultHashtags)}
                onChange={(event) =>
                  updateDraft({
                    defaultHashtags: parseList(event.target.value).map((item) =>
                      item.replace(/^#/, '')
                    ),
                  })
                }
              />
              <small className="field-note">Used as reusable tags in generated scripts.</small>
            </label>
          </div>
        </section>

        <section className="profile-section">
          <div className="profile-section-heading">
            <h3>Call to action policy</h3>
            <p className="muted">Control how promotional language is handled.</p>
          </div>

          <div className="form-grid">
            <label>
              <span>CTA style</span>
              <select
                value={draft.callToActionStyle}
                onChange={(event) =>
                  updateDraft({
                    callToActionStyle: event.target.value as ContentProfile['callToActionStyle'],
                  })
                }
              >
                {callToActionStyleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="label-wide">
              <span>CTA template</span>
              <textarea
                rows={3}
                value={draft.callToActionTemplate}
                onChange={(event) => updateDraft({ callToActionTemplate: event.target.value })}
              />
            </label>

            <label className="label-wide">
              <span>CTA guardrails</span>
              <textarea
                rows={3}
                value={draft.callToActionGuardrails}
                onChange={(event) => updateDraft({ callToActionGuardrails: event.target.value })}
              />
            </label>

            <label>
              <span>Affiliate link template</span>
              <input
                value={draft.affiliateLinkTemplate}
                onChange={(event) => updateDraft({ affiliateLinkTemplate: event.target.value })}
              />
              <small className="field-note">
                Leave this blank unless you already have a tracked affiliate URL. The app does not
                create affiliate enrollments for you.
              </small>
            </label>

            <label className="checkbox-row">
              <input
                checked={draft.requireAffiliateDisclosure}
                type="checkbox"
                onChange={(event) =>
                  updateDraft({ requireAffiliateDisclosure: event.target.checked })
                }
              />
              <span>Require affiliate disclosure</span>
            </label>

            <label className="label-wide">
              <span>Affiliate disclosure template</span>
              <textarea
                rows={2}
                value={draft.affiliateDisclosureTemplate}
                onChange={(event) =>
                  updateDraft({ affiliateDisclosureTemplate: event.target.value })
                }
              />
            </label>
          </div>
        </section>

        <section className="profile-section">
          <div className="profile-section-heading">
            <h3>Scheduling and delivery</h3>
            <p className="muted">Pick a cadence and the platforms this profile can publish to.</p>
          </div>

          <ScheduleEditor
            enabled={draft.enabled}
            onEnabledChange={(enabled) => updateDraft({ enabled })}
            onScheduleCronChange={(scheduleCron) => updateDraft({ scheduleCron })}
            scheduleCron={draft.scheduleCron}
          />
          {errors.scheduleCron ? <small className="error-text">{errors.scheduleCron}</small> : null}

          <div className="form-grid">
            <label>
              <span>Default voice</span>
              <input
                value={draft.defaultVoice}
                onChange={(event) => updateDraft({ defaultVoice: event.target.value })}
              />
            </label>

            <div className="label-wide">
              <span>Target platforms</span>
              <p className="muted">Only platforms enabled for this deployment are shown here.</p>
              <div className="platform-checkboxes">
                {availableTargetPlatforms.map((platform) => {
                  const checked = draft.targetPlatforms.includes(platform);

                  return (
                    <label className="checkbox-row checkbox-chip" key={platform}>
                      <input
                        checked={checked}
                        type="checkbox"
                        onChange={(event) =>
                          updateDraft({
                            targetPlatforms: event.target.checked
                              ? Array.from(new Set([...draft.targetPlatforms, platform]))
                              : draft.targetPlatforms.filter((value) => value !== platform),
                          })
                        }
                      />
                      <span>{formatPlatformLabel(platform)}</span>
                    </label>
                  );
                })}
              </div>
              {errors.targetPlatforms ? (
                <small className="error-text">{errors.targetPlatforms}</small>
              ) : null}
            </div>
          </div>

          <p className="muted">{schedulePreview ?? 'Select a schedule to preview the next run.'}</p>
        </section>

        <div className="action-bar">
          <button className="button button-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={saving}
            onClick={handleSave}
            type="button"
          >
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function cloneProfile(profile: ContentProfile): ContentProfile {
  return {
    ...profile,
    preferredTopics: [...profile.preferredTopics],
    bannedTopics: [...profile.bannedTopics],
    bannedTerms: [...profile.bannedTerms],
    defaultHashtags: [...profile.defaultHashtags],
    targetPlatforms: [...profile.targetPlatforms],
  };
}

function validateProfile(profile: ContentProfile, availableTargetPlatforms: Platform[]) {
  const errors: ValidationErrors = {};

  if (!profile.name.trim()) {
    errors.name = 'Name is required.';
  }

  if (!profile.niche.trim()) {
    errors.niche = 'Niche is required.';
  }

  if (!profile.tone.trim()) {
    errors.tone = 'Tone is required.';
  }

  if (!profile.visualStyle.trim()) {
    errors.visualStyle = 'Visual style is required.';
  }

  if (profile.sceneCount < 3 || profile.sceneCount > 8) {
    errors.sceneCount = 'Scene count must stay between 3 and 8.';
  }

  if (profile.maxDurationSeconds < 15 || profile.maxDurationSeconds > 180) {
    errors.maxDurationSeconds = 'Duration must stay between 15 and 180 seconds.';
  }

  if (profile.targetPlatforms.length === 0) {
    errors.targetPlatforms = 'Select at least one delivery platform.';
  }

  if (profile.targetPlatforms.some((platform) => !availableTargetPlatforms.includes(platform))) {
    errors.targetPlatforms = 'Remove unsupported platforms before saving.';
  }

  if (!profile.scheduleCron.trim()) {
    errors.scheduleCron = 'Choose a schedule before saving.';
  }

  return errors;
}

function parseList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function formatList(values: string[]): string {
  return values.join('\n');
}
