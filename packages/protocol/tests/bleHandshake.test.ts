import { describe, expect, it } from "vitest";

import {
  BLE_HANDSHAKE_DOWNGRADE,
  BLE_HANDSHAKE_MAX_SKEW_MS,
  BleHandshakeExchange,
  HandshakeReplayGuard,
  PublicKeyTofu,
  bleSessionStale,
  decodeAuthenticatedHandshake,
  decodeHandshakeAnnouncement,
  encodeAuthenticatedHandshake,
  encodeHandshake,
  generateIdentityKeyPair,
  handshakeDowngradeReason,
  verifyAuthenticatedHandshake,
} from "../src/index.js";

describe("authenticated BLE handshake (no radio)", () => {
  it("establishes a session when both sides prove possession of their box secrets", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const a = await BleHandshakeExchange.create(alice, "alice-id", "alice");
    const b = await BleHandshakeExchange.create(blake, "blake-id", "blake");
    const announced = decodeHandshakeAnnouncement(b.announcement());
    expect(announced?.pk).toBe(blake.publicKey);

    const tofu = new PublicKeyTofu();
    const replay = new HandshakeReplayGuard();
    const fromBlake = await b.proveTo(alice.publicKey);
    const verified = await verifyAuthenticatedHandshake({
      raw: fromBlake,
      local: alice,
      replay,
      tofu,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.handshake.pk).toBe(blake.publicKey);
      expect(verified.handshake.peer_pk).toBe(alice.publicKey);
    }
    expect(tofu.state("blake-id")).toBe("TOFU_TRUSTED");
  });

  it("rejects a replayed authenticated handshake", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const b = await BleHandshakeExchange.create(blake, "blake-id", "blake");
    const proof = await b.proveTo(alice.publicKey);
    const replay = new HandshakeReplayGuard();
    expect((await verifyAuthenticatedHandshake({ raw: proof, local: alice, replay })).ok).toBe(true);
    expect((await verifyAuthenticatedHandshake({ raw: proof, local: alice, replay })).ok).toBe(false);
    expect((await verifyAuthenticatedHandshake({ raw: proof, local: alice, replay })).reason).toBe("replay");
  });

  it("rejects a stale timestamp", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const old = Date.now() - BLE_HANDSHAKE_MAX_SKEW_MS - 1_000;
    const proof = await encodeAuthenticatedHandshake({
      local: blake,
      userId: "blake-id",
      username: "blake",
      nonce: "nonce-stale",
      ts: old,
      peerPublicKey: alice.publicKey,
    });
    const result = await verifyAuthenticatedHandshake({
      raw: proof,
      local: alice,
      replay: new HandshakeReplayGuard(),
      now: Date.now(),
    });
    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects malformed and truncated handshakes", async () => {
    const alice = await generateIdentityKeyPair();
    const replay = new HandshakeReplayGuard();
    expect((await verifyAuthenticatedHandshake({ raw: "{", local: alice, replay })).reason).toBe("malformed");
    expect((await verifyAuthenticatedHandshake({ raw: "{}", local: alice, replay })).reason).toBe("malformed");
    expect((await verifyAuthenticatedHandshake({ raw: "not-json", local: alice, replay })).reason).toBe("malformed");
  });

  it("rejects a v1/v2 plaintext handshake (downgrade)", async () => {
    const alice = await generateIdentityKeyPair();
    const v2 = encodeHandshake({ v: 2, user_id: "u", username: "n", pk: alice.publicKey, n: "nonce" });
    expect(handshakeDowngradeReason(v2)).toBe("downgrade");
    expect(decodeAuthenticatedHandshake(v2)).toBeNull();
    const result = await verifyAuthenticatedHandshake({
      raw: v2,
      local: alice,
      replay: new HandshakeReplayGuard(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("downgrade");
    expect(BLE_HANDSHAKE_DOWNGRADE).toMatch(/not accepted/i);
  });

  it("refuses KEY_CHANGED instead of trusting a new identity", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const impostor = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    tofu.observe("blake-id", blake.publicKey);
    const proof = await encodeAuthenticatedHandshake({
      local: impostor,
      userId: "blake-id",
      username: "blake",
      nonce: "n1",
      ts: Date.now(),
      peerPublicKey: alice.publicKey,
    });
    const result = await verifyAuthenticatedHandshake({
      raw: proof,
      local: alice,
      replay: new HandshakeReplayGuard(),
      tofu,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("key_changed");
    expect(tofu.get("blake-id")).toBe(blake.publicKey);
  });

  it("rejects a MAC computed with the wrong secret", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const mallory = await generateIdentityKeyPair();
    const spoofed = await encodeAuthenticatedHandshake({
      local: mallory,
      userId: "blake-id",
      username: "blake",
      nonce: "n1",
      ts: Date.now(),
      peerPublicKey: alice.publicKey,
    });
    const tampered = JSON.parse(spoofed) as { pk: string; auth: string };
    tampered.pk = blake.publicKey;
    const result = await verifyAuthenticatedHandshake({
      raw: JSON.stringify(tampered),
      local: alice,
      replay: new HandshakeReplayGuard(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_mac");
  });

  it("rejects a proof bound to the wrong local peer_pk", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const carol = await generateIdentityKeyPair();
    const proof = await encodeAuthenticatedHandshake({
      local: blake,
      userId: "blake-id",
      username: "blake",
      nonce: "n1",
      ts: Date.now(),
      peerPublicKey: carol.publicKey,
    });
    const result = await verifyAuthenticatedHandshake({
      raw: proof,
      local: alice,
      replay: new HandshakeReplayGuard(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("peer_mismatch");
  });

  it("treats an idle session as stale", () => {
    expect(bleSessionStale(1_000, 1_000 + 121_000)).toBe(true);
    expect(bleSessionStale(1_000, 1_000 + 1_000)).toBe(false);
    expect(bleSessionStale(undefined, Date.now())).toBe(true);
  });
});
