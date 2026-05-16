/**
 * Exponential backoff retry utility.
 *
 * Wraps any async operation and retries it on failure with an exponentially
 * growing delay. Designed for transient API failures (network blips, 429 rate
 * limits, 503 service unavailable) — not for logic errors.
 *
 * Usage:
 *   const result = await withExponentialBackoff(
 *     () => someApiCall(),
 *     { maxAttempts: 2, baseDelayMs: 5_000, label: 'script generation' }
 *   );
 *
 * With maxAttempts: 2 and baseDelayMs: 5_000:
 *   Attempt 1: immediate
 *   Attempt 2: wait 5s (base * 2^0)
 *   → throws on second failure
 *
 * With maxAttempts: 3 and baseDelayMs: 2_000:
 *   Attempt 1: immediate
 *   Attempt 2: wait 2s
 *   Attempt 3: wait 4s
 *   → throws on third failure
 */

export interface RetryOptions {
  /** Maximum number of total attempts (including the first). Default: 2. */
  maxAttempts?: number;
  /** Base delay in milliseconds for the first retry. Doubles each attempt. Default: 5000. */
  baseDelayMs?: number;
  /** Human-readable label for logging. */
  label?: string;
  /** Optional predicate — if provided, only retry when this returns true. */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60_000;

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const label = options.label ?? 'operation';
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLast = attempt >= maxAttempts;
      if (isLast || !isRetryable(error)) {
        throw error;
      }

      const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt - 1), MAX_DELAY_MS);
      console.warn(
        `[retry] ${label} failed on attempt ${attempt}/${maxAttempts}. ` +
          `Retrying in ${delayMs}ms. Error: ${formatError(error)}`
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
}

function defaultIsRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  // Retry on network errors
  const message = (error as { message?: string }).message ?? '';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|network|fetch failed/i.test(message)) {
    return true;
  }

  // Retry on rate-limit and server errors (429, 500, 502, 503, 504)
  const status = (error as { status?: number; statusCode?: number }).status
    ?? (error as { status?: number; statusCode?: number }).statusCode;
  if (typeof status === 'number' && [429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  // Do NOT retry on auth errors (401, 403), schema validation errors, or cancellations
  if (typeof status === 'number' && [401, 403].includes(status)) {
    return false;
  }

  // Retry on generic API timeout errors from Gemini/OpenAI SDKs
  if (/timeout|timed out|rate limit/i.test(message)) {
    return true;
  }

  return false;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
