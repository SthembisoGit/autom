const RETRYABLE_FAILURE_PATTERNS = [
  /interrupted by a server restart/i,
  /retryable/i,
  /transient/i,
  /temporary/i,
  /timed out/i,
  /timeout/i,
  /download failed/i,
  /lookup failed/i,
  /render failed/i,
  /request failed/i,
  /network/i,
  /fetch failed/i,
  /socket hang up/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /aborted/i,
  /crash/i,
  /crashed/i,
  /outage/i,
  /service unavailable/i,
  /gateway timeout/i,
  /too many requests/i,
  /rate limit/i,
  /quota exceeded/i,
  /resource_exhausted/i,
  /duration budget/i,
  /regenerate the script/i,
];

const NON_RETRYABLE_FAILURE_PATTERNS = [
  /violates profile policy/i,
  /not found/i,
  /invalid request/i,
  /must be configured/i,
  /active job already exists/i,
  /disabled for scheduled execution/i,
  /not enabled for this deployment/i,
  /configured meta page/i,
  /cannot be approved/i,
  /cannot be rejected/i,
  /cannot be published/i,
  /authorization failed/i,
];

export function isRetryableFailureMessage(message: string): boolean {
  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    return false;
  }

  if (NON_RETRYABLE_FAILURE_PATTERNS.some((pattern) => pattern.test(normalizedMessage))) {
    return false;
  }

  return RETRYABLE_FAILURE_PATTERNS.some((pattern) => pattern.test(normalizedMessage));
}
