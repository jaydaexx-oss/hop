import { describe, expect, it } from "vitest";
import {
  CRYPTO_BOX_ALG,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  isCryptoBoxPayload,
  parseCryptoBoxPayload,
} from "../src/cryptoBox.js";
import { PublicKeyTofu } from "../src/tofu.js";
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

  it("rejects inner sender_id that does not match the envelope", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const packed = await encryptApplicationMessage(plain, blake.publicKey, alice);
    await expect(
      decryptApplicationMessage(packed, blake, alice.publicKey, plain.message_id, {
        expectedSenderId: "not-alice",
      }),
    ).rejects.toThrow(/sender_id/i);
  });

  it("TOFU-binds sender_pk and rejects a later key change", async () => {
    const alice = await generateIdentityKeyPair();
    const mallory = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    const packed = await encryptApplicationMessage(plain, blake.publicKey, alice);
    await decryptApplicationMessage(packed, blake, alice.publicKey, plain.message_id, {
      expectedSenderId: plain.sender_id,
      tofu,
    });
    const spoofed = await encryptApplicationMessage(plain, blake.publicKey, mallory);
    await expect(
      decryptApplicationMessage(spoofed, blake, mallory.publicKey, plain.message_id, {
        expectedSenderId: plain.sender_id,
        tofu,
      }),
    ).rejects.toThrow(/bound identity/i);
  });

  it("refuses empty plaintext", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    await expect(
      encryptApplicationMessage({ ...plain, text: "  " }, blake.publicKey, alice),
    ).rejects.toThrow(/empty/i);
  });

  it("round-trips a voice clip and keeps audio out of the ciphertext JSON", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const fixture = "HOP_VOICE_FIXTURE_DO_NOT_LEAK";
    const voice = {
      ...plain,
      kind: "voice" as const,
      text: "Voice message",
      audio_b64: Buffer.from(fixture, "utf8").toString("base64"),
      duration_ms: 1200,
      mime: "audio/mp4",
      codec: "aac",
      seq: 0,
      total: 1,
    };
    const packed = await encryptApplicationMessage(voice, blake.publicKey, alice);
    expect(packed).not.toContain(fixture);
    expect(packed).not.toContain(voice.audio_b64);
    const opened = await decryptApplicationMessage(packed, blake, alice.publicKey, voice.message_id);
    expect(opened.kind).toBe("voice");
    expect(opened.audio_b64).toBe(voice.audio_b64);
    expect(opened.duration_ms).toBe(1200);
    expect(opened.mime).toBe("audio/mp4");
    expect(opened.text).toBe("Voice message");
  });

  it("refuses voice with no audio and allows a voice caption", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    await expect(
      encryptApplicationMessage(
        { ...plain, kind: "voice", text: "Voice message" },
        blake.publicKey,
        alice,
      ),
    ).rejects.toThrow(/no audio/i);
    const packed = await encryptApplicationMessage(
      { ...plain, kind: "voice", text: "  ", audio_b64: "YQ==" },
      blake.publicKey,
      alice,
    );
    expect(isCryptoBoxPayload(packed)).toBe(true);
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
