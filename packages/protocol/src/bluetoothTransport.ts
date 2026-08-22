import { isCryptoBoxPayload } from "./cryptoBox.js";
import { isExpired, shouldStopForwarding } from "./message.js";
import { refuseUnencryptedPayloadError } from "./sendGuards.js";
import type { BleLink } from "./bleLink.js";
import type { EncryptedEnvelope, SendResult, Transport, TransportRuntimeStatus } from "./transport.js";

export type BlePayloadPreparer = (envelope: EncryptedEnvelope) => Promise<string>;

export class BluetoothTransport implements Transport {
  readonly id = "bluetooth" as const;
  private readonly listeners = new Set<(envelope: EncryptedEnvelope) => void>();
  private unsubscribeLink: (() => void) | null = null;

  constructor(
    private readonly link: BleLink,
    private readonly getPeerDeviceId: (envelope: EncryptedEnvelope) => string | null,
    private readonly preparePayload?: BlePayloadPreparer,
  ) {
    this.unsubscribeLink = this.link.subscribe((envelope) => {
      if (shouldStopForwarding(envelope) || isExpired(envelope)) return;
      for (const listener of this.listeners) listener(envelope);
    });
  }

  async isAvailable(): Promise<boolean> {
    const status = this.link.status();
    return status.implemented && status.bluetoothOn && status.permissionGranted;
  }

  async canSend(envelope: EncryptedEnvelope): Promise<boolean> {
    // BLE assembled frames stay at 70 KiB. 2-minute voice uses the internet box.
    if (envelope.encrypted_payload.length > 65_536) return false;
    return (await this.isAvailable()) && this.getPeerDeviceId(envelope) !== null;
  }

  async send(envelope: EncryptedEnvelope): Promise<SendResult> {
    if (!envelope.encrypted_payload || !isCryptoBoxPayload(envelope.encrypted_payload)) {
      return { ok: false, transport: this.id, error: refuseUnencryptedPayloadError() };
    }
    let payload = envelope.encrypted_payload;
    if (this.preparePayload) {
      try {
        payload = await this.preparePayload({ ...envelope, encrypted_payload: payload });
      } catch (err) {
        return {
          ok: false,
          transport: this.id,
          error: err instanceof Error ? err.message : "BLE payload encryption failed",
        };
      }
      if (!isCryptoBoxPayload(payload)) {
        return { ok: false, transport: this.id, error: refuseUnencryptedPayloadError() };
      }
    }
    if (isExpired(envelope) || shouldStopForwarding(envelope)) {
      return { ok: false, transport: this.id, error: "Message expired or hop limit reached" };
    }
    if (!(await this.isAvailable())) {
      return { ok: false, transport: this.id, error: "Bluetooth is not available" };
    }
    const deviceId = this.getPeerDeviceId(envelope);
    if (!deviceId) {
      return { ok: false, transport: this.id, error: "No nearby peer mapped for this recipient" };
    }
    return this.link.send(deviceId, {
      ...envelope,
      encrypted_payload: payload,
      transport: this.id,
      hop_count: envelope.hop_count,
    });
  }

  subscribe(handler: (envelope: EncryptedEnvelope) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  status(): TransportRuntimeStatus {
    const link = this.link.status();
    return {
      id: this.id,
      available: link.implemented && link.bluetoothOn && link.permissionGranted,
      implemented: link.implemented,
      detail: link.detail,
    };
  }

  dispose(): void {
    this.unsubscribeLink?.();
    this.unsubscribeLink = null;
  }
}

function unimplementedBluetooth(): Transport {
  return {
    id: "bluetooth",
    async isAvailable() {
      return false;
    },
    async canSend() {
      return false;
    },
    async send() {
      return { ok: false, transport: "bluetooth", error: "bluetooth transport is not implemented" };
    },
    subscribe() {
      return () => undefined;
    },
    status() {
      return {
        id: "bluetooth",
        available: false,
        implemented: false,
        detail: "Not implemented. BLE is not complete until tested on a physical iPhone and Android phone.",
      };
    },
  };
}

export function createBluetoothTransport(
  link?: BleLink,
  getPeerDeviceId: (envelope: EncryptedEnvelope) => string | null = () => null,
  preparePayload?: BlePayloadPreparer,
): Transport {
  if (!link) return unimplementedBluetooth();
  return new BluetoothTransport(link, getPeerDeviceId, preparePayload);
}
