import { createReadStream } from 'node:fs';

import type { AppEnv } from '@autom/config';
import type { GenerationJob, PlatformConnection, PublicationResult } from '@autom/contracts';
import { google } from 'googleapis';

import { badRequest } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import type { Publisher } from '../lib/types.js';
import type { AppRepository } from '../repositories/app-repository.js';
import {
  buildShortCaption,
  createConnectionSummary,
  createFailedPublicationResult,
  createPendingConfigurationResult,
  createPublishedResult,
  ensurePublishableArtifacts,
  fileExists,
  getNullableString,
  getRecordValue,
  getStringList,
  isExpired,
} from './common.js';
import { createOAuthState, verifyOAuthState } from './oauth-state.js';

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

type YoutubeConnectionRecord = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  connectedAt: string;
  accountLabel: string | null;
  channelId: string | null;
  scopes: string[];
};

export class YoutubePublisher implements Publisher {
  readonly platform = 'youtube' as const;

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
        message: 'Set YouTube client credentials and redirect URI before connecting.',
      });
    }

    const record = this.getStoredConnection();
    if (!record) {
      return createConnectionSummary({
        platform: this.platform,
        status: 'disconnected',
        configured: true,
        connected: false,
        message: 'No YouTube channel is connected.',
      });
    }

    const expired = isExpired(record.expiresAt) && !record.refreshToken;
    return createConnectionSummary({
      platform: this.platform,
      status: expired ? 'expired' : 'connected',
      configured: true,
      connected: !expired,
      accountLabel: record.accountLabel,
      connectedAt: record.connectedAt,
      expiresAt: record.expiresAt,
      message: expired ? 'The saved YouTube token expired and must be reconnected.' : null,
    });
  }

  async getAuthorizationUrl(): Promise<string> {
    this.assertConfigured();

    return this.createOAuthClient().generateAuthUrl({
      access_type: 'offline',
      include_granted_scopes: true,
      prompt: 'consent',
      scope: YOUTUBE_SCOPES,
      state: createOAuthState(this.env.SESSION_SECRET, this.platform),
    });
  }

  async completeAuthorization(input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<PlatformConnection> {
    this.assertConfigured();
    if (input.error) {
      throw badRequest(input.errorDescription ?? `YouTube authorization failed: ${input.error}.`);
    }

    verifyOAuthState(this.env.SESSION_SECRET, this.platform, input.state);
    if (!input.code) {
      throw badRequest('YouTube did not return an authorization code.');
    }

    const client = this.createOAuthClient();
    const tokenResponse = await client.getToken(input.code);
    if (!tokenResponse.tokens.access_token) {
      throw badRequest('YouTube did not return an access token.');
    }

    client.setCredentials(tokenResponse.tokens);
    const youtube = google.youtube({
      version: 'v3',
      auth: client,
    });
    const channelResponse = await youtube.channels.list({
      part: ['snippet'],
      mine: true,
      maxResults: 1,
    });
    const channel = channelResponse.data.items?.[0];

    this.repository.upsertPlatformConnection<YoutubeConnectionRecord>(this.platform, {
      accessToken: tokenResponse.tokens.access_token,
      refreshToken:
        tokenResponse.tokens.refresh_token ?? this.getStoredConnection()?.refreshToken ?? null,
      expiresAt: tokenResponse.tokens.expiry_date
        ? new Date(tokenResponse.tokens.expiry_date).toISOString()
        : null,
      connectedAt: nowIso(),
      accountLabel: channel?.snippet?.title ?? null,
      channelId: channel?.id ?? null,
      scopes: normalizeScopes(tokenResponse.tokens.scope),
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
        'YouTube client credentials are not configured yet.'
      );
    }

    const storedConnection = this.getStoredConnection();
    if (!storedConnection) {
      return createPendingConfigurationResult(
        this.platform,
        'Connect a YouTube channel before publishing.'
      );
    }

    try {
      const { videoPath, thumbnailPath } = ensurePublishableArtifacts(job);
      if (!(await fileExists(videoPath))) {
        return createFailedPublicationResult(
          this.platform,
          'The rendered video file is missing from disk and cannot be uploaded.'
        );
      }

      const client = this.createOAuthClient();
      client.setCredentials({
        access_token: storedConnection.accessToken,
        refresh_token: storedConnection.refreshToken ?? undefined,
        expiry_date: storedConnection.expiresAt
          ? new Date(storedConnection.expiresAt).getTime()
          : undefined,
      });
      client.on('tokens', (tokens) => {
        const currentRecord = this.getStoredConnection();
        if (!currentRecord) {
          return;
        }

        this.repository.upsertPlatformConnection<YoutubeConnectionRecord>(this.platform, {
          ...currentRecord,
          accessToken: tokens.access_token ?? currentRecord.accessToken,
          refreshToken: tokens.refresh_token ?? currentRecord.refreshToken,
          expiresAt: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : currentRecord.expiresAt,
        });
      });

      const youtube = google.youtube({
        version: 'v3',
        auth: client,
      });
      const uploadResponse = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: buildShortCaption(job, 100),
            description: job.scriptPackage?.description ?? job.topic,
            tags: job.scriptPackage?.tags ?? [],
          },
          status: {
            privacyStatus: 'public',
          },
        },
        media: {
          body: createReadStream(videoPath),
        },
      });

      const videoId = uploadResponse.data.id ?? null;
      if (!videoId) {
        return createFailedPublicationResult(
          this.platform,
          'YouTube did not return a video identifier after upload.'
        );
      }

      if (thumbnailPath && (await fileExists(thumbnailPath))) {
        await youtube.thumbnails
          .set({
            videoId,
            media: {
              body: createReadStream(thumbnailPath),
            },
          })
          .catch(() => undefined);
      }

      return createPublishedResult(
        this.platform,
        videoId,
        storedConnection.accountLabel
          ? `Published to YouTube channel ${storedConnection.accountLabel}.`
          : 'Published to YouTube.'
      );
    } catch (error) {
      return createFailedPublicationResult(
        this.platform,
        error instanceof Error ? error.message : 'YouTube publishing failed.'
      );
    }
  }

  private createOAuthClient() {
    return new google.auth.OAuth2(
      this.env.YOUTUBE_CLIENT_ID,
      this.env.YOUTUBE_CLIENT_SECRET,
      this.env.YOUTUBE_REDIRECT_URI
    );
  }

  private isConfigured(): boolean {
    return Boolean(
      this.env.YOUTUBE_CLIENT_ID && this.env.YOUTUBE_CLIENT_SECRET && this.env.YOUTUBE_REDIRECT_URI
    );
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw badRequest('YouTube client credentials and redirect URI must be configured first.');
    }
  }

  private getStoredConnection(): YoutubeConnectionRecord | null {
    const value = this.repository.getPlatformConnection<unknown>(this.platform);
    const accessToken = getNullableString(getRecordValue(value, 'accessToken'));
    if (!accessToken) {
      return null;
    }

    return {
      accessToken,
      refreshToken: getNullableString(getRecordValue(value, 'refreshToken')),
      expiresAt: getNullableString(getRecordValue(value, 'expiresAt')),
      connectedAt: getNullableString(getRecordValue(value, 'connectedAt')) ?? nowIso(),
      accountLabel: getNullableString(getRecordValue(value, 'accountLabel')),
      channelId: getNullableString(getRecordValue(value, 'channelId')),
      scopes: getStringList(getRecordValue(value, 'scopes')),
    };
  }
}

function normalizeScopes(scopeValue: string | null | undefined): string[] {
  if (!scopeValue) {
    return [];
  }

  return scopeValue
    .split(' ')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}
