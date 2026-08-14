import { describe, expect, it } from "vitest";
import {
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
    expect(hexToBytes(hex).length).toBeGreaterThan(0);
  });
});
