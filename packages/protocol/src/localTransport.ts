import type { EncryptedEnvelope, SendResult, Transport, TransportRuntimeStatus } from "./transport.js";

export class LocalTransport implements Transport {
  readonly id = "local" as const;
  private readonly queue: EncryptedEnvelope[] = [];
  private readonly listeners = new Set<(envelope: EncryptedEnvelope) => void>();

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async send(envelope: EncryptedEnvelope): Promise<SendResult> {
    const stored = { ...envelope, transport: this.id };
    this.queue.push(stored);
    return { ok: true, transport: this.id };
  }

  subscribe(handler: (envelope: EncryptedEnvelope) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  status(): TransportRuntimeStatus {
    return {
      id: this.id,
      available: true,
      implemented: true,
      detail: "In-memory store-and-forward queue. SQLite persistence is not implemented.",
    };
  }

  peekQueue(): readonly EncryptedEnvelope[] {
    return this.queue;
  }

  dequeue(): EncryptedEnvelope | undefined {
    return this.queue.shift();
  }

  get length(): number {
    return this.queue.length;
  }

  queuedCount(): number {
    return this.queue.length;
  }
}
