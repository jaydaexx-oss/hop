import { describe, expect, it } from "vitest";

import { generateIdentityKeyPair, type IdentityKeyPair } from "../src/cryptoBox.js";
import {
  DEVICE_SECRET_KEY,
  bindPendingIdentityToUser,
  loadOrCreatePendingIdentity,
  peekDeviceSecret,
  peekStoredIdentity,
  persistRestoredIdentity,
  readIdentityOwner,
  shouldSkipOnboarding,
  writeWrapKey,
  type SecretBackend,
} from "../src/identityLifecycle.js";
import {
  HANDLE_TAKEN_RECOVER_COPY,
  IDENTITY_RECOVERY_EXTENSION_POINTS,
  KEYS_MISSING_MESSAGE,
  canClaimHandleWithoutRecovery,
  onboardingActionForHandle,
  recoverExistingIdentity,
  recoveryMethodsFor,
  recoveryNotRequiredForOnboarding,
  restoreOriginalIdentity,
  unwrapIdentityMaterial,
  wrapIdentityMaterial,
  type RecoveryAuth,
  type RecoveryTransport,
} from "../src/identityRecovery.js";

function memoryBackend(): SecretBackend & { map: Map<string, string> } {
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

function auth(userId: string, username: string, publicKey?: string, token = "tok-rec"): RecoveryAuth {
  return { token, user: { id: userId, username, identity_public_key: publicKey } };
}

describe("handle uniqueness is not authentication", () => {
  it("does not require recovery for a new available handle", () => {
    expect(recoveryNotRequiredForOnboarding()).toBe(true);
    expect(canClaimHandleWithoutRecovery(true)).toBe(true);
    expect(onboardingActionForHandle(true)).toBe("start_hopping");
  });

  it("cannot claim a taken handle without recovery", () => {
    expect(canClaimHandleWithoutRecovery(false)).toBe(false);
    expect(onboardingActionForHandle(false)).toBe("recover");
    expect(HANDLE_TAKEN_RECOVER_COPY).toMatch(/already exists/i);
    expect(HANDLE_TAKEN_RECOVER_COPY).toMatch(/Recover it/i);
  });

  it("lists passkey and one-time password when those credentials exist", () => {
    expect(
      recoveryMethodsFor({
        username: "jaydae",
        available: false,
        passkey_enrolled: true,
        legacy_password: true,
      }),
    ).toEqual(["passkey", "legacy_password_once", "icloud_keychain"]);
    expect(IDENTITY_RECOVERY_EXTENSION_POINTS).toEqual([
      "passkey",
      "icloud_keychain",
      "legacy_password_once",
    ]);
  });
});

describe("restoreOriginalIdentity never mints a replacement pair", () => {
  it("restores hop.box.{userId} when the public key matches the server", async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    await persistRestoredIdentity("user-1", pair, backend);
    const restored = await restoreOriginalIdentity({
      userId: "user-1",
      serverPublicKey: pair.publicKey,
      backend,
    });
    expect(restored).toEqual({ status: "restored", pair, source: "keychain" });
  });

  it("refuses a local pair that does not match the published identity", async () => {
    const backend = memoryBackend();
    const local = await generateIdentityKeyPair();
    const server = await generateIdentityKeyPair();
    await persistRestoredIdentity("user-1", local, backend);
    const restored = await restoreOriginalIdentity({
      userId: "user-1",
      serverPublicKey: server.publicKey,
      backend,
    });
    expect(restored.status).toBe("mismatch");
    expect(await peekStoredIdentity("user-1", backend)).toEqual(local);
  });

  it("returns keys_missing instead of generating when the slot is empty", async () => {
    const backend = memoryBackend();
    const server = await generateIdentityKeyPair();
    const restored = await restoreOriginalIdentity({
      userId: "user-1",
      serverPublicKey: server.publicKey,
      backend,
    });
    expect(restored).toEqual({ status: "keys_missing" });
    expect(await peekStoredIdentity("user-1", backend)).toBeNull();
    expect(KEYS_MISSING_MESSAGE).toMatch(/doesn’t have your HOP keys/i);
  });

  it("unwraps a server blob with the Keychain wrap key and persists the original pair", async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    const wrap = await generateIdentityKeyPair();
    await writeWrapKey("user-1", wrap, backend);
    const blob = await wrapIdentityMaterial(pair, wrap);
    expect(blob).not.toContain(pair.secretKey);
    expect(await unwrapIdentityMaterial(blob, wrap)).toEqual(pair);

    const restored = await restoreOriginalIdentity({
      userId: "user-1",
      serverPublicKey: pair.publicKey,
      backend,
      wrappedBlob: blob,
    });
    expect(restored.status).toBe("restored");
    if (restored.status === "restored") {
      expect(restored.source).toBe("wrap");
      expect(restored.pair).toEqual(pair);
    }
    expect(await peekStoredIdentity("user-1", backend)).toEqual(pair);
  });
});

describe("recoverExistingIdentity", () => {
  function apiFor(
    existing: RecoveryAuth,
    opts: {
      passwordFails?: boolean;
      bindUserId?: string;
      wrapBlob?: string | null;
      registered?: { count: number };
    } = {},
  ): RecoveryTransport & { registered: number; boundSecrets: string[] } {
    const registered = opts.registered ?? { count: 0 };
    const boundSecrets: string[] = [];
    return {
      get registered() {
        return registered.count;
      },
      boundSecrets,
      async recoverPassword(username, password) {
        if (opts.passwordFails || password !== "ok-secret") {
          throw Object.assign(new Error("Invalid username or password"), { status: 401 });
        }
        expect(username).toBe(existing.user.username);
        return existing;
      },
      async passkeyAuthenticate() {
        return existing;
      },
      async bindDevice(_token, deviceSecret) {
        boundSecrets.push(deviceSecret);
        return {
          ...existing,
          token: "tok-bound",
          user: { ...existing.user, id: opts.bindUserId ?? existing.user.id },
        };
      },
      async logout() {
        return;
      },
      async getIdentityWrap() {
        return opts.wrapBlob ?? null;
      },
      async putIdentityWrap() {
        return;
      },
    };
  }

  it("restores the same user_id and original keys, then binds a device credential", async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    await persistRestoredIdentity("user-jay", pair, backend);
    backend.map.delete("hop.identity.userId");

    const existing = auth("user-jay", "jaydae", pair.publicKey);
    const api = apiFor(existing);
    const result = await recoverExistingIdentity(backend, api, "Jaydae", {
      method: "legacy_password_once",
      password: "ok-secret",
    });
    expect(result.user.id).toBe("user-jay");
    expect(result.user.username).toBe("jaydae");
    expect(await peekStoredIdentity("user-jay", backend)).toEqual(pair);
    expect(await readIdentityOwner(backend)).toBe("user-jay");
    expect(await peekDeviceSecret(backend)).toBeTruthy();
    expect(api.boundSecrets).toHaveLength(1);
    expect(api.registered).toBe(0);
  });

  it("does not register or persist identity when recovery credentials fail", async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    const api = apiFor(auth("user-jay", "jaydae", pair.publicKey), { passwordFails: true });
    await expect(
      recoverExistingIdentity(backend, api, "jaydae", {
        method: "legacy_password_once",
        password: "wrong",
      }),
    ).rejects.toThrow(/Invalid username or password/);
    expect(await peekStoredIdentity("user-jay", backend)).toBeNull();
    expect(await readIdentityOwner(backend)).toBeNull();
    expect(await peekDeviceSecret(backend)).toBeNull();
    expect(api.boundSecrets).toHaveLength(0);
  });

  it("does not mint keys or bind a device when Keychain has no original secret", async () => {
    const backend = memoryBackend();
    const server = await generateIdentityKeyPair();
    const api = apiFor(auth("user-jay", "jaydae", server.publicKey));
    await expect(
      recoverExistingIdentity(backend, api, "jaydae", {
        method: "legacy_password_once",
        password: "ok-secret",
      }),
    ).rejects.toMatchObject({ code: "KEYS_MISSING", message: KEYS_MISSING_MESSAGE });
    expect(await peekStoredIdentity("user-jay", backend)).toBeNull();
    expect(await readIdentityOwner(backend)).toBeNull();
    expect(api.boundSecrets).toHaveLength(0);
  });

  it("refuses to adopt a bind that swaps user_id", async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    await persistRestoredIdentity("user-jay", pair, backend);
    backend.map.delete("hop.identity.userId");
    const api = apiFor(auth("user-jay", "jaydae", pair.publicKey), { bindUserId: "user-OTHER" });
    await expect(
      recoverExistingIdentity(backend, api, "jaydae", {
        method: "legacy_password_once",
        password: "ok-secret",
      }),
    ).rejects.toMatchObject({ code: "KEY_MISMATCH" });
    expect(await peekDeviceSecret(backend)).toBeNull();
  });

  it("keeps a working device secret when the bind call fails", async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    await persistRestoredIdentity("user-jay", pair, backend);
    await backend.write(DEVICE_SECRET_KEY, "still-valid-device-secret-abcdefgh");

    const api = apiFor(auth("user-jay", "jaydae", pair.publicKey));
    api.bindDevice = async () => {
      throw Object.assign(new Error("network down"), { status: 503 });
    };

    await expect(
      recoverExistingIdentity(backend, api, "jaydae", {
        method: "legacy_password_once",
        password: "ok-secret",
      }),
    ).rejects.toThrow(/network down/);
    expect(await peekDeviceSecret(backend)).toBe("still-valid-device-secret-abcdefgh");
  });

  it("discards an unpublished pending pair instead of binding it to the recovered user", async () => {
    const backend = memoryBackend();
    const original = await generateIdentityKeyPair();
    const pending: IdentityKeyPair = await generateIdentityKeyPair();
    await persistRestoredIdentity("user-jay", original, backend);
    backend.map.delete("hop.identity.userId");
    await loadOrCreatePendingIdentity(backend, async () => pending);

    const api = apiFor(auth("user-jay", "jaydae", original.publicKey));
    await recoverExistingIdentity(backend, api, "jaydae", {
      method: "legacy_password_once",
      password: "ok-secret",
    });
    expect(await peekStoredIdentity("user-jay", backend)).toEqual(original);
    expect(await peekStoredIdentity("pending", backend)).toBeNull();
  });
});

describe("new-user onboarding is unchanged by recovery helpers", () => {
  it("still binds a pending pair for an available handle", async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    const pending = await loadOrCreatePendingIdentity(backend, async () => pair);
    const bound = await bindPendingIdentityToUser("user-new", backend);
    expect(bound).toEqual(pending);
    expect(await shouldSkipOnboarding(backend, false)).toBe(true);
    expect(await readIdentityOwner(backend)).toBe("user-new");
  });
});
