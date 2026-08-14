import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_POLICY, nextBackoffMs } from "../src/retry.js";

describe("retry backoff", () => {
  it("grows exponentially and caps at maxMs", () => {
    expect(nextBackoffMs(0)).toBe(1_000);
    expect(nextBackoffMs(1)).toBe(2_000);
    expect(nextBackoffMs(2)).toBe(4_000);
    expect(nextBackoffMs(10, { ...DEFAULT_RETRY_POLICY, maxAttempts: 20 })).toBe(
      DEFAULT_RETRY_POLICY.maxMs,
    );
  });

  it("returns null after maxAttempts so callers cannot loop forever", () => {
    expect(nextBackoffMs(DEFAULT_RETRY_POLICY.maxAttempts)).toBeNull();
    expect(nextBackoffMs(DEFAULT_RETRY_POLICY.maxAttempts + 5)).toBeNull();
  });
});
