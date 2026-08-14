import { describe, expect, it } from "vitest";
import type { BleLink, BleLinkStatus, BlePeer, BleScanMode, BleSessionOptions } from "../src/bleLink.js";
import { createBluetoothTransport } from "../src/bluetoothTransport.js";
import { CRYPTO_BOX_ALG } from "../src/cryptoBox.js";
import { createMessage } from "../src/message.js";
import { toEnvelope, type EncryptedEnvelope, type SendResult } from "../src/transport.js";

function boxedPayload(): string {
  return JSON.stringify({
    v: 1,
    alg: CRYPTO_BOX_ALG,
    sender_pk: "pk",
    nonce: "n",
    ciphertext: "c",
  });
}

class MockBleLink implements BleLink {
  available = true;
  sent: EncryptedEnvelope[] = [];
  private readonly inbound = new Set<(envelope: EncryptedEnvelope, from: BlePeer) => void>();

  status(): BleLinkStatus {
    return {
      implemented: true,
      bluetoothOn: this.available,
      permissionGranted: true,
      advertising: true,
      scanning: true,
      advertisingSupported: true,
      detail: "mock",
    };
  }

  async requestPermission(): Promise<boolean> {
    return true;
  }
  async startSession(_options: BleSessionOptions): Promise<void> {}
  async stopSession(): Promise<void> {}
  async setScanMode(_mode: BleScanMode): Promise<void> {}
  listPeers(): BlePeer[] {
    return [
      { deviceId: "peer-device", displayName: "blake", userId: "blake-id", lastSeenAt: Date.now() },
    ];
  }
  async connect(deviceId: string): Promise<BlePeer> {
    return { deviceId, displayName: "blake", userId: "blake-id", lastSeenAt: Date.now() };
  }
  async disconnect(_deviceId: string): Promise<void> {}
  async send(_deviceId: string, envelope: EncryptedEnvelope): Promise<SendResult> {
    this.sent.push(envelope);
    return { ok: true, transport: "bluetooth" };
  }
  subscribe(handler: (envelope: EncryptedEnvelope, from: BlePeer) => void): () => void {
    this.inbound.add(handler);
    return () => this.inbound.delete(handler);
  }
  onPeersChanged(): () => void {
    return () => undefined;
  }
  onConnectionChanged(): () => void {
    return () => undefined;
  }

  emit(envelope: EncryptedEnvelope): void {
    const peer = this.listPeers()[0];
    for (const handler of this.inbound) handler(envelope, peer);
  }
}

function envelope() {
  return toEnvelope({
    ...createMessage({ sender_id: "a", recipient_id: "b", conversation_id: "c" }),
    encrypted_payload: boxedPayload(),
  });
}

describe("BluetoothTransport", () => {
  it("sends through the BLE link without incrementing hop_count", async () => {
    const link = new MockBleLink();
    const transport = createBluetoothTransport(link, () => "peer-device");
    const msg = envelope();
    const result = await transport.send(msg);
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("bluetooth");
    expect(link.sent[0]?.hop_count).toBe(0);
    expect(link.sent[0]?.encrypted_payload).toBe(boxedPayload());
  });

  it("refuses empty payloads", async () => {
    const link = new MockBleLink();
    const transport = createBluetoothTransport(link, () => "peer-device");
    const msg = envelope();
    msg.encrypted_payload = "";
    const result = await transport.send(msg);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unauthenticated|plaintext/i);
  });

  it("refuses unauthenticated alg:none payloads", async () => {
    const link = new MockBleLink();
    const transport = createBluetoothTransport(link, () => "peer-device");
    const msg = envelope();
    msg.encrypted_payload = JSON.stringify({ alg: "none", text: "hi" });
    const result = await transport.send(msg);
    expect(result.ok).toBe(false);
    expect(link.sent).toHaveLength(0);
  });

  it("does not forward hop-limited envelopes", async () => {
    const link = new MockBleLink();
    const transport = createBluetoothTransport(link, () => "peer-device");
    const msg = envelope();
    msg.hop_count = 8;
    const result = await transport.send(msg);
    expect(result.ok).toBe(false);
    expect(link.sent).toHaveLength(0);
  });

  it("stays unimplemented without a native link", async () => {
    const transport = createBluetoothTransport();
    expect(transport.status().implemented).toBe(false);
    expect(await transport.isAvailable()).toBe(false);
  });

  it("canSend requires a mapped nearby recipient", async () => {
    const link = new MockBleLink();
    const transport = createBluetoothTransport(link, (msg) =>
      msg.recipient_id === "b" ? "peer-device" : null,
    );
    const msg = envelope();
    expect(await transport.canSend?.(msg)).toBe(true);
    expect(await transport.canSend?.({ ...msg, recipient_id: "other" })).toBe(false);
  });
});
