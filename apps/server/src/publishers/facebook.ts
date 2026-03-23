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
  createPublishedResult,
  ensurePublishableArtifacts,
  fileExists,
  getNullableString,
  getRecordValue,
  isExpired,
  readFileBuffer,
  readResponseMessage,
} from './common.js';
import { createOAuthState, verifyOAuthState } from './oauth-state.js';

type FacebookConnectionRecord = {
  userAccessToken: string;
  userExpiresAt: string | null;
  pageAccessToken: string;
  connectedAt: string;
  accountLabel: string | null;
  pageId: string;
};

const GRAPH_API_VERSION = 'v25.0';

export class FacebookPublisher implements Publisher {
  readonly platform = 'facebook' as const;

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
        message: 'Set Meta app credentials, redirect URI, and target Page ID before connecting.',
      });
    }

    const record = this.getStoredConnection();
    if (!record) {
      return createConnectionSummary({
        platform: this.platform,
        status: 'disconnected',
        configured: true,
        connected: false,
        message: 'No Facebook Page connection is stored.',
      });
    }

    const expired = isExpired(record.userExpiresAt);
    return createConnectionSummary({
      platform: this.platform,
      status: expired ? 'expired' : 'connected',
      configured: true,
      connected: !expired,
      accountLabel: record.accountLabel,
      connectedAt: record.connectedAt,
      expiresAt: record.userExpiresAt,
      message: expired ? 'The Meta user token expired and must be reconnected.' : null,
    });
  }

  async getAuthorizationUrl(): Promise<string> {
    this.assertConfigured();

    const params = new URLSearchParams({
      client_id: this.env.META_APP_ID ?? '',
      redirect_uri: this.env.META_REDIRECT_URI ?? '',
      response_type: 'code',
      scope: 'pages_manage_posts,pages_show_list,pages_read_engagement,public_profile',
      state: createOAuthState(this.env.SESSION_SECRET, this.platform),
    });

    return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  async completeAuthorization(input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<PlatformConnection> {
    this.assertConfigured();
    if (input.error) {
      throw badRequest(input.errorDescription ?? `Meta authorization failed: ${input.error}.`);
    }

    verifyOAuthState(this.env.SESSION_SECRET, this.platform, input.state);
    if (!input.code) {
      throw badRequest('Meta did not return an authorization code.');
    }

    const shortLivedToken = await this.exchangeAuthorizationCode(input.code);
    const longLivedToken = await this.exchangeLongLivedToken(shortLivedToken.accessToken);
    const page = await this.resolvePage(longLivedToken.accessToken);

    this.repository.upsertPlatformConnection<FacebookConnectionRecord>(this.platform, {
      userAccessToken: longLivedToken.accessToken,
      userExpiresAt: longLivedToken.expiresAt,
      pageAccessToken: page.accessToken,
      connectedAt: nowIso(),
      accountLabel: page.name,
      pageId: page.id,
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
        'Meta app credentials or target Page ID are not configured yet.'
      );
    }

    const connection = this.getStoredConnection();
    if (!connection) {
      return createPendingConfigurationResult(
        this.platform,
        'Connect the target Facebook Page before publishing.'
      );
    }

    if (isExpired(connection.userExpiresAt)) {
      return createPendingConfigurationResult(
        this.platform,
        'The saved Meta token expired and must be reconnected before publishing.'
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

      const uploadForm = new FormData();
      uploadForm.set('access_token', connection.pageAccessToken);
      uploadForm.set('title', buildShortCaption(job, 100));
      uploadForm.set('description', job.scriptPackage?.description ?? job.topic);
      uploadForm.set(
        'source',
        new Blob([new Uint8Array(await readFileBuffer(videoPath))], { type: 'video/mp4' }),
        'video.mp4'
      );

      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${connection.pageId}/videos`,
        {
          method: 'POST',
          body: uploadForm,
        }
      );

      if (!response.ok) {
        return createFailedPublicationResult(
          this.platform,
          await readResponseMessage(response, 'Facebook Page publishing failed.')
        );
      }

      const payload = (await response.json()) as {
        id?: string;
      };
      const videoId = getNullableString(payload.id);
      if (!videoId) {
        return createFailedPublicationResult(
          this.platform,
          'Facebook did not return a video identifier after upload.'
        );
      }

      return createPublishedResult(
        this.platform,
        videoId,
        connection.accountLabel
          ? `Published to Facebook Page ${connection.accountLabel}.`
          : 'Published to Facebook.'
      );
    } catch (error) {
      return createFailedPublicationResult(
        this.platform,
        error instanceof Error ? error.message : 'Facebook publishing failed.'
      );
    }
  }

  private isConfigured(): boolean {
    return Boolean(
      this.env.META_APP_ID &&
        this.env.META_APP_SECRET &&
        this.env.META_REDIRECT_URI &&
        this.env.META_PAGE_ID
    );
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw badRequest('Meta app credentials, redirect URI, and Page ID must be configured first.');
    }
  }

  private getStoredConnection(): FacebookConnectionRecord | null {
    const value = this.repository.getPlatformConnection<unknown>(this.platform);
    const userAccessToken = getNullableString(getRecordValue(value, 'userAccessToken'));
    const pageAccessToken = getNullableString(getRecordValue(value, 'pageAccessToken'));
    const pageId = getNullableString(getRecordValue(value, 'pageId'));
    if (!userAccessToken || !pageAccessToken || !pageId) {
      return null;
    }

    return {
      userAccessToken,
      userExpiresAt: getNullableString(getRecordValue(value, 'userExpiresAt')),
      pageAccessToken,
      connectedAt: getNullableString(getRecordValue(value, 'connectedAt')) ?? nowIso(),
      accountLabel: getNullableString(getRecordValue(value, 'accountLabel')),
      pageId,
    };
  }

  private async exchangeAuthorizationCode(code: string): Promise<{
    accessToken: string;
  }> {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?${new URLSearchParams({
        client_id: this.env.META_APP_ID ?? '',
        client_secret: this.env.META_APP_SECRET ?? '',
        redirect_uri: this.env.META_REDIRECT_URI ?? '',
        code,
      }).toString()}`
    );

    if (!response.ok) {
      throw badRequest(
        await readResponseMessage(response, 'Meta short-lived token exchange failed.')
      );
    }

    const payload = (await response.json()) as {
      access_token?: string;
    };
    const accessToken = getNullableString(payload.access_token);
    if (!accessToken) {
      throw badRequest('Meta short-lived token exchange did not return an access token.');
    }

    return {
      accessToken,
    };
  }

  private async exchangeLongLivedToken(shortLivedToken: string): Promise<{
    accessToken: string;
    expiresAt: string | null;
  }> {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: this.env.META_APP_ID ?? '',
        client_secret: this.env.META_APP_SECRET ?? '',
        fb_exchange_token: shortLivedToken,
      }).toString()}`
    );

    if (!response.ok) {
      throw badRequest(
        await readResponseMessage(response, 'Meta long-lived token exchange failed.')
      );
    }

    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    const accessToken = getNullableString(payload.access_token);
    if (!accessToken) {
      throw badRequest('Meta long-lived token exchange did not return an access token.');
    }

    return {
      accessToken,
      expiresAt:
        typeof payload.expires_in === 'number'
          ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
          : null,
    };
  }

  private async resolvePage(userAccessToken: string): Promise<{
    id: string;
    name: string | null;
    accessToken: string;
  }> {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts?${new URLSearchParams({
        access_token: userAccessToken,
      }).toString()}`
    );

    if (!response.ok) {
      throw badRequest(await readResponseMessage(response, 'Unable to load Meta Page list.'));
    }

    const payload = (await response.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        access_token?: string;
      }>;
    };

    const page = payload.data?.find((entry) => entry.id === this.env.META_PAGE_ID);
    if (!page?.id || !page.access_token) {
      throw badRequest(
        `Configured Meta Page ${this.env.META_PAGE_ID} was not returned for the authenticated account.`
      );
    }

    return {
      id: page.id,
      name: getNullableString(page.name),
      accessToken: page.access_token,
    };
  }
}
