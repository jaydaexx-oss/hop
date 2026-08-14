import { ProcessedIdSet } from "./duplicates.js";
import { LocalTransport } from "./localTransport.js";
import { isExpired } from "./message.js";
import { DEFAULT_RETRY_POLICY, nextBackoffMs, type RetryPolicy } from "./retry.js";
import {
  createBluetoothTransport,
  createInternetTransport,
  createRelayTransport,
} from "./stubTransports.js";
import type {
  EncryptedEnvelope,
  NetworkStatus,
  SendResult,
  Transport,
  TransportId,
} from "./transport.js";

const PRIORITY: TransportId[] = ["internet", "bluetooth", "relay", "local"];

export interface QueueItem {
  envelope: EncryptedEnvelope;
  attempts: number;
}

export class TransportManager {
  private readonly transports = new Map<TransportId, Transport>();
  private readonly outbound: QueueItem[] = [];

  constructor(
    private readonly processed = new ProcessedIdSet(),
    private readonly retry: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {}

  register(transport: Transport): void {
    this.transports.set(transport.id, transport);
  }

  getTransport(id: TransportId): Transport | undefined {
    return this.transports.get(id);
  }

  /**
   * Inbound path: drop duplicates and expired envelopes. Does not decrypt.
   * @returns false if the envelope must be discarded.
   */
  acceptInbound(envelope: EncryptedEnvelope, now = new Date()): boolean {
    if (isExpired(envelope, now)) {
      return false;
    }
    return this.processed.remember(envelope.message_id);
  }

  async enqueue(envelope: EncryptedEnvelope, now = new Date()): Promise<SendResult> {
    if (!envelope.encrypted_payload) {
      return { ok: false, transport: "local", error: "Refusing to send empty/plaintext payload" };
    }
    if (isExpired(envelope, now)) {
      return { ok: false, transport: envelope.transport, error: "Message expired" };
    }
    if (!this.processed.remember(envelope.message_id)) {
      return { ok: false, transport: envelope.transport, error: "Duplicate message_id" };
    }

    const sent = await this.trySend(envelope);
    if (sent.ok) {
      return sent;
    }

    this.outbound.push({ envelope, attempts: 0 });
    return { ok: true, transport: "local", error: "Queued for retry" };
  }

  async processQueue(now = new Date()): Promise<void> {
    const pending = this.outbound.splice(0);
    for (const item of pending) {
      if (isExpired(item.envelope, now)) {
        continue;
      }
      const backoff = nextBackoffMs(item.attempts, this.retry);
      if (backoff === null) {
        continue;
      }
      const sent = await this.trySend(item.envelope);
      if (!sent.ok) {
        this.outbound.push({ ...item, attempts: item.attempts + 1 });
      }
    }
  }

  async getNetworkStatus(): Promise<NetworkStatus> {
    const internet = this.transports.get("internet");
    if (internet && (await internet.isAvailable())) return "Online";
    const bluetooth = this.transports.get("bluetooth");
    if (bluetooth && (await bluetooth.isAvailable())) return "Nearby";
    const queued =
      this.outbound.length +
      [...this.transports.values()].reduce((sum, t) => sum + (t.queuedCount?.() ?? 0), 0);
    if (queued > 0) return "Queued";
    return "Offline";
  }

  peekQueue(): readonly QueueItem[] {
    return this.outbound;
  }

  private async trySend(envelope: EncryptedEnvelope): Promise<SendResult> {
    const ordered = PRIORITY.map((id) => this.transports.get(id)).filter(
      (t): t is Transport => t !== undefined,
    );

    for (const transport of ordered) {
      if (!(await transport.isAvailable())) continue;
      const result = await transport.send({ ...envelope, transport: transport.id });
      if (result.ok) return result;
    }

    return { ok: false, transport: "local", error: "No transport available" };
  }
}

export function defaultTransportManager(): TransportManager {
  const manager = new TransportManager();
  manager.register(createInternetTransport());
  manager.register(createBluetoothTransport());
  manager.register(createRelayTransport());
  manager.register(new LocalTransport());
  return manager;
}
