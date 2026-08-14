import type { EncryptedEnvelope, SendResult, Transport, TransportId, TransportRuntimeStatus } from "./transport.js";

class UnavailableTransport implements Transport {
  constructor(
    readonly id: TransportId,
    private readonly detail: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async send(_envelope: EncryptedEnvelope): Promise<SendResult> {
    return { ok: false, transport: this.id, error: `${this.id} transport is not implemented` };
  }

  subscribe(_handler: (envelope: EncryptedEnvelope) => void): () => void {
    return () => undefined;
  }

  status(): TransportRuntimeStatus {
    return {
      id: this.id,
      available: false,
      implemented: false,
      detail: this.detail,
    };
  }
}

export function createRelayTransport(): Transport {
  return new UnavailableTransport(
    "relay",
    "Not implemented. Direct BLE must work before physical mesh. A protocol simulator covers A→B→C.",
  );
}
