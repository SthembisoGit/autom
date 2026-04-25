import { CronExpressionParser } from 'cron-parser';
import { nanoid } from 'nanoid';

import type { ContentProfile, Platform, UpsertProfileRequest } from '@autom/contracts';
import { ContentProfileSchema } from '@autom/contracts';

import { normalizeCronExpression } from '../lib/cron.js';
import {
  createDefaultContentCategories,
  createDefaultProfile,
  migrateLegacyDefaultProfile,
  shouldRefreshDefaultProfile,
} from '../lib/default-profile.js';
import { badRequest } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import type { AppRepository } from '../repositories/app-repository.js';

export class ProfilesService {
  constructor(
    private readonly repository: AppRepository,
    private readonly availablePlatforms: Platform[]
  ) {}

  ensureSeedProfile(): ContentProfile {
    const existing = this.repository.listProfiles();
    if (existing.length > 0) {
      const current = existing[0];
      if (shouldRefreshDefaultProfile(current)) {
        return this.repository.upsertProfile(
          this.repairProfile(migrateLegacyDefaultProfile(current, this.listAvailablePlatforms()))
        );
      }

      return this.repairProfile(current);
    }

    return this.repository.upsertProfile(createDefaultProfile(this.listAvailablePlatforms()));
  }

  listAvailablePlatforms(): Platform[] {
    return [...this.availablePlatforms];
  }

  list(): ContentProfile[] {
    return this.repository.listProfiles().map((profile) =>
      this.repairProfile(
        shouldRefreshDefaultProfile(profile)
          ? migrateLegacyDefaultProfile(profile, this.listAvailablePlatforms())
          : profile
      )
    );
  }

  get(profileId: string): ContentProfile | null {
    const profile = this.repository.getProfile(profileId);
    return profile
      ? this.repairProfile(
          shouldRefreshDefaultProfile(profile)
            ? migrateLegacyDefaultProfile(profile, this.listAvailablePlatforms())
            : profile
        )
      : null;
  }

  migrateAllProfilesToTargetPlatforms(targetPlatforms: Platform[]): number {
    const nextTargets = this.sanitizeTargetPlatforms(targetPlatforms);
    let migratedProfiles = 0;

    for (const profile of this.repository.listProfiles()) {
      const currentTargets = this.sanitizeTargetPlatforms(profile.targetPlatforms);
      if (samePlatforms(currentTargets, nextTargets)) {
        continue;
      }

      this.repository.upsertProfile(
        ContentProfileSchema.parse({
          ...profile,
          targetPlatforms: [...nextTargets],
          updatedAt: nowIso(),
        })
      );
      migratedProfiles += 1;
    }

    return migratedProfiles;
  }

  upsert(profileId: string, input: UpsertProfileRequest): ContentProfile {
    const current = this.repository.getProfile(profileId);
    const timestamp = nowIso();
    this.assertAvailableTargetPlatforms(input.targetPlatforms);

    try {
      CronExpressionParser.parse(normalizeCronExpression(input.scheduleCron), {
        strict: true,
      });
    } catch (error) {
      throw badRequest(
        error instanceof Error
          ? `Invalid cron expression. ${error.message}`
          : 'Invalid cron expression.'
      );
    }

    const profile = this.repairProfile(
      ContentProfileSchema.parse({
        id: current?.id ?? profileId ?? `profile_${nanoid(8)}`,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...input,
      })
    );

    const savedProfile = this.repository.upsertProfile(profile);
    if (savedProfile.enabled && (!current || !current.enabled)) {
      this.repository.upsertSchedulerProfileResumeAt(savedProfile.id, savedProfile.updatedAt);
    }

    return savedProfile;
  }

  private repairProfile(profile: ContentProfile): ContentProfile {
    const repaired: ContentProfile = {
      ...profile,
      contentCategories:
        profile.contentCategories.length > 0
          ? profile.contentCategories
          : createDefaultContentCategories(),
      contentMode: 'narration',
      topicSource:
        profile.topicSource === 'preferred_topics' ? 'category_pool' : profile.topicSource,
      targetPlatforms: this.sanitizeTargetPlatforms(profile.targetPlatforms),
    };

    if (repaired.contentCategories.length === 0) {
      return {
        ...repaired,
        ...createDefaultProfile(this.listAvailablePlatforms()),
        id: profile.id,
        createdAt: profile.createdAt,
        updatedAt: nowIso(),
        enabled: profile.enabled,
        scheduleCron: profile.scheduleCron,
        defaultVoice: profile.defaultVoice,
        targetPlatforms: this.sanitizeTargetPlatforms(profile.targetPlatforms),
      };
    }

    return repaired;
  }

  private sanitizeTargetPlatforms(targetPlatforms: Platform[]): Platform[] {
    const filtered = Array.from(
      new Set(targetPlatforms.filter((platform) => this.availablePlatforms.includes(platform)))
    );
    const fallbackPlatform = this.availablePlatforms[0];
    if (!fallbackPlatform) {
      throw new Error('At least one profile target platform must be enabled.');
    }

    return filtered.length > 0 ? filtered : [fallbackPlatform];
  }

  private assertAvailableTargetPlatforms(targetPlatforms: Platform[]): void {
    const unavailablePlatforms = targetPlatforms.filter(
      (platform) => !this.availablePlatforms.includes(platform)
    );

    if (unavailablePlatforms.length === 0) {
      return;
    }

    throw badRequest(
      `Target platform${unavailablePlatforms.length === 1 ? '' : 's'} ${unavailablePlatforms.join(', ')} ${
        unavailablePlatforms.length === 1 ? 'is' : 'are'
      } not enabled for this deployment.`
    );
  }
}

function samePlatforms(left: Platform[], right: Platform[]): boolean {
  return left.length === right.length && left.every((platform, index) => platform === right[index]);
}
