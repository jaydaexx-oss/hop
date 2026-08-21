import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  IdentityError,
  INSTALL_ID_KEY,
  assertIdentityPublishHasNoSecret,
  assertPublishedIdentityMatches,
  bindPendingIdentityToUser,
  clearLocalDeviceIdentity,
  decideIdentityPublish,
  eraseLocalIdentity,
  hashedInstallHeaderValue,
  hasExistingLocalIdentity,
  identityPublishBody,
  loadOrCreateDeviceSecret,
  loadOrCreateIdentity,
  loadOrCreateInstallId,
  loadOrCreatePendingIdentity,
  mustNotCreateNewAccount,
  peekDeviceSecret,
  peekStoredIdentity,
  peekWrapKey,
  publishIdentityIfAllowed,
  readIdentityOwner,
  replaceIdentityExplicit,
  resetAppSession,
  sha256Hex,
  shouldSkipOnboarding,
  writeIdentityOwner,
  writeWrapKey,
  type IdentityKeyPair,
  type SecretBackend,
} from "../src/identityLifecycle.js";
import { HANDLE_HINT_KEY } from "../src/handleHint.js";
import { readWithSecretPolicy, shouldFailClosedSecretStore, writeWithSecretPolicy } from "../src/secretPolicy.js";

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

const PAIR_A: IdentityKeyPair = { publicKey: "pk-aaa", secretKey: "sk-SUPER-SECRET-AAA" };
const PAIR_B: IdentityKeyPair = { publicKey: "pk-bbb", secretKey: "sk-SUPER-SECRET-BBB" };

describe("identity lifecycle", () => {
  it("putIdentity body only contains the public key", () => {
    const body = identityPublishBody(PAIR_A.publicKey);
    expect(Object.keys(body)).toEqual(["public_key"]);
    expect(body.public_key).toBe(PAIR_A.publicKey);
    expect(JSON.stringify(body)).not.toContain(PAIR_A.secretKey);
    expect(JSON.stringify(body)).not.toContain("secret");
    assertIdentityPublishHasNoSecret(body as Record<string, unknown>, PAIR_A.secretKey);
    expect(() =>
      assertIdentityPublishHasNoSecret({ public_key: PAIR_A.publicKey, secret_key: PAIR_A.secretKey }, PAIR_A.secretKey),
    ).toThrow(/never enter an API payload/i);
  });

  it("creates an identity on first launch and reloads the same pair", async () => {
    const backend = memoryBackend();
    let generated = 0;
    const generate = async () => {
      generated += 1;
      return PAIR_A;
    };
    const first = await loadOrCreateIdentity("user-1", backend, generate);
    const second = await loadOrCreateIdentity("user-1", backend, generate);
    expect(first).toEqual(PAIR_A);
    expect(second).toEqual(PAIR_A);
    expect(generated).toBe(1);
    expect(backend.map.get("hop.box.marker.user-1")).toBe(PAIR_A.publicKey);
  });

  it("does not silently regenerate when the marker exists but the secret is missing", async () => {
    const backend = memoryBackend();
    await backend.write("hop.box.marker.user-1", PAIR_A.publicKey);
    let generated = 0;
    await expect(
      loadOrCreateIdentity("user-1", backend, async () => {
        generated += 1;
        return PAIR_B;
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_INACCESSIBLE", name: "IdentityError" });
    expect(generated).toBe(0);
  });

  it("does not silently regenerate a corrupt stored identity", async () => {
    const backend = memoryBackend();
    await backend.write("hop.box.user-1", "{not-json");
    await expect(loadOrCreateIdentity("user-1", backend, async () => PAIR_B)).rejects.toMatchObject({
      code: "IDENTITY_INACCESSIBLE",
    });
  });

  it("surfaces KEY_MISMATCH instead of publishing over a different server key", () => {
    expect(() => assertPublishedIdentityMatches(PAIR_A.publicKey, PAIR_B.publicKey)).toThrow(IdentityError);
    try {
      assertPublishedIdentityMatches(PAIR_A.publicKey, PAIR_B.publicKey);
    } catch (err) {
      expect(err).toBeInstanceOf(IdentityError);
      expect((err as IdentityError).code).toBe("KEY_MISMATCH");
    }
    expect(() => assertPublishedIdentityMatches(PAIR_A.publicKey, PAIR_A.publicKey)).not.toThrow();
    expect(() => assertPublishedIdentityMatches(PAIR_A.publicKey, "")).not.toThrow();
  });

  it("replaceIdentityExplicit is the only path that creates a new pair after one exists", async () => {
    const backend = memoryBackend();
    await loadOrCreateIdentity("user-1", backend, async () => PAIR_A);
    const rotated = await replaceIdentityExplicit("user-1", backend, async () => PAIR_B);
    expect(rotated).toEqual(PAIR_B);
    const loaded = await loadOrCreateIdentity("user-1", backend, async () => {
      throw new Error("must not generate");
    });
    expect(loaded).toEqual(PAIR_B);
  });

  it("does not PUT when the server already has a different key", async () => {
    const a = await (await import("../src/cryptoBox.js")).generateIdentityKeyPair();
    const b = await (await import("../src/cryptoBox.js")).generateIdentityKeyPair();
    let putCalls = 0;
    await expect(
      publishIdentityIfAllowed({
        localPublicKey: a.publicKey,
        serverPublicKey: b.publicKey,
        put: async () => {
          putCalls += 1;
        },
      }),
    ).rejects.toMatchObject({ code: "KEY_MISMATCH" });
    expect(putCalls).toBe(0);
    expect(decideIdentityPublish(PAIR_A.publicKey, PAIR_B.publicKey)).toBe("mismatch");
    expect(decideIdentityPublish(PAIR_A.publicKey, PAIR_A.publicKey)).toBe("skip");
    expect(decideIdentityPublish(PAIR_A.publicKey, "")).toBe("publish");
  });

  it("maps HTTP 409 to SERVER_KEY_LOCKED and does not retry", async () => {
    const a = await (await import("../src/cryptoBox.js")).generateIdentityKeyPair();
    let putCalls = 0;
    await expect(
      publishIdentityIfAllowed({
        localPublicKey: a.publicKey,
        serverPublicKey: "",
        put: async () => {
          putCalls += 1;
          const err = new Error("conflict") as Error & { status: number };
          err.status = 409;
          throw err;
        },
      }),
    ).rejects.toMatchObject({ code: "SERVER_KEY_LOCKED", name: "IdentityError" });
    expect(putCalls).toBe(1);
  });

  it("skips PUT when the published key already matches", async () => {
    const a = await (await import("../src/cryptoBox.js")).generateIdentityKeyPair();
    let putCalls = 0;
    await expect(
      publishIdentityIfAllowed({
        localPublicKey: a.publicKey,
        serverPublicKey: a.publicKey,
        put: async () => {
          putCalls += 1;
        },
      }),
    ).resolves.toBe("skipped");
    expect(putCalls).toBe(0);
  });

  it("refuses to publish a malformed public key", async () => {
    await expect(
      publishIdentityIfAllowed({
        localPublicKey: "not-a-key",
        serverPublicKey: "",
        put: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "KEY_MISMATCH" });
  });
});

describe("secret store fail-closed policy", () => {
  it("fails closed in production and allows a memory fallback in tests/dev", () => {
    expect(shouldFailClosedSecretStore({ isDev: false })).toBe(true);
    expect(shouldFailClosedSecretStore({ nodeEnv: "production" })).toBe(true);
    expect(shouldFailClosedSecretStore({ forceFailClosed: true })).toBe(true);
    expect(shouldFailClosedSecretStore({ isDev: true, nodeEnv: "test" })).toBe(false);
    expect(shouldFailClosedSecretStore({ isDev: false, allowMemoryFallback: true })).toBe(false);
  });

  it("throws SECRET_STORE_UNAVAILABLE when SecureStore is missing in production", async () => {
    const memory = new Map<string, string>();
    await expect(
      readWithSecretPolicy({ backend: null, memory, key: "hop.box.user", failClosed: true }),
    ).rejects.toMatchObject({ code: "SECRET_STORE_UNAVAILABLE" });
    await expect(
      writeWithSecretPolicy({ backend: null, memory, key: "hop.box.user", value: "secret", failClosed: true }),
    ).rejects.toMatchObject({ code: "SECRET_STORE_UNAVAILABLE" });
    expect(memory.size).toBe(0);
  });

  it("throws when the backend fails in production instead of copying secrets into RAM", async () => {
    const memory = new Map<string, string>();
    const backend: SecretBackend = {
      async read() {
        throw new Error("keychain locked");
      },
      async write() {
        throw new Error("keychain locked");
      },
    };
    await expect(
      readWithSecretPolicy({ backend, memory, key: "k", failClosed: true }),
    ).rejects.toMatchObject({ code: "SECRET_STORE_UNAVAILABLE" });
    await expect(
      writeWithSecretPolicy({ backend, memory, key: "k", value: "v", failClosed: true }),
    ).rejects.toMatchObject({ code: "SECRET_STORE_UNAVAILABLE" });
    expect(memory.size).toBe(0);
  });
});

describe("device-based onboarding identity binding", () => {
  it("reuses pending keys and does not generate a second pair after bind", async () => {
    const backend = memoryBackend();
    let generated = 0;
    const generate = async () => {
      generated += 1;
      return PAIR_A;
    };
    const pending = await loadOrCreatePendingIdentity(backend, generate);
    const again = await loadOrCreatePendingIdentity(backend, async () => PAIR_B);
    expect(pending).toEqual(PAIR_A);
    expect(again).toEqual(PAIR_A);
    expect(generated).toBe(1);

    const bound = await bindPendingIdentityToUser("user-1", backend);
    expect(bound).toEqual(PAIR_A);
    expect(await readIdentityOwner(backend)).toBe("user-1");
    expect(await peekStoredIdentity("user-1", backend)).toEqual(PAIR_A);
    expect(await peekStoredIdentity("pending", backend)).toBeNull();

    const reloaded = await loadOrCreateIdentity("user-1", backend, async () => PAIR_B);
    expect(reloaded).toEqual(PAIR_A);
    expect(generated).toBe(1);
  });

  it("does not create a new identity when an owner already exists", async () => {
    const backend = memoryBackend();
    await loadOrCreateIdentity("user-1", backend, async () => PAIR_A);
    await writeIdentityOwner("user-1", backend);
    expect(await hasExistingLocalIdentity(backend)).toBe(true);
    expect(mustNotCreateNewAccount(true)).toBe(true);
    expect(await shouldSkipOnboarding(backend, false)).toBe(true);

    const loaded = await loadOrCreatePendingIdentity(backend, async () => PAIR_B);
    expect(loaded).toEqual(PAIR_A);
    await expect(bindPendingIdentityToUser("user-1", backend)).resolves.toEqual(PAIR_A);
  });

  it("refuses to overwrite existing user_id keys with a different pending pair", async () => {
    const backend = memoryBackend();
    await loadOrCreateIdentity("user-1", backend, async () => PAIR_A);
    await loadOrCreateIdentity("pending", backend, async () => PAIR_B);
    await expect(bindPendingIdentityToUser("user-1", backend)).rejects.toMatchObject({
      code: "KEY_MISMATCH",
    });
    expect(await peekStoredIdentity("user-1", backend)).toEqual(PAIR_A);
  });

  it("reuses a device secret and never derives it from the handle", async () => {
    const backend = memoryBackend();
    const first = await loadOrCreateDeviceSecret(backend);
    const second = await loadOrCreateDeviceSecret(backend);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(first.toLowerCase()).not.toContain("alice");
  });

  it("skips onboarding when a session user already exists", async () => {
    const backend = memoryBackend();
    expect(await shouldSkipOnboarding(backend, true)).toBe(true);
    expect(await shouldSkipOnboarding(backend, false)).toBe(false);
  });

  it("keeps hop.install.id across local reset and hashes it for the register header", async () => {
    const backend = memoryBackend();
    const installId = await loadOrCreateInstallId(backend);
    expect(installId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const header = await hashedInstallHeaderValue(backend);
    expect(header).toMatch(/^[0-9a-f]{64}$/);
    expect(header).not.toBe(installId);
    await loadOrCreateIdentity("user-1", backend, async () => PAIR_A);
    await writeIdentityOwner("user-1", backend);
    await loadOrCreateDeviceSecret(backend);
    await backend.write(HANDLE_HINT_KEY, "ada");
    await eraseLocalIdentity(backend);
    expect(await backend.read(INSTALL_ID_KEY)).toBe(installId);
    expect(await hashedInstallHeaderValue(backend)).toBe(header);
    expect(await loadOrCreateInstallId(backend)).toBe(installId);
    expect(await backend.read(HANDLE_HINT_KEY)).toBe("ada");
  });

  const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

  type HopCrypto = Crypto & { digestStringAsync?: (algorithm: string, data: string) => Promise<string> };

  function nodeSha256Hex(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  function withHermesSha256(run: () => Promise<void>): Promise<void> {
    const cryptoObj = globalThis.crypto as HopCrypto;
    const originalSubtle = cryptoObj.subtle;
    const originalDigest = cryptoObj.digestStringAsync;
    Object.defineProperty(cryptoObj, "subtle", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(cryptoObj, "digestStringAsync", {
      value: async (algorithm: string, data: string) => {
        if (algorithm !== "SHA-256") throw new Error(`unsupported ${algorithm}`);
        return nodeSha256Hex(data);
      },
      configurable: true,
      writable: true,
    });
    return run().finally(() => {
      Object.defineProperty(cryptoObj, "subtle", {
        value: originalSubtle,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(cryptoObj, "digestStringAsync", {
        value: originalDigest,
        configurable: true,
        writable: true,
      });
    });
  }

  it("hashes hop.install.id as lowercase SHA-256 hex for X-Hop-Install", async () => {
    const backend = memoryBackend();
    const installId = await loadOrCreateInstallId(backend);
    const header = await hashedInstallHeaderValue(backend);
    expect(header).toBe(await sha256Hex(installId));
    expect(header).toBe(nodeSha256Hex(installId));
    expect(header).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("abc")).toBe(SHA256_ABC);
  });

  it("hashes with expo-crypto digestStringAsync when crypto.subtle is missing", async () => {
    await withHermesSha256(async () => {
      expect(globalThis.crypto.subtle).toBeUndefined();
      expect(typeof (globalThis.crypto as HopCrypto).digestStringAsync).toBe("function");
      expect(typeof globalThis.crypto.getRandomValues).toBe("function");
      expect(await sha256Hex("abc")).toBe(SHA256_ABC);

      const backend = memoryBackend();
      const installId = await loadOrCreateInstallId(backend);
      const header = await hashedInstallHeaderValue(backend);
      expect(header).toBe(nodeSha256Hex(installId));
      expect(header).toMatch(/^[0-9a-f]{64}$/);
      expect(header).not.toBe(installId);
    });
  });

  it("throws when SHA-256 is missing and does not use a string hash fallback", async () => {
    const cryptoObj = globalThis.crypto as HopCrypto;
    const originalSubtle = cryptoObj.subtle;
    const originalDigest = cryptoObj.digestStringAsync;
    Object.defineProperty(cryptoObj, "subtle", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(cryptoObj, "digestStringAsync", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const spy = vi.spyOn(Math, "random");
    try {
      await expect(sha256Hex("abc")).rejects.toThrow(/SHA-256 is unavailable on this runtime/);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      Object.defineProperty(cryptoObj, "subtle", {
        value: originalSubtle,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(cryptoObj, "digestStringAsync", {
        value: originalDigest,
        configurable: true,
        writable: true,
      });
    }
  });

  it("mints hop.install.id from getRandomValues when crypto.randomUUID is missing", async () => {
    const cryptoObj = globalThis.crypto;
    const original = cryptoObj.randomUUID;
    Object.defineProperty(cryptoObj, "randomUUID", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const backend = memoryBackend();
      const installId = await loadOrCreateInstallId(backend);
      expect(installId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(await loadOrCreateInstallId(backend)).toBe(installId);
    } finally {
      Object.defineProperty(cryptoObj, "randomUUID", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it("session reset preserves identity ownership; erase wipes keys but keeps install id", async () => {
    const backend = memoryBackend();
    await loadOrCreateIdentity("user-1", backend, async () => PAIR_A);
    await writeIdentityOwner("user-1", backend);
    await writeWrapKey("user-1", PAIR_B, backend);
    const deviceSecret = await loadOrCreateDeviceSecret(backend);
    const installId = await loadOrCreateInstallId(backend);
    await loadOrCreateIdentity("pending", backend, async () => PAIR_B);

    await resetAppSession(backend);

    expect(await readIdentityOwner(backend)).toBe("user-1");
    expect(await peekStoredIdentity("user-1", backend)).toEqual(PAIR_A);
    expect(await backend.read("hop.box.marker.user-1")).toBe(PAIR_A.publicKey);
    expect(await peekWrapKey("user-1", backend)).toEqual(PAIR_B);
    expect(await peekDeviceSecret(backend)).toBe(deviceSecret);
    expect(await backend.read(INSTALL_ID_KEY)).toBe(installId);
    expect(await peekStoredIdentity("pending", backend)).toBeNull();
    expect(await hasExistingLocalIdentity(backend)).toBe(true);
    expect(await shouldSkipOnboarding(backend, false)).toBe(true);

    await eraseLocalIdentity(backend);

    expect(await readIdentityOwner(backend)).toBeNull();
    expect(await peekStoredIdentity("user-1", backend)).toBeNull();
    expect(await peekWrapKey("user-1", backend)).toBeNull();
    expect(await peekDeviceSecret(backend)).toBeNull();
    expect(await backend.read(INSTALL_ID_KEY)).toBe(installId);
    expect(await hasExistingLocalIdentity(backend)).toBe(false);
    expect(await shouldSkipOnboarding(backend, false)).toBe(false);
  });

  it("clears local identity so a later first-launch can mint a new pair", async () => {
    const backend = memoryBackend();
    await loadOrCreateIdentity("user-1", backend, async () => PAIR_A);
    await writeIdentityOwner("user-1", backend);
    await loadOrCreateDeviceSecret(backend);
    await loadOrCreateIdentity("pending", backend, async () => PAIR_B);

    await clearLocalDeviceIdentity(backend);

    expect(await readIdentityOwner(backend)).toBeNull();
    expect(await peekStoredIdentity("user-1", backend)).toBeNull();
    expect(await peekStoredIdentity("pending", backend)).toBeNull();
    expect(await hasExistingLocalIdentity(backend)).toBe(false);
    expect(await shouldSkipOnboarding(backend, false)).toBe(false);

    let generated = 0;
    const next = await loadOrCreatePendingIdentity(backend, async () => {
      generated += 1;
      return PAIR_B;
    });
    expect(next).toEqual(PAIR_B);
    expect(generated).toBe(1);
  });
});
