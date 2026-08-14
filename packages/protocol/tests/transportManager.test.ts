import { describe, expect, it } from "vitest";
import { LocalTransport } from "../src/localTransport.js";
import { createMessage } from "../src/message.js";
import { createBluetoothTransport, createInternetTransport, createRelayTransport } from "../src/stubTransports.js";
import { toEnvelope } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";

function encryptedEnvelope() {
  const message = createMessage({
    sender_id: "sender",
    recipient_id: "recipient",
    conversation_id: "convo",
  });
  return toEnvelope({ ...message, encrypted_payload: "dGVzdA==" });
}

describe("TransportManager", () => {
  it("queues locally when internet/BLE/relay are unavailable", async () => {
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

  it("refuses empty payloads so plaintext cannot be sent", async () => {
    const manager = new TransportManager();
    manager.register(new LocalTransport());
    const envelope = encryptedEnvelope();
    envelope.encrypted_payload = "";
    const result = await manager.enqueue(envelope);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/plaintext/i);
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
