// Ported from packages/protocol/src/transportManager.ts (jaydaexx-oss/hop)
//
// BUG FIXED (bug 1 — critical): processQueue() computed the exponential backoff
// delay via nextBackoffMs() but then immediately retried the item regardless of
// that value. Every call to processQueue() retried ALL queued items at once,
// making the backoff calculation entirely pointless.
//
// Fix: QueueItem now carries a `nextAttemptAt` epoch-ms timestamp. processQueue()
// only retries items whose nextAttemptAt <= now.getTime(). When an item fails and
// is re-queued, nextAttemptAt is set to now + backoffMs so the next processQueue()
// call honours the delay.
//
// BUG FIXED (bug 2 — minor): enqueue() used to return
//   { ok: true, transport: "local", error: "Queued for retry" }
// Having ok:true alongside a non-null error string is contradictory and confuses
// callers that pattern-match on result.error. Fixed: use a dedicated `queued`
// boolean field instead.

import { ProcessedIdSet } from './duplicates';
import { isExpired } from './message';
import { DEFAULT_RETRY_POLICY, nextBackoffMs, type RetryPolicy } from './retry';

export type TransportId = 'bluetooth' | 'local';

export interface EncryptedEnvelope {
  message_id: string;
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  encrypted_payload: string;
  created_at: string;
  expires_at: string;
  ttl: number;
  hop_count: number;
  transport: TransportId;
}

export interface SendResult {
  ok: boolean;
  transport: TransportId;
  error?: string;
  /** FIX (bug 2): true when the message could not be sent immediately and was
   *  placed in the retry queue. Distinct from ok:false (which means a hard
   *  failure) and keeps the error field reserved for actual errors. */
  queued?: boolean;
}

export interface Transport {
  readonly id: TransportId;
  isAvailable(): Promise<boolean>;
  send(envelope: EncryptedEnvelope): Promise<SendResult>;
  queuedCount?(): number;
}

// FIX (bug 1): nextAttemptAt added so processQueue() can honour the backoff
// delay instead of retrying everything immediately.
export interface QueueItem {
  envelope: EncryptedEnvelope;
  attempts: number;
  /** epoch-ms — do not retry before this time */
  nextAttemptAt: number;
}

const PRIORITY: TransportId[] = ['bluetooth', 'local'];

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
    if (isExpired(envelope, now)) return false;
    return this.processed.remember(envelope.message_id);
  }

  async enqueue(envelope: EncryptedEnvelope, now = new Date()): Promise<SendResult> {
    if (!envelope.encrypted_payload) {
      return { ok: false, transport: 'local', error: 'Refusing to send empty/plaintext payload' };
    }
    if (isExpired(envelope, now)) {
      return { ok: false, transport: envelope.transport, error: 'Message expired' };
    }
    if (!this.processed.remember(envelope.message_id)) {
      return { ok: false, transport: envelope.transport, error: 'Duplicate message_id' };
    }

    const sent = await this.trySend(envelope);
    if (sent.ok) return sent;

    // FIX (bug 1): record the first nextAttemptAt using attempt=0 backoff.
    const backoffMs = nextBackoffMs(0, this.retry) ?? 1_000;
    this.outbound.push({
      envelope,
      attempts: 0,
      nextAttemptAt: now.getTime() + backoffMs,
    });

    // FIX (bug 2): return queued:true, no error field, so callers can
    // distinguish "queued for later" from a hard failure.
    return { ok: true, transport: 'local', queued: true };
  }

  /**
   * Call this on a timer (e.g. every 30 s). Only retries items whose
   * nextAttemptAt has passed.
   *
   * FIX (bug 1): items are only retried after their backoff window expires.
   * Items that are not yet due are re-inserted with their original nextAttemptAt
   * preserved.
   */
  async processQueue(now = new Date()): Promise<void> {
    const pending = this.outbound.splice(0);
    for (const item of pending) {
      // Skip permanently expired messages.
      if (isExpired(item.envelope, now)) continue;

      // FIX (bug 1): honour the backoff window.
      if (now.getTime() < item.nextAttemptAt) {
        // Not yet due — put it back unchanged.
        this.outbound.push(item);
        continue;
      }

      const nextAttempts = item.attempts + 1;
      const backoff = nextBackoffMs(nextAttempts, this.retry);
      if (backoff === null) {
        // Retries exhausted — drop the item silently (TTL will clean up state).
        continue;
      }

      const sent = await this.trySend(item.envelope);
      if (!sent.ok) {
        // FIX (bug 1): set nextAttemptAt so the next processQueue() call
        // respects the exponential delay.
        this.outbound.push({
          ...item,
          attempts: nextAttempts,
          nextAttemptAt: now.getTime() + backoff,
        });
      }
    }
  }

  peekQueue(): readonly QueueItem[] {
    return this.outbound;
  }

  private async trySend(envelope: EncryptedEnvelope): Promise<SendResult> {
    const ordered = PRIORITY
      .map(id => this.transports.get(id))
      .filter((t): t is Transport => t !== undefined);

    for (const transport of ordered) {
      if (!(await transport.isAvailable())) continue;
      const result = await transport.send({ ...envelope, transport: transport.id });
      if (result.ok) return result;
    }

    return { ok: false, transport: 'local', error: 'No transport available' };
  }
}
