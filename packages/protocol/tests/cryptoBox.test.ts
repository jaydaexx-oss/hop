import { describe, expect, it } from "vitest";
import {
  CRYPTO_BOX_ALG,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  isCryptoBoxPayload,
  parseCryptoBoxPayload,
} from "../src/cryptoBox.js";
import { sendWithAckRetry } from "../src/ackRetry.js";
import { createMessageId } from "../src/ids.js";

const plain = {
  message_id: createMessageId(),
  sender_id: "alice",
  recipient_id: "blake",
  conversation_id: "ble:alice:blake",
  text: "hello over ble",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  ttl: 60_000,
  hop_count: 0,
};

describe("libsodium crypto_box application messages", () => {
  it("round-trips an authenticated encrypted message", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const packed = await encryptApplicationMessage(plain, blake.publicKey, alice);
    expect(isCryptoBoxPayload(packed)).toBe(true);
    expect(parseCryptoBoxPayload(packed)?.alg).toBe(CRYPTO_BOX_ALG);
    expect(packed).not.toContain(plain.text);

    const opened = await decryptApplicationMessage(packed, blake, alice.publicKey, plain.message_id);
    expect(opened).toEqual(plain);
  });

  it("rejects tampered ciphertext, wrong keys, and mismatched message_id", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const packed = await encryptApplicationMessage(plain, blake.publicKey, alice);
    const parsed = parseCryptoBoxPayload(packed)!;
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -2)}aa`;
    await expect(decryptApplicationMessage(JSON.stringify(parsed), blake, alice.publicKey)).rejects.toThrow();

    const eve = await generateIdentityKeyPair();
    await expect(decryptApplicationMessage(packed, blake, eve.publicKey)).rejects.toThrow(/public key/i);
    await expect(decryptApplicationMessage(packed, eve)).rejects.toThrow();
    await expect(decryptApplicationMessage(packed, blake, alice.publicKey, "other-id")).rejects.toThrow(/message_id/i);
  });

  it("refuses empty plaintext", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    await expect(
      encryptApplicationMessage({ ...plain, text: "  " }, blake.publicKey, alice),
    ).rejects.toThrow(/empty/i);
  });
});

describe("BLE ack retry", () => {
  it("retries after a missing ack then succeeds", async () => {
    const attempts: string[] = [];
    const result = await sendWithAckRetry(
      async () => {
        attempts.push("try");
        return attempts.length === 1 ? "no-ack" : "acked";
      },
      { retry: { baseMs: 1, maxMs: 1, maxAttempts: 3 }, sleep: async () => undefined },
    );
    expect(result.ok).toBe(true);
    expect(attempts).toHaveLength(2);
  });

  it("stops after maxAttempts", async () => {
    const result = await sendWithAckRetry(async () => "no-ack", {
      retry: { baseMs: 1, maxMs: 1, maxAttempts: 3 },
      sleep: async () => undefined,
      timeoutError: "Delivery ack timed out",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ack/i);
  });
});
