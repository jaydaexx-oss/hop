import { describe, expect, it } from "vitest";

import {
  BLE_KEY_CHANGED_REFUSAL,
  BLE_MAX_FRAME_BYTES,
  BleReassembler,
  HandshakeReplayGuard,
  PublicKeyTofu,
  bleSendRefusal,
  chunkBytes,
  decodeEnvelope,
  encodeAuthenticatedBleAck,
  encodeEnvelope,
  generateIdentityKeyPair,
  isUnauthenticatedBleAck,
  verifyAuthenticatedBleAck,
} from "../src/index.js";
import { createMessage } from "../src/message.js";
import { toEnvelope } from "../src/transport.js";
import { bytesToHex } from "../src/bleCodec.js";

describe("BLE protocol hardening (no radio claims)", () => {
  it("drops a malformed envelope", () => {
    expect(decodeEnvelope(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(decodeEnvelope(new TextEncoder().encode('{"encrypted_payload":"x"}'))).toBeNull();
  });

  it("drops an oversized chunk frame", () => {
    const frame = new Uint8Array(BLE_MAX_FRAME_BYTES + 8);
    frame.set(new TextEncoder().encode("HOP1"));
    frame[5] = 1;
    expect(new BleReassembler().push(frame)).toBeNull();
  });

  it("drops conflicting duplicate frames", () => {
    const a = chunkBytes(new TextEncoder().encode("payload-one"), 4);
    const b = chunkBytes(new TextEncoder().encode("payload-two"), 4);
    const reassembler = new BleReassembler();
    expect(reassembler.push(a[0]!)).toBeNull();
    expect(reassembler.push(b[0]!)).toBeNull();
  });

  it("rejects unauthenticated GATT ACKs", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const plaintext = bytesToHex(new TextEncoder().encode("msg-1"));
    expect(isUnauthenticatedBleAck(plaintext)).toBe(true);
    expect(
      await verifyAuthenticatedBleAck(plaintext, { message_id: "msg-1", from: "blake" }, alice, blake.publicKey),
    ).toBe(false);

    const hex = await encodeAuthenticatedBleAck({
      message_id: "msg-1",
      from: "blake",
      local: blake,
      peerPublicKey: alice.publicKey,
    });
    expect(isUnauthenticatedBleAck(hex)).toBe(false);
    expect(
      await verifyAuthenticatedBleAck(hex, { message_id: "msg-1", from: "blake" }, alice, blake.publicKey),
    ).toBe(true);
  });

  it("refuses send after KEY_CHANGED", () => {
    const tofu = new PublicKeyTofu();
    tofu.observe("blake", "pk-trusted");
    tofu.observe("blake", "pk-new");
    expect(bleSendRefusal(tofu, "blake", "pk-new")).toBe(BLE_KEY_CHANGED_REFUSAL);
    expect(bleSendRefusal(tofu, "blake", "pk-trusted")).toBe(BLE_KEY_CHANGED_REFUSAL);
    const fresh = new PublicKeyTofu();
    fresh.observe("blake", "pk-trusted");
    expect(bleSendRefusal(fresh, "blake", "pk-trusted")).toBeNull();
  });

  it("rejects a replayed handshake nonce", () => {
    const guard = new HandshakeReplayGuard(60_000);
    expect(guard.remember("user-1", "nonce-a", 1_000)).toBe(true);
    expect(guard.remember("user-1", "nonce-a", 2_000)).toBe(false);
    expect(guard.remember("user-1", undefined, 3_000)).toBe(true);
  });

  it("still round-trips a well-formed chunked envelope", () => {
    const envelope = toEnvelope({
      ...createMessage({ sender_id: "a", recipient_id: "b", conversation_id: "c" }),
      encrypted_payload: JSON.stringify({
        v: 1,
        alg: "crypto_box_xsalsa20poly1305",
        sender_pk: "pk",
        nonce: "n",
        ciphertext: "c",
      }),
    });
    const frames = chunkBytes(encodeEnvelope(envelope), 20);
    const reassembler = new BleReassembler();
    let done: Uint8Array | null = null;
    for (const frame of frames) done = reassembler.push(frame);
    expect(decodeEnvelope(done!)?.message_id).toBe(envelope.message_id);
  });
});
