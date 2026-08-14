export interface RetryPolicy {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseMs: 1_000,
  maxMs: 5 * 60_000,
  maxAttempts: 8,
};

/**
 * Exponential backoff without an infinite loop.
 * Returns null when retries are exhausted.
 */
export function nextBackoffMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number | null {
  if (attempt >= policy.maxAttempts) {
    return null;
  }
  const exp = policy.baseMs * 2 ** attempt;
  return Math.min(policy.maxMs, exp);
}
