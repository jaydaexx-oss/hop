import type { HopHttpClient } from "./http.js";
import { decodeUnencryptedText } from "./payload.js";
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
    if (!envelope.encrypted_payload) {
      return { ok: false, transport: this.id, error: "Refusing to send empty/plaintext payload" };
    }
    const text = decodeUnencryptedText(envelope.encrypted_payload);
    if (!text) {
      return {
        ok: false,
        transport: this.id,
        error: "Internet path requires alg: none plaintext until internet E2EE exists",
      };
    }
    try {
      const res = await this.http.request(`/conversations/${envelope.conversation_id}/messages`, {
        method: "POST",
        body: { text, message_id: envelope.message_id },
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
      detail: "HTTP to FastAPI /health and POST /conversations/{id}/messages. Internet bodies are alg: none.",
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
