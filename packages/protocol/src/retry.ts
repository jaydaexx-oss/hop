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
 *
 * Pass a seeded `random` (0..1) for full jitter in [exp/2, exp]. Omit it for
 * deterministic delays used by tests.
 */
export function nextBackoffMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random?: () => number,
): number | null {
  if (attempt >= policy.maxAttempts) {
    return null;
  }
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** attempt);
  if (!random) return exp;
  const unit = random();
  const bounded = Number.isFinite(unit) ? Math.min(1, Math.max(0, unit)) : 0;
  return Math.floor(exp * (0.5 + 0.5 * bounded));
}
