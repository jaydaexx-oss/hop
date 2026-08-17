import { ProcessedIdSet } from "./duplicates.js";
import { createInternetTransport } from "./internetTransport.js";
import { LocalTransport } from "./localTransport.js";
import { isExpired } from "./message.js";
import { DEFAULT_RETRY_POLICY, nextBackoffMs, type RetryPolicy } from "./retry.js";
import { isBoxedEnvelopePayload, refuseUnencryptedPayloadError } from "./sendGuards.js";
import { createBluetoothTransport } from "./bluetoothTransport.js";
import { createRelayTransport } from "./stubTransports.js";
import type {
  EncryptedEnvelope,
  NetworkStatus,
  SendResult,
  Transport,
  TransportId,
} from "./transport.js";

/** Live delivery routes. Relay is not selected (unimplemented, no consent). Local is fallback only. */
export const LIVE_TRANSPORT_PRIORITY: TransportId[] = ["internet", "bluetooth"];

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

  registeredIds(): TransportId[] {
    return [...this.transports.keys()];
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

  async canUse(transport: Transport, envelope: EncryptedEnvelope): Promise<boolean> {
    try {
      if (transport.canSend) return await transport.canSend(envelope);
      return await transport.isAvailable();
    } catch {
      // Bluetooth off / native throw must not crash send. Fall through to the next route or queue.
      return false;
    }
  }

  /** First live route that can carry this envelope, or null to queue locally. */
  async select(envelope: EncryptedEnvelope): Promise<TransportId | null> {
    for (const id of LIVE_TRANSPORT_PRIORITY) {
      const transport = this.transports.get(id);
      if (!transport) continue;
      if (await this.canUse(transport, envelope)) return id;
    }
    return null;
  }

  /**
   * Try internet, then BLE. Does not use local queue or relay.
   * If a selected transport's send fails, the next live route is tried.
   */
  async send(envelope: EncryptedEnvelope): Promise<SendResult> {
    if (!isBoxedEnvelopePayload(envelope.encrypted_payload)) {
      return { ok: false, transport: "local", error: refuseUnencryptedPayloadError() };
    }
    if (isExpired(envelope)) {
      return { ok: false, transport: envelope.transport, error: "Message expired" };
    }

    let last: SendResult = { ok: false, transport: "local", error: "No transport available" };
    const attempted = new Set<TransportId>();
    for (const id of LIVE_TRANSPORT_PRIORITY) {
      const transport = this.transports.get(id);
      if (!transport) continue;
      if (!(await this.canUse(transport, envelope))) continue;
      attempted.add(id);
      try {
        const result = await transport.send({ ...envelope, transport: transport.id });
        if (result.ok) return result;
        last = result;
      } catch (err) {
        last = {
          ok: false,
          transport: id,
          error: err instanceof Error ? err.message : "Transport failed",
        };
      }
    }
    // BLE was selected (internet unavailable) and failed: retry internet if it is now usable.
    if (!last.ok && attempted.has("bluetooth") && !attempted.has("internet")) {
      const internet = this.transports.get("internet");
      if (internet && (await this.canUse(internet, envelope))) {
        try {
          const result = await internet.send({ ...envelope, transport: "internet" });
          if (result.ok) return result;
          last = result;
        } catch (err) {
          last = {
            ok: false,
            transport: "internet",
            error: err instanceof Error ? err.message : "Transport failed",
          };
        }
      }
    }
    return last.ok ? last : { ok: false, transport: "local", error: last.error ?? "No transport available" };
  }

  async enqueue(envelope: EncryptedEnvelope, now = new Date()): Promise<SendResult> {
    if (!isBoxedEnvelopePayload(envelope.encrypted_payload)) {
      return { ok: false, transport: "local", error: refuseUnencryptedPayloadError() };
    }
    if (isExpired(envelope, now)) {
      return { ok: false, transport: envelope.transport, error: "Message expired" };
    }
    if (!this.processed.remember(envelope.message_id)) {
      return { ok: false, transport: envelope.transport, error: "Duplicate message_id" };
    }

    const sent = await this.send(envelope);
    if (sent.ok) {
      return sent;
    }

    const local = this.transports.get("local");
    if (local) {
      const queued = await local.send({ ...envelope, transport: "local" });
      if (queued.ok) {
        return { ok: true, transport: "local", error: "Queued for retry" };
      }
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
      const sent = await this.send(item.envelope);
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
}

export function defaultTransportManager(): TransportManager {
  const manager = new TransportManager();
  manager.register(createInternetTransport());
  manager.register(createBluetoothTransport());
  manager.register(createRelayTransport());
  manager.register(new LocalTransport());
  return manager;
}
