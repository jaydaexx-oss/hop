import { describe, expect, it } from "vitest";

import {
  IdentityError,
  assertIdentityPublishHasNoSecret,
  assertPublishedIdentityMatches,
  decideIdentityPublish,
  identityPublishBody,
  loadOrCreateIdentity,
  publishIdentityIfAllowed,
  replaceIdentityExplicit,
  type IdentityKeyPair,
  type SecretBackend,
} from "../src/identityLifecycle.js";
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
    let putCalls = 0;
    await expect(
      publishIdentityIfAllowed({
        localPublicKey: PAIR_A.publicKey,
        serverPublicKey: PAIR_B.publicKey,
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
    let putCalls = 0;
    await expect(
      publishIdentityIfAllowed({
        localPublicKey: PAIR_A.publicKey,
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
    let putCalls = 0;
    await expect(
      publishIdentityIfAllowed({
        localPublicKey: PAIR_A.publicKey,
        serverPublicKey: PAIR_A.publicKey,
        put: async () => {
          putCalls += 1;
        },
      }),
    ).resolves.toBe("skipped");
    expect(putCalls).toBe(0);
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
