import { describe, expect, it } from "vitest";
import { LocalTransport } from "../src/localTransport.js";
import { CRYPTO_BOX_ALG } from "../src/cryptoBox.js";
import { createMessage } from "../src/message.js";
import { encodeUnencryptedText } from "../src/payload.js";
import { createBluetoothTransport } from "../src/bluetoothTransport.js";
import { createRelayTransport } from "../src/stubTransports.js";
import { createInternetTransport } from "../src/internetTransport.js";
import { toEnvelope, type EncryptedEnvelope, type SendResult, type Transport, type TransportId } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";

function boxedPayload(): string {
  return JSON.stringify({
    v: 1,
    alg: CRYPTO_BOX_ALG,
    sender_pk: "pk",
    nonce: "n",
    ciphertext: "ct",
  });
}

function encryptedEnvelope(recipientId = "recipient") {
  const message = createMessage({
    sender_id: "sender",
    recipient_id: recipientId,
    conversation_id: "convo",
  });
  return toEnvelope({ ...message, encrypted_payload: boxedPayload() });
}

function mockTransport(
  id: TransportId,
  options: {
    available: boolean;
    failSend?: boolean;
    sent?: EncryptedEnvelope[];
    canSend?: (envelope: EncryptedEnvelope) => boolean;
  },
): Transport {
  return {
    id,
    async isAvailable() {
      return options.available;
    },
    async canSend(envelope) {
      if (!options.available) return false;
      if (options.canSend) return options.canSend(envelope);
      return true;
    },
    async send(envelope): Promise<SendResult> {
      if (!options.available) {
        return { ok: false, transport: id, error: "unavailable" };
      }
      if (options.failSend) {
        return { ok: false, transport: id, error: "send failed" };
      }
      options.sent?.push(envelope);
      return { ok: true, transport: id };
    },
    subscribe() {
      return () => undefined;
    },
    status() {
      return { id, available: options.available, implemented: true, detail: "mock" };
    },
  };
}

describe("TransportManager", () => {
  it("uses internet when internet is available", async () => {
    const internetSent: EncryptedEnvelope[] = [];
    const bleSent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(mockTransport("internet", { available: true, sent: internetSent }));
    manager.register(mockTransport("bluetooth", { available: false, sent: bleSent }));
    manager.register(new LocalTransport());

    const envelope = encryptedEnvelope();
    const result = await manager.enqueue(envelope);
    expect(result).toMatchObject({ ok: true, transport: "internet" });
    expect(internetSent).toHaveLength(1);
    expect(bleSent).toHaveLength(0);
    expect(await manager.select(envelope)).toBe("internet");
    expect(await manager.getNetworkStatus()).toBe("Online");
  });

  it("does not use internet when internet is unavailable", async () => {
    const internetSent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(mockTransport("internet", { available: false, sent: internetSent }));
    manager.register(mockTransport("bluetooth", { available: false }));
    manager.register(new LocalTransport());

    const result = await manager.enqueue(encryptedEnvelope());
    expect(result.transport).toBe("local");
    expect(internetSent).toHaveLength(0);
  });

  it("uses BLE when BLE is available and internet is not", async () => {
    const bleSent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(mockTransport("internet", { available: false }));
    manager.register(mockTransport("bluetooth", { available: true, sent: bleSent }));
    manager.register(new LocalTransport());

    const envelope = encryptedEnvelope();
    const result = await manager.enqueue(envelope);
    expect(result).toMatchObject({ ok: true, transport: "bluetooth" });
    expect(bleSent).toHaveLength(1);
    expect(await manager.select(envelope)).toBe("bluetooth");
    expect(await manager.getNetworkStatus()).toBe("Nearby");
  });

  it("does not use BLE when BLE is unavailable", async () => {
    const bleSent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(mockTransport("internet", { available: false }));
    manager.register(mockTransport("bluetooth", { available: false, sent: bleSent }));
    manager.register(new LocalTransport());

    const result = await manager.enqueue(encryptedEnvelope());
    expect(result.transport).toBe("local");
    expect(bleSent).toHaveLength(0);
  });

  it("prefers internet when both internet and BLE are available", async () => {
    const internetSent: EncryptedEnvelope[] = [];
    const bleSent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(mockTransport("internet", { available: true, sent: internetSent }));
    manager.register(mockTransport("bluetooth", { available: true, sent: bleSent }));
    manager.register(new LocalTransport());

    const result = await manager.enqueue(encryptedEnvelope());
    expect(result).toMatchObject({ ok: true, transport: "internet" });
    expect(internetSent).toHaveLength(1);
    expect(bleSent).toHaveLength(0);
  });

  it("queues locally when neither internet nor BLE is available", async () => {
    const local = new LocalTransport();
    const manager = new TransportManager();
    manager.register(createInternetTransport());
    manager.register(createBluetoothTransport());
    manager.register(createRelayTransport());
    manager.register(local);

    const result = await manager.enqueue(encryptedEnvelope());
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("local");
    expect(local.length).toBe(1);
    expect(await manager.getNetworkStatus()).toBe("Queued");
  });

  it("falls back to BLE when internet is up but send fails", async () => {
    const bleSent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(mockTransport("internet", { available: true, failSend: true }));
    manager.register(mockTransport("bluetooth", { available: true, sent: bleSent }));
    manager.register(new LocalTransport());

    const result = await manager.enqueue(encryptedEnvelope());
    expect(result).toMatchObject({ ok: true, transport: "bluetooth" });
    expect(bleSent).toHaveLength(1);
  });

  it("does not select BLE when the radio is on but the recipient is not nearby", async () => {
    const bleSent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(mockTransport("internet", { available: false }));
    manager.register(
      mockTransport("bluetooth", {
        available: true,
        sent: bleSent,
        canSend: (envelope) => envelope.recipient_id === "nearby-user",
      }),
    );
    manager.register(new LocalTransport());

    const result = await manager.enqueue(encryptedEnvelope("other-user"));
    expect(result.transport).toBe("local");
    expect(bleSent).toHaveLength(0);
    expect(await manager.select(encryptedEnvelope("nearby-user"))).toBe("bluetooth");
  });

  it("never auto-selects relay", async () => {
    const relaySent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(mockTransport("internet", { available: false }));
    manager.register(mockTransport("bluetooth", { available: false }));
    manager.register(mockTransport("relay", { available: true, sent: relaySent }));
    manager.register(new LocalTransport());

    const result = await manager.enqueue(encryptedEnvelope());
    expect(result.transport).toBe("local");
    expect(relaySent).toHaveLength(0);
  });

  it("refuses empty payloads so plaintext cannot be sent", async () => {
    const manager = new TransportManager();
    manager.register(new LocalTransport());
    const envelope = encryptedEnvelope();
    envelope.encrypted_payload = "";
    const result = await manager.enqueue(envelope);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/plaintext|alg:none/i);
  });

  it("refuses alg:none so it cannot leave TransportManager", async () => {
    const internetSent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(mockTransport("internet", { available: true, sent: internetSent }));
    manager.register(new LocalTransport());
    const envelope = encryptedEnvelope();
    envelope.encrypted_payload = encodeUnencryptedText("hello");
    const result = await manager.send(envelope);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/plaintext|alg:none/i);
    expect(internetSent).toHaveLength(0);
  });

  it("discards duplicate inbound message ids", () => {
    const manager = new TransportManager();
    const envelope = encryptedEnvelope();
    expect(manager.acceptInbound(envelope)).toBe(true);
    expect(manager.acceptInbound(envelope)).toBe(false);
  });

  it("does not forward expired messages", async () => {
    const local = new LocalTransport();
    const manager = new TransportManager();
    manager.register(local);
    const envelope = encryptedEnvelope();
    envelope.expires_at = "2000-01-01T00:00:00.000Z";
    const result = await manager.enqueue(envelope, new Date("2026-01-01T00:00:00.000Z"));
    expect(result.ok).toBe(false);
    expect(local.length).toBe(0);
  });
});
