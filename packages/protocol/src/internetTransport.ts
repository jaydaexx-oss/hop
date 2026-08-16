import type { HopHttpClient } from "./http.js";
import { isCryptoBoxPayload } from "./cryptoBox.js";
import type { EncryptedEnvelope, SendResult, Transport, TransportRuntimeStatus } from "./transport.js";

export class InternetTransport implements Transport {
  readonly id = "internet" as const;
  private available = false;

  constructor(private readonly http: HopHttpClient) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.http.request("/health");
      const data = res.data as { status?: string } | null;
      this.available = res.ok && data?.status === "ok";
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async send(envelope: EncryptedEnvelope): Promise<SendResult> {
    if (!envelope.encrypted_payload || !isCryptoBoxPayload(envelope.encrypted_payload)) {
      return {
        ok: false,
        transport: this.id,
        error: "Refusing to send plaintext or alg:none payload",
      };
    }
    try {
      const res = await this.http.request(`/conversations/${envelope.conversation_id}/messages`, {
        method: "POST",
        body: { encrypted_payload: envelope.encrypted_payload, message_id: envelope.message_id },
      });
      if (res.ok) {
        return { ok: true, transport: this.id };
      }
      return {
        ok: false,
        transport: this.id,
        error: `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        transport: this.id,
        error: err instanceof Error ? err.message : "Internet send failed",
      };
    }
  }

  subscribe(_handler: (envelope: EncryptedEnvelope) => void): () => void {
    return () => undefined;
  }

  status(): TransportRuntimeStatus {
    return {
      id: this.id,
      available: this.available,
      implemented: true,
      detail: "HTTP POST of opaque libsodium crypto_box payloads. The server cannot read plaintext.",
    };
  }
}

export function createInternetTransport(http?: HopHttpClient): Transport {
  if (!http) {
    return {
      id: "internet",
      async isAvailable() {
        return false;
      },
      async send() {
        return { ok: false, transport: "internet", error: "Internet transport has no HTTP client" };
      },
      subscribe() {
        return () => undefined;
      },
      status() {
        return {
          id: "internet",
          available: false,
          implemented: false,
          detail: "No HTTP client configured.",
        };
      },
    };
  }
  return new InternetTransport(http);
}
