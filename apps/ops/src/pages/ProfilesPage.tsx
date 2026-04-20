import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ContentProfile, Platform, UpsertProfileRequest } from '@autom/contracts';

import { apiClient } from '../api/client';
import { StatePanel } from '../components/StatePanel';
import { useToast } from '../components/Toast';
import { ProfileEditorModal } from '../features/ProfileEditorModal';
import { formatPlatformLabel } from '../lib/platforms';
import { createScheduleEditor, describeSchedule } from '../lib/schedule';

async function fetchProfiles(): Promise<ContentProfile[]> {
  return apiClient.listProfiles();
}

type ProfileSchemaGuide = {
  availableTargetPlatforms: Platform[];
};

export function ProfilesPage() {
  const [profiles, setProfiles] = useState<ContentProfile[]>([]);
  const [schemaGuide, setSchemaGuide] = useState<ProfileSchemaGuide | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const pushToast = useToast();

  const load = useCallback(
    async (options?: { background?: boolean }) => {
      try {
        if (!options?.background) {
          setIsLoading(true);
        }

        setProfiles(await fetchProfiles());
        setLoadFailed(false);
      } catch (value) {
        setLoadFailed(true);
        pushToast({
          tone: 'danger',
          title: 'Profiles could not be loaded',
          message: value instanceof Error ? value.message : 'Unable to load profiles.',
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

    void apiClient
      .getProfileSchema()
      .then((payload) => {
        setSchemaGuide({
          availableTargetPlatforms: payload.availableTargetPlatforms,
        });
      })
      .catch(() => {
        setSchemaGuide(null);
      });
  }, [load]);

  const editingProfile = useMemo(
    () => profiles.find((profile) => profile.id === editingProfileId) ?? null,
    [editingProfileId, profiles]
  );

  async function saveProfile(profile: ContentProfile) {
    try {
      setSavingProfileId(profile.id);
      const payload: UpsertProfileRequest = {
        name: profile.name,
        niche: profile.niche,
        tone: profile.tone,
        visualStyle: profile.visualStyle,
        promptDirectives: profile.promptDirectives,
        preferredTopics: profile.preferredTopics,
        bannedTopics: profile.bannedTopics,
        bannedTerms: profile.bannedTerms,
        sceneCount: profile.sceneCount,
        maxDurationSeconds: profile.maxDurationSeconds,
        contentMode: profile.contentMode,
        topicSource: profile.topicSource,
        dialogueCharacterPresetId: profile.dialogueCharacterPresetId,
        dialogueHostAName: profile.dialogueHostAName,
        dialogueHostBName: profile.dialogueHostBName,
        dialogueVoiceA: profile.dialogueVoiceA,
        dialogueVoiceB: profile.dialogueVoiceB,
        defaultHashtags: profile.defaultHashtags,
        callToActionStyle: profile.callToActionStyle,
        callToActionTemplate: profile.callToActionTemplate,
        callToActionGuardrails: profile.callToActionGuardrails,
        affiliateLinkTemplate: profile.affiliateLinkTemplate,
        requireAffiliateDisclosure: profile.requireAffiliateDisclosure,
        affiliateDisclosureTemplate: profile.affiliateDisclosureTemplate,
        enabled: profile.enabled,
        scheduleCron: profile.scheduleCron,
        targetPlatforms: profile.targetPlatforms,
        defaultVoice: profile.defaultVoice,
      };

      const savedProfile = await apiClient.upsertProfile(profile.id, payload);
      setProfiles((current) =>
        current.map((item) => (item.id === savedProfile.id ? savedProfile : item))
      );
      pushToast({
        tone: 'success',
        title: 'Profile saved',
        message: `${savedProfile.name} is ready for the next run.`,
      });
      await load({ background: true });
      setEditingProfileId(null);
    } catch (value) {
      pushToast({
        tone: 'danger',
        title: 'Profile save failed',
        message: value instanceof Error ? value.message : 'Unable to save profile.',
      });
    } finally {
      setSavingProfileId(null);
    }
  }

  const availableTargetPlatforms =
    schemaGuide?.availableTargetPlatforms ?? editingProfile?.targetPlatforms ?? [];

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h2>Profiles</h2>
          <p className="section-subtitle muted">
            Open a profile to edit its schedule, tone, and delivery targets in a modal.
          </p>
        </div>
      </header>

      {isLoading && profiles.length === 0 ? (
        <StatePanel
          description="Loading profile rules, scheduling defaults, and delivery targets."
          title="Loading profiles"
        />
      ) : loadFailed && profiles.length === 0 ? (
        <StatePanel
          actionLabel="Retry"
          description="Refresh the page or try again after the connection recovers."
          onAction={() => void load()}
          title="Profiles are temporarily unavailable"
          tone="danger"
        />
      ) : profiles.length === 0 ? (
        <StatePanel
          description="Create or seed at least one profile before generating content."
          title="No profiles are configured"
          tone="info"
        />
      ) : (
        <div className="stack">
          <article className="card">
            <div className="row-between">
              <div>
                <p className="eyebrow">Profile design</p>
                <h3>Operator summary</h3>
                <p className="card-intro muted">
                  Edit a profile when you need to change the content voice, cadence, or delivery
                  targets.
                </p>
              </div>
              <span className="badge badge-connected">{profiles.length} profile(s)</span>
            </div>
          </article>

          <div className="grid grid-two">
            {profiles.map((profile) => {
              const scheduleSummary = describeSchedule(createScheduleEditor(profile.scheduleCron));

              return (
                <article className="card" key={profile.id}>
                  <div className="row-between">
                    <div className="profile-summary-meta">
                      <p className="eyebrow">Profile</p>
                      <h3>{profile.name}</h3>
                      <p className="muted">{profile.niche}</p>
                    </div>
                    <span
                      className={`badge ${profile.enabled ? 'badge-connected' : 'badge-skipped'}`}
                    >
                      {profile.enabled ? 'enabled' : 'paused'}
                    </span>
                  </div>

                  <div className="profile-summary-grid">
                    <div className="detail-list">
                      <div>
                        <dt>Tone</dt>
                        <dd>{profile.tone}</dd>
                      </div>
                      <div>
                        <dt>Visual style</dt>
                        <dd>{profile.visualStyle}</dd>
                      </div>
                    </div>

                    <div className="detail-list">
                      <div>
                        <dt>Schedule</dt>
                        <dd>{scheduleSummary}</dd>
                      </div>
                      <div>
                        <dt>Voice</dt>
                        <dd>{profile.defaultVoice}</dd>
                      </div>
                      <div>
                        <dt>Mode</dt>
                        <dd>{profile.contentMode}</dd>
                      </div>
                    </div>
                  </div>

                  <div className="profile-summary-chip-row">
                    <span className="profile-summary-chip">{profile.sceneCount} scenes</span>
                    <span className="profile-summary-chip">{profile.maxDurationSeconds}s max</span>
                    <span className="profile-summary-chip">{formatContentModeLabel(profile.contentMode)}</span>
                    <span className="profile-summary-chip">{formatPlatformLabel(profile.targetPlatforms[0])}{profile.targetPlatforms.length > 1 ? ` +${profile.targetPlatforms.length - 1}` : ''}</span>
                    <span className="profile-summary-chip">CTA: {formatCtaLabel(profile.callToActionStyle)}</span>
                  </div>

                  <div className="action-bar">
                    <button
                      className="button button-primary"
                      onClick={() => setEditingProfileId(profile.id)}
                      type="button"
                    >
                      Edit configuration
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      <ProfileEditorModal
        availableTargetPlatforms={availableTargetPlatforms}
        onClose={() => setEditingProfileId(null)}
        onSave={saveProfile}
        open={editingProfile !== null}
        profile={editingProfile}
        saving={savingProfileId === editingProfile?.id}
      />
    </section>
  );
}

function formatCtaLabel(value: ContentProfile['callToActionStyle']) {
  switch (value) {
    case 'affiliate':
      return 'Affiliate';
    case 'community':
      return 'Community';
    case 'educational':
      return 'Educational';
  }
}

function formatContentModeLabel(value: ContentProfile['contentMode']) {
  switch (value) {
    case 'dialogue':
      return 'Dialogue';
    case 'narration':
      return 'Narration';
  }
}
