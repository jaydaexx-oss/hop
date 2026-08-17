import { describe, expect, it } from "vitest";
import {
  BLE_MAX_FRAME_BYTES,
  BleReassembler,
  advertiseLocalName,
  chunkBytes,
  decodeEnvelope,
  decodeHandshake,
  displayNameFromAdvertisement,
  encodeEnvelope,
  encodeHandshake,
  hexToBytes,
} from "../src/bleCodec.js";
import { createMessage } from "../src/message.js";
import { toEnvelope } from "../src/transport.js";

describe("BLE codec", () => {
  it("reassembles chunked envelopes", () => {
    const envelope = toEnvelope({
      ...createMessage({ sender_id: "a", recipient_id: "b", conversation_id: "c" }),
      encrypted_payload: "dGVzdA==",
    });
    const frames = chunkBytes(encodeEnvelope(envelope), 12);
    expect(frames.length).toBeGreaterThan(1);
    const reassembler = new BleReassembler();
    let done: Uint8Array | null = null;
    for (const frame of frames) {
      done = reassembler.push(frame);
    }
    expect(done).not.toBeNull();
    expect(decodeEnvelope(done!)?.message_id).toBe(envelope.message_id);
  });

  it("round-trips handshake identity without a MAC", () => {
    const hex = encodeHandshake({ v: 2, user_id: "user-1", username: "alex", pk: "pk-b64" });
    expect(decodeHandshake(hex)).toEqual({ v: 2, user_id: "user-1", username: "alex", pk: "pk-b64" });
    expect(advertiseLocalName("alex")).toBe("HOP:alex");
    expect(displayNameFromAdvertisement("HOP:alex", "AA:BB:CC:DD:EE:FF")).toBe("alex");
    expect(displayNameFromAdvertisement(null, "AA:BB:CC:DD:EE:FF")).toBe("HOP user");
    expect(displayNameFromAdvertisement("00:11:22:33:44:55", null)).toBe("HOP user");
    expect(hexToBytes(hex).length).toBeGreaterThan(0);
  });

  it("drops malformed envelopes and oversized handshake fields", () => {
    expect(decodeEnvelope(new TextEncoder().encode("{not-json"))).toBeNull();
    expect(decodeEnvelope(new TextEncoder().encode(JSON.stringify({ message_id: "only" })))).toBeNull();
    expect(decodeHandshake(encodeHandshake({ v: 2, user_id: "u", username: "x".repeat(40), pk: "pk" }))).toBeNull();
    expect(decodeHandshake("00")).toBeNull();
  });

  it("rejects oversized chunks, conflicting duplicate frames, and stale sessions", () => {
    const reassembler = new BleReassembler(100, 1_000);
    const oversized = new Uint8Array(BLE_MAX_FRAME_BYTES + 1);
    oversized.set(new TextEncoder().encode("HOP1"));
    expect(reassembler.push(oversized)).toBeNull();

    const frameA = chunkBytes(new TextEncoder().encode("aaaa"), 2)[0]!;
    const frameB = chunkBytes(new TextEncoder().encode("bbbb"), 2)[0]!;
    expect(reassembler.push(frameA, 1_000)).toBeNull();
    expect(reassembler.push(frameB, 1_100)).toBeNull();

    const stale = new BleReassembler(100, 50);
    const frames = chunkBytes(encodeEnvelope(toEnvelope({
      ...createMessage({ sender_id: "a", recipient_id: "b", conversation_id: "c" }),
      encrypted_payload: "dGVzdA==",
    })), 12);
    expect(stale.push(frames[0]!, 0)).toBeNull();
    expect(stale.push(frames[1]!, 5_000)).toBeNull();
  });

  it("accepts identical duplicate frames and completes the envelope", () => {
    const envelope = toEnvelope({
      ...createMessage({ sender_id: "a", recipient_id: "b", conversation_id: "c" }),
      encrypted_payload: "dGVzdA==",
    });
    const frames = chunkBytes(encodeEnvelope(envelope), 12);
    const reassembler = new BleReassembler();
    expect(reassembler.push(frames[0]!)).toBeNull();
    expect(reassembler.push(frames[0]!)).toBeNull();
    let done: Uint8Array | null = null;
    for (const frame of frames) {
      done = reassembler.push(frame) ?? done;
    }
    expect(decodeEnvelope(done!)?.message_id).toBe(envelope.message_id);
  });
});
