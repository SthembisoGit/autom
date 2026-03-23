import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Platform } from '@autom/contracts';

import { badRequest } from '../lib/errors.js';

type OAuthStatePayload = {
  platform: Platform;
  issuedAt: string;
  nonce: string;
};

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function createOAuthState(secret: string, platform: Platform): string {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      platform,
      issuedAt: new Date().toISOString(),
      nonce: randomUUID(),
    } satisfies OAuthStatePayload)
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyOAuthState(secret: string, platform: Platform, state?: string): void {
  if (!state) {
    throw badRequest('Missing OAuth state.');
  }

  const [encodedPayload, signature] = state.split('.');
  if (!encodedPayload || !signature) {
    throw badRequest('OAuth state is invalid.');
  }

  const expectedSignature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw badRequest('OAuth state signature is invalid.');
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as OAuthStatePayload;
  } catch {
    throw badRequest('OAuth state payload is invalid.');
  }

  if (payload.platform !== platform) {
    throw badRequest('OAuth state platform mismatch.');
  }

  if (Date.now() - new Date(payload.issuedAt).getTime() > OAUTH_STATE_TTL_MS) {
    throw badRequest('OAuth state has expired.');
  }
}
