import type { AppEnv } from '@autom/config';
import type { GenerationJob, PlatformConnection, PublicationResult } from '@autom/contracts';

import { badRequest } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import type { Publisher } from '../lib/types.js';
import type { AppRepository } from '../repositories/app-repository.js';
import {
  buildShortCaption,
  createConnectionSummary,
  createFailedPublicationResult,
  createPendingConfigurationResult,
  createPendingProcessingResult,
  createPublishedResult,
  ensurePublishableArtifacts,
  fileExists,
  getFileSize,
  getNullableString,
  getRecordValue,
  getStringList,
  isExpired,
  readFileBuffer,
  readResponseMessage,
} from './common.js';
import { createOAuthState, verifyOAuthState } from './oauth-state.js';

type TikTokConnectionRecord = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  connectedAt: string;
  accountLabel: string | null;
  openId: string | null;
  scopes: string[];
};

type TikTokCreatorInfo = {
  accountLabel: string | null;
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
};

export class TikTokPublisher implements Publisher {
  readonly platform = 'tiktok' as const;

  constructor(
    private readonly env: AppEnv,
    private readonly repository: AppRepository
  ) {}

  async getConnection(): Promise<PlatformConnection> {
    if (!this.isConfigured()) {
      return createConnectionSummary({
        platform: this.platform,
        status: 'not_configured',
        configured: false,
        connected: false,
        message: 'Set TikTok client credentials and redirect URI before connecting.',
      });
    }

    const record = this.getStoredConnection();
    if (!record) {
      return createConnectionSummary({
        platform: this.platform,
        status: 'disconnected',
        configured: true,
        connected: false,
        message: 'No TikTok account is connected.',
      });
    }

    const expired = isExpired(record.refreshExpiresAt ?? record.expiresAt);
    return createConnectionSummary({
      platform: this.platform,
      status: expired ? 'expired' : 'connected',
      configured: true,
      connected: !expired,
      accountLabel: record.accountLabel,
      connectedAt: record.connectedAt,
      expiresAt: record.expiresAt,
      message: expired ? 'The TikTok token expired and must be reconnected.' : null,
    });
  }

  async getAuthorizationUrl(): Promise<string> {
    this.assertConfigured();

    const params = new URLSearchParams({
      client_key: this.env.TIKTOK_CLIENT_KEY ?? '',
      redirect_uri: this.env.TIKTOK_REDIRECT_URI ?? '',
      response_type: 'code',
      scope: 'user.info.basic,video.publish',
      state: createOAuthState(this.env.SESSION_SECRET, this.platform),
    });

    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  }

  async completeAuthorization(input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<PlatformConnection> {
    this.assertConfigured();
    if (input.error) {
      throw badRequest(input.errorDescription ?? `TikTok authorization failed: ${input.error}.`);
    }

    verifyOAuthState(this.env.SESSION_SECRET, this.platform, input.state);
    if (!input.code) {
      throw badRequest('TikTok did not return an authorization code.');
    }

    const tokenResponse = await this.exchangeAuthorizationCode(input.code);
    const creatorInfo = await this.queryCreatorInfo(tokenResponse.accessToken);

    this.repository.upsertPlatformConnection<TikTokConnectionRecord>(this.platform, {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      expiresAt: tokenResponse.expiresAt,
      refreshExpiresAt: tokenResponse.refreshExpiresAt,
      connectedAt: nowIso(),
      accountLabel: creatorInfo.accountLabel,
      openId: tokenResponse.openId,
      scopes: tokenResponse.scopes,
    });

    return this.getConnection();
  }

  async disconnect(): Promise<PlatformConnection> {
    this.repository.deletePlatformConnection(this.platform);
    return this.getConnection();
  }

  async publish(job: GenerationJob): Promise<PublicationResult> {
    if (!this.isConfigured()) {
      return createPendingConfigurationResult(
        this.platform,
        'TikTok client credentials are not configured yet.'
      );
    }

    const storedConnection = this.getStoredConnection();
    if (!storedConnection) {
      return createPendingConfigurationResult(
        this.platform,
        'Connect a TikTok account before publishing.'
      );
    }

    try {
      const { videoPath } = ensurePublishableArtifacts(job);
      if (!(await fileExists(videoPath))) {
        return createFailedPublicationResult(
          this.platform,
          'The rendered video file is missing from disk and cannot be uploaded.'
        );
      }

      const connection = await this.ensureFreshConnection(storedConnection);
      const creatorInfo = await this.queryCreatorInfo(connection.accessToken);
      const videoSize = await getFileSize(videoPath);
      const initResponse = await this.initializeUpload({
        accessToken: connection.accessToken,
        caption: buildShortCaption(job, 150),
        creatorInfo,
        videoSize,
      });

      const videoBuffer = await readFileBuffer(videoPath);
      const uploadResponse = await fetch(initResponse.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(videoSize),
          'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
          'Content-Type': 'video/mp4',
        },
        body: new Uint8Array(videoBuffer),
      });

      if (!uploadResponse.ok) {
        return createFailedPublicationResult(
          this.platform,
          await readResponseMessage(uploadResponse, 'TikTok upload transfer failed.'),
          initResponse.publishId
        );
      }

      const status = await this.fetchPublishStatus(connection.accessToken, initResponse.publishId);
      if (status === 'published') {
        return createPublishedResult(
          this.platform,
          initResponse.publishId,
          creatorInfo.accountLabel
            ? `TikTok accepted the upload for ${creatorInfo.accountLabel}.`
            : 'TikTok accepted the upload.'
        );
      }

      return createPendingProcessingResult(
        this.platform,
        initResponse.publishId,
        'TikTok accepted the upload and is still processing the post.'
      );
    } catch (error) {
      return createFailedPublicationResult(
        this.platform,
        error instanceof Error ? error.message : 'TikTok publishing failed.'
      );
    }
  }

  private isConfigured(): boolean {
    return Boolean(
      this.env.TIKTOK_CLIENT_KEY && this.env.TIKTOK_CLIENT_SECRET && this.env.TIKTOK_REDIRECT_URI
    );
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw badRequest('TikTok client credentials and redirect URI must be configured first.');
    }
  }

  private getStoredConnection(): TikTokConnectionRecord | null {
    const value = this.repository.getPlatformConnection<unknown>(this.platform);
    const accessToken = getNullableString(getRecordValue(value, 'accessToken'));
    if (!accessToken) {
      return null;
    }

    return {
      accessToken,
      refreshToken: getNullableString(getRecordValue(value, 'refreshToken')),
      expiresAt: getNullableString(getRecordValue(value, 'expiresAt')),
      refreshExpiresAt: getNullableString(getRecordValue(value, 'refreshExpiresAt')),
      connectedAt: getNullableString(getRecordValue(value, 'connectedAt')) ?? nowIso(),
      accountLabel: getNullableString(getRecordValue(value, 'accountLabel')),
      openId: getNullableString(getRecordValue(value, 'openId')),
      scopes: getStringList(getRecordValue(value, 'scopes')),
    };
  }

  private async exchangeAuthorizationCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    refreshExpiresAt: string | null;
    openId: string | null;
    scopes: string[];
  }> {
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_key: this.env.TIKTOK_CLIENT_KEY ?? '',
        client_secret: this.env.TIKTOK_CLIENT_SECRET ?? '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.env.TIKTOK_REDIRECT_URI ?? '',
      }),
    });

    if (!response.ok) {
      throw badRequest(await readResponseMessage(response, 'TikTok token exchange failed.'));
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const accessToken = getNullableString(payload.access_token);
    if (!accessToken) {
      throw badRequest('TikTok token exchange did not return an access token.');
    }

    return {
      accessToken,
      refreshToken: getNullableString(payload.refresh_token),
      expiresAt: toExpiryIso(payload.expires_in),
      refreshExpiresAt: toExpiryIso(payload.refresh_expires_in),
      openId: getNullableString(payload.open_id),
      scopes: normalizeCommaSeparatedScopes(getNullableString(payload.scope)),
    };
  }

  private async ensureFreshConnection(
    record: TikTokConnectionRecord
  ): Promise<TikTokConnectionRecord> {
    if (!isExpired(record.expiresAt)) {
      return record;
    }

    if (!record.refreshToken || isExpired(record.refreshExpiresAt)) {
      throw badRequest('The TikTok token expired and must be reconnected.');
    }

    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_key: this.env.TIKTOK_CLIENT_KEY ?? '',
        client_secret: this.env.TIKTOK_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
        refresh_token: record.refreshToken,
      }),
    });

    if (!response.ok) {
      throw badRequest(await readResponseMessage(response, 'TikTok token refresh failed.'));
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const updatedScopes = normalizeCommaSeparatedScopes(getNullableString(payload.scope));
    const updated: TikTokConnectionRecord = {
      ...record,
      accessToken: getNullableString(payload.access_token) ?? record.accessToken,
      refreshToken: getNullableString(payload.refresh_token) ?? record.refreshToken,
      expiresAt: toExpiryIso(payload.expires_in) ?? record.expiresAt,
      refreshExpiresAt: toExpiryIso(payload.refresh_expires_in) ?? record.refreshExpiresAt,
      scopes: updatedScopes.length > 0 ? updatedScopes : record.scopes,
    };

    this.repository.upsertPlatformConnection<TikTokConnectionRecord>(this.platform, updated);
    return updated;
  }

  private async queryCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
    const response = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      throw badRequest(await readResponseMessage(response, 'TikTok creator info query failed.'));
    }

    const payload = (await response.json()) as {
      data?: {
        creator_username?: string;
        privacy_level_options?: string[];
        comment_disabled?: boolean;
        duet_disabled?: boolean;
        stitch_disabled?: boolean;
      };
    };
    const privacyLevelOptions = payload.data?.privacy_level_options ?? [];

    return {
      accountLabel: getNullableString(payload.data?.creator_username),
      privacyLevel: privacyLevelOptions.includes('PUBLIC_TO_EVERYONE')
        ? 'PUBLIC_TO_EVERYONE'
        : (privacyLevelOptions[0] ?? 'SELF_ONLY'),
      disableComment: Boolean(payload.data?.comment_disabled),
      disableDuet: Boolean(payload.data?.duet_disabled),
      disableStitch: Boolean(payload.data?.stitch_disabled),
    };
  }

  private async initializeUpload(input: {
    accessToken: string;
    caption: string;
    creatorInfo: TikTokCreatorInfo;
    videoSize: number;
  }): Promise<{ publishId: string; uploadUrl: string }> {
    const response = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: input.caption,
          privacy_level: input.creatorInfo.privacyLevel,
          disable_comment: input.creatorInfo.disableComment,
          disable_duet: input.creatorInfo.disableDuet,
          disable_stitch: input.creatorInfo.disableStitch,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: input.videoSize,
          chunk_size: input.videoSize,
          total_chunk_count: 1,
        },
      }),
    });

    if (!response.ok) {
      throw badRequest(await readResponseMessage(response, 'TikTok upload initialization failed.'));
    }

    const payload = (await response.json()) as {
      data?: {
        publish_id?: string;
        upload_url?: string;
      };
    };
    const publishId = getNullableString(payload.data?.publish_id);
    const uploadUrl = getNullableString(payload.data?.upload_url);

    if (!publishId || !uploadUrl) {
      throw badRequest('TikTok upload initialization did not return publish metadata.');
    }

    return {
      publishId,
      uploadUrl,
    };
  }

  private async fetchPublishStatus(
    accessToken: string,
    publishId: string
  ): Promise<'published' | 'pending_processing'> {
    const response = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        publish_id: publishId,
      }),
    });

    if (!response.ok) {
      return 'pending_processing';
    }

    const payload = (await response.json()) as {
      data?: {
        status?: string;
        publish_status?: string;
        post_status?: string;
      };
    };
    const status =
      payload.data?.status ?? payload.data?.publish_status ?? payload.data?.post_status ?? '';

    return /complete|published|success/i.test(status) ? 'published' : 'pending_processing';
  }
}

function toExpiryIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return new Date(Date.now() + value * 1000).toISOString();
}

function normalizeCommaSeparatedScopes(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}
