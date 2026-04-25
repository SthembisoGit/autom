import { useEffect, useMemo, useState } from 'react';

import type { ContentCategory, ContentProfile, Platform } from '@autom/contracts';

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

const contentModeOptions: Array<{
  value: ContentProfile['contentMode'];
  label: string;
}> = [
  { value: 'narration', label: 'Narration' },
  { value: 'dialogue', label: 'Dialogue' },
];

const topicSourceOptions: Array<{
  value: ContentProfile['topicSource'];
  label: string;
}> = [
  { value: 'category_pool', label: 'Category opportunity engine' },
  { value: 'daily_news', label: 'Daily trending news' },
];

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
            <p className="muted">These settings shape how categories turn into stronger videos.</p>
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

          <div className="stack">
            <div className="profile-section-heading">
              <h3>Content categories</h3>
              <p className="muted">
                Categories are the strategy lanes. The AI chooses a fresh topic under one of these
                lanes each run.
              </p>
            </div>
            {errors.contentCategories ? (
              <small className="error-text">{errors.contentCategories}</small>
            ) : null}

            <div className="stack">
              {draft.contentCategories.map((category, index) => (
                <article className="card" key={category.id}>
                  <div className="row-between">
                    <div>
                      <p className="eyebrow">Category {index + 1}</p>
                      <h4>{category.label}</h4>
                    </div>
                    <label className="checkbox-row">
                      <input
                        checked={category.enabled}
                        type="checkbox"
                        onChange={(event) =>
                          updateCategory(draft, updateDraft, index, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                      <span>{category.enabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                  </div>

                  <div className="form-grid">
                    <label>
                      <span>Label</span>
                      <input
                        value={category.label}
                        onChange={(event) =>
                          updateCategory(draft, updateDraft, index, { label: event.target.value })
                        }
                      />
                    </label>

                    <label>
                      <span>Goal</span>
                      <select
                        value={category.goal}
                        onChange={(event) =>
                          updateCategory(draft, updateDraft, index, {
                            goal: event.target.value as ContentCategory['goal'],
                          })
                        }
                      >
                        <option value="revenue">Revenue</option>
                        <option value="reach">Reach</option>
                        <option value="authority">Authority</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                    </label>

                    <label>
                      <span>Platform fit</span>
                      <select
                        value={category.platformFit}
                        onChange={(event) =>
                          updateCategory(draft, updateDraft, index, {
                            platformFit: event.target.value as ContentCategory['platformFit'],
                          })
                        }
                      >
                        <option value="meta">Meta</option>
                        <option value="youtube">YouTube</option>
                        <option value="both">Both</option>
                      </select>
                    </label>

                    <label>
                      <span>Content bias</span>
                      <select
                        value={category.contentTypeBias}
                        onChange={(event) =>
                          updateCategory(draft, updateDraft, index, {
                            contentTypeBias:
                              event.target.value as ContentCategory['contentTypeBias'],
                          })
                        }
                      >
                        <option value="recent_news">Recent news</option>
                        <option value="named_person_or_event">Named person or event</option>
                        <option value="historical_topic">Historical topic</option>
                        <option value="place_or_institution">Place or institution</option>
                        <option value="generic_business_or_lifestyle">Business or lifestyle</option>
                        <option value="product_or_tool_demo">Product or tool demo</option>
                        <option value="mixed">Mixed</option>
                      </select>
                    </label>

                    <label>
                      <span>Target countries</span>
                      <textarea
                        rows={2}
                        value={formatList(category.countryTargets)}
                        onChange={(event) =>
                          updateCategory(draft, updateDraft, index, {
                            countryTargets: parseList(event.target.value),
                          })
                        }
                      />
                    </label>

                    <label>
                      <span>Search lenses</span>
                      <textarea
                        rows={3}
                        value={formatList(category.searchLenses)}
                        onChange={(event) =>
                          updateCategory(draft, updateDraft, index, {
                            searchLenses: parseList(event.target.value),
                          })
                        }
                      />
                    </label>

                    <label>
                      <span>Example topics</span>
                      <textarea
                        rows={3}
                        value={formatList(category.exampleTopics)}
                        onChange={(event) =>
                          updateCategory(draft, updateDraft, index, {
                            exampleTopics: parseList(event.target.value),
                          })
                        }
                      />
                    </label>

                    <label className="label-wide">
                      <span>Topic generation rules</span>
                      <textarea
                        rows={3}
                        value={category.topicGenerationRules}
                        onChange={(event) =>
                          updateCategory(draft, updateDraft, index, {
                            topicGenerationRules: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="profile-section">
          <div className="profile-section-heading">
            <h3>Content mode and voices</h3>
            <p className="muted">Dialogue mode keeps two recurring hosts on screen.</p>
          </div>

          <div className="form-grid">
            <label>
              <span>Content mode</span>
              <select
                value={draft.contentMode}
                onChange={(event) =>
                  updateDraft({
                    contentMode: event.target.value as ContentProfile['contentMode'],
                  })
                }
              >
                {contentModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Topic source</span>
              <select
                value={draft.topicSource}
                onChange={(event) =>
                  updateDraft({
                    topicSource: event.target.value as ContentProfile['topicSource'],
                  })
                }
              >
                {topicSourceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Default voice</span>
              <input
                value={draft.defaultVoice}
                onChange={(event) => updateDraft({ defaultVoice: event.target.value })}
              />
            </label>

            <label>
              <span>Character preset</span>
              <input
                value={draft.dialogueCharacterPresetId}
                onChange={(event) =>
                  updateDraft({ dialogueCharacterPresetId: event.target.value })
                }
              />
            </label>

            <label>
              <span>Host A name</span>
              <input
                aria-invalid={Boolean(errors.dialogueHostAName)}
                value={draft.dialogueHostAName}
                onChange={(event) => updateDraft({ dialogueHostAName: event.target.value })}
              />
              {errors.dialogueHostAName ? (
                <small className="error-text">{errors.dialogueHostAName}</small>
              ) : null}
            </label>

            <label>
              <span>Host B name</span>
              <input
                aria-invalid={Boolean(errors.dialogueHostBName)}
                value={draft.dialogueHostBName}
                onChange={(event) => updateDraft({ dialogueHostBName: event.target.value })}
              />
              {errors.dialogueHostBName ? (
                <small className="error-text">{errors.dialogueHostBName}</small>
              ) : null}
            </label>

            <label>
              <span>Host A voice</span>
              <input
                aria-invalid={Boolean(errors.dialogueVoiceA)}
                value={draft.dialogueVoiceA}
                onChange={(event) => updateDraft({ dialogueVoiceA: event.target.value })}
              />
              {errors.dialogueVoiceA ? (
                <small className="error-text">{errors.dialogueVoiceA}</small>
              ) : null}
            </label>

            <label>
              <span>Host B voice</span>
              <input
                aria-invalid={Boolean(errors.dialogueVoiceB)}
                value={draft.dialogueVoiceB}
                onChange={(event) => updateDraft({ dialogueVoiceB: event.target.value })}
              />
              {errors.dialogueVoiceB ? (
                <small className="error-text">{errors.dialogueVoiceB}</small>
              ) : null}
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
    contentCategories: profile.contentCategories.map((category) => ({
      ...category,
      countryTargets: [...category.countryTargets],
      searchLenses: [...category.searchLenses],
      exampleTopics: [...category.exampleTopics],
      lengthStrategy: { ...category.lengthStrategy },
    })),
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

  if (profile.contentCategories.length === 0) {
    errors.contentCategories = 'At least one category is required.';
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

  if (profile.contentMode === 'dialogue') {
    if (!profile.dialogueHostAName.trim()) {
      errors.dialogueHostAName = 'Dialogue mode needs a first host name.';
    }

    if (!profile.dialogueHostBName.trim()) {
      errors.dialogueHostBName = 'Dialogue mode needs a second host name.';
    }

    if (
      profile.dialogueHostAName.trim().toLowerCase() === profile.dialogueHostBName.trim().toLowerCase()
    ) {
      errors.dialogueHostBName = 'Dialogue hosts must be distinct.';
    }

    if (!profile.dialogueVoiceA.trim()) {
      errors.dialogueVoiceA = 'Dialogue mode needs a voice for host A.';
    }

    if (!profile.dialogueVoiceB.trim()) {
      errors.dialogueVoiceB = 'Dialogue mode needs a voice for host B.';
    }
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

function updateCategory(
  profile: ContentProfile,
  updateDraft: (updates: Partial<ContentProfile>) => void,
  index: number,
  updates: Partial<ContentCategory>
) {
  const nextCategories = profile.contentCategories.map((category, categoryIndex) =>
    categoryIndex === index ? { ...category, ...updates } : category
  );
  updateDraft({ contentCategories: nextCategories });
}
