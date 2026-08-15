// Ported from packages/protocol/src/retry.ts (jaydaexx-oss/hop)
// No bugs in this file — faithfully reproduced.

export interface RetryPolicy {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseMs: 1_000,
  maxMs: 5 * 60_000, // 5 minutes
  maxAttempts: 8,
};

/**
 * Exponential backoff without an infinite loop.
 * Returns null when retries are exhausted — callers MUST check for null
 * before scheduling another attempt.
 */
export function nextBackoffMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number | null {
  if (attempt >= policy.maxAttempts) return null;
  const exp = policy.baseMs * 2 ** attempt;
  return Math.min(policy.maxMs, exp);
}
