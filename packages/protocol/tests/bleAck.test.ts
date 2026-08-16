import { describe, expect, it } from "vitest";

import {
  encodeAuthenticatedBleAck,
  isUnauthenticatedBleAck,
  verifyAuthenticatedBleAck,
} from "../src/bleAck.js";
import { bytesToHex } from "../src/bleCodec.js";
import { generateIdentityKeyPair } from "../src/cryptoBox.js";

describe("authenticated BLE GATT ACK", () => {
  it("accepts a MAC from the recipient and rejects forged or plaintext ACKs", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const eve = await generateIdentityKeyPair();
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

    const forged = await encodeAuthenticatedBleAck({
      message_id: "msg-1",
      from: "blake",
      local: eve,
      peerPublicKey: alice.publicKey,
    });
    expect(
      await verifyAuthenticatedBleAck(forged, { message_id: "msg-1", from: "blake" }, alice, blake.publicKey),
    ).toBe(false);

    const plaintext = bytesToHex(new TextEncoder().encode("msg-1"));
    expect(isUnauthenticatedBleAck(plaintext)).toBe(true);
    expect(
      await verifyAuthenticatedBleAck(plaintext, { message_id: "msg-1", from: "blake" }, alice, blake.publicKey),
    ).toBe(false);

    expect(
      await verifyAuthenticatedBleAck(hex, { message_id: "msg-other", from: "blake" }, alice, blake.publicKey),
    ).toBe(false);
    expect(
      await verifyAuthenticatedBleAck(hex, { message_id: "msg-1", from: "eve" }, alice, blake.publicKey),
    ).toBe(false);
  });
});
