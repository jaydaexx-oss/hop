import { describe, expect, it } from "vitest";

import {
  HANDLE_HINT_KEY,
  USE_DIFFERENT_HANDLE_LABEL,
  clearHandleHint,
  formatPreviousHopLabel,
  handleFromCachedUser,
  handleHintIsAuthentication,
  onboardingModeForHandleHint,
  readHandleHint,
  shouldAutoStartRecoveryFromHandleHint,
  writeHandleHint,
  type NonSecretStore,
} from "../src/handleHint.js";

function memoryStore(): NonSecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async read(key) {
      return map.get(key) ?? null;
    },
    async write(key, value) {
      if (value) map.set(key, value);
      else map.delete(key);
    },
  };
}

describe("last-handle hint is non-secret UX only", () => {
  it("stores only a sanitized handle string", async () => {
    const store = memoryStore();
    await writeHandleHint(store, "Ada");
    expect(await readHandleHint(store)).toBe("ada");
    expect(store.map.get(HANDLE_HINT_KEY)).toBe("ada");
    expect(JSON.stringify([...store.map.entries()])).not.toMatch(/user_id|token|secret|publicKey/);
  });

  it("rejects JSON blobs, user_id, tokens, and keys", async () => {
    const store = memoryStore();
    await writeHandleHint(store, JSON.stringify({ username: "ada", id: "user-1", token: "secret" }));
    expect(await readHandleHint(store)).toBeNull();
    await writeHandleHint(store, "user-1");
    expect(await readHandleHint(store)).toBeNull();
    await writeHandleHint(store, "sk-SUPER-SECRET");
    expect(await readHandleHint(store)).toBeNull();
    await store.write(HANDLE_HINT_KEY, '{"username":"ada","id":"user-1"}');
    expect(await readHandleHint(store)).toBeNull();
  });

  it("copies the handle from a cached user object without user_id", () => {
    const cached = { username: "JayDae", id: "user-1", token: "nope" };
    expect(handleFromCachedUser(cached)).toBe("jaydae");
    expect(handleFromCachedUser({ username: "ada" })).toBe("ada");
    expect(handleFromCachedUser(null)).toBeNull();
    expect(handleFromCachedUser({ username: 12 })).toBeNull();
  });

  it("formats Previous HOP copy and Use a different handle", () => {
    expect(formatPreviousHopLabel("ada")).toBe("Previous HOP: @ada");
    expect(formatPreviousHopLabel("@Ada")).toBe("Previous HOP: @ada");
    expect(formatPreviousHopLabel("no")).toBe("");
    expect(USE_DIFFERENT_HANDLE_LABEL).toBe("Use a different handle");
  });

  it("clears the stored hint for a different handle", async () => {
    const store = memoryStore();
    await writeHandleHint(store, "ada");
    await clearHandleHint(store);
    expect(await readHandleHint(store)).toBeNull();
    expect(onboardingModeForHandleHint(null)).toBe("new_user");
  });

  it("shows returning-handle onboarding only when a hint exists", () => {
    expect(onboardingModeForHandleHint("ada")).toBe("returning_handle");
    expect(onboardingModeForHandleHint(null)).toBe("new_user");
    expect(onboardingModeForHandleHint("")).toBe("new_user");
  });

  it("is not authentication and does not auto-start recovery", () => {
    expect(handleHintIsAuthentication()).toBe(false);
    expect(shouldAutoStartRecoveryFromHandleHint()).toBe(false);
  });
});
