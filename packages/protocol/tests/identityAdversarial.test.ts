import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HopSqliteStore,
  IdentityError,
  PublicKeyTofu,
  generateIdentityKeyPair,
  isWellFormedBoxPublicKey,
  loadOrCreateIdentity,
  publishIdentityIfAllowed,
  sqlitePeerTrustPersistence,
  type SecretBackend,
} from "../src/index.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

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

describe("identity adversarial properties", () => {
  it("does not silently regenerate a lost identity (no impersonation)", async () => {
    const backend = memoryBackend();
    const first = await loadOrCreateIdentity("alice", backend, generateIdentityKeyPair);
    backend.map.delete("hop.box.alice");
    expect(backend.map.get("hop.box.marker.alice")).toBe(first.publicKey);
    let generated = 0;
    await expect(
      loadOrCreateIdentity("alice", backend, async () => {
        generated += 1;
        return generateIdentityKeyPair();
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_INACCESSIBLE", name: "IdentityError" });
    expect(generated).toBe(0);
  });

  it("treats a changed peer key as KEY_CHANGED and keeps the original fingerprint", async () => {
    const a = await generateIdentityKeyPair();
    const b = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    expect(tofu.observe("blake", a.publicKey)).toBe("TOFU_TRUSTED");
    expect(tofu.observe("blake", b.publicKey)).toBe("KEY_CHANGED");
    expect(tofu.get("blake")).toBe(a.publicKey);
    expect(tofu.bind("blake", b.publicKey)).toBe(false);
    expect(tofu.canEncryptTo("blake", b.publicKey)).toBe(false);
  });

  it("detects rollback to an older pending key as KEY_CHANGED", async () => {
    const original = await generateIdentityKeyPair();
    const newer = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    tofu.observe("blake", original.publicKey);
    tofu.observe("blake", newer.publicKey);
    expect(tofu.observe("blake", original.publicKey)).toBe("KEY_CHANGED");
    expect(tofu.get("blake")).toBe(original.publicKey);
    expect(tofu.bind("blake", newer.publicKey)).toBe(false);
  });

  it("persists a trusted fingerprint across a SQLite restart", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hop-id-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "hop.db");
    const pair = await generateIdentityKeyPair();
    const driver1 = await SqlJsDriver.open(file);
    const store1 = new HopSqliteStore(driver1);
    await store1.init();
    const first = new PublicKeyTofu(sqlitePeerTrustPersistence(store1));
    first.observe("blake", pair.publicKey);
    await new Promise((r) => setTimeout(r, 10));
    driver1.close();

    const driver2 = await SqlJsDriver.open(file);
    const store2 = new HopSqliteStore(driver2);
    await store2.init();
    const second = new PublicKeyTofu(sqlitePeerTrustPersistence(store2));
    await second.hydrate();
    expect(second.state("blake")).toBe("TOFU_TRUSTED");
    expect(second.get("blake")).toBe(pair.publicKey);
    const evil = await generateIdentityKeyPair();
    expect(second.observe("blake", evil.publicKey)).toBe("KEY_CHANGED");
    expect(second.get("blake")).toBe(pair.publicKey);
  });

  it("rejects a malformed public key on the client publish path", async () => {
    expect(isWellFormedBoxPublicKey("short")).toBe(false);
    expect(isWellFormedBoxPublicKey("%%%")).toBe(false);
    expect(isWellFormedBoxPublicKey("AAA\nAAA")).toBe(false);
    const ok = await generateIdentityKeyPair();
    expect(isWellFormedBoxPublicKey(ok.publicKey)).toBe(true);
    await expect(
      publishIdentityIfAllowed({
        localPublicKey: "AAAA",
        serverPublicKey: "",
        put: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it("rejects cross-account public key substitution in TOFU", async () => {
    const shared = await generateIdentityKeyPair();
    const other = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    expect(tofu.observe("alice", shared.publicKey)).toBe("TOFU_TRUSTED");
    expect(tofu.bind("mallory", shared.publicKey)).toBe(false);
    expect(tofu.state("alice")).toBe("TOFU_TRUSTED");
    expect(tofu.get("alice")).toBe(shared.publicKey);
    expect(tofu.observe("mallory", other.publicKey)).toBe("TOFU_TRUSTED");
  });

  it("does not PUT a replacement when the server key differs (no silent server swap)", async () => {
    const local = await generateIdentityKeyPair();
    const server = await generateIdentityKeyPair();
    let puts = 0;
    await expect(
      publishIdentityIfAllowed({
        localPublicKey: local.publicKey,
        serverPublicKey: server.publicKey,
        put: async () => {
          puts += 1;
        },
      }),
    ).rejects.toMatchObject({ code: "KEY_MISMATCH" });
    expect(puts).toBe(0);
  });
});
