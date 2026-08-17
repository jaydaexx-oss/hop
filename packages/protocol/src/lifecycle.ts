import { MessageStatus } from "./message.js";

/**
 * Canonical outbound lifecycle (product spec).
 * Persisted SQLite values stay UPPERCASE MessageStatus for compatibility.
 *
 * queued → encrypting → ready → sending → sent → delivered → read
 * recovery: retrying, failed
 *
 * Mapping:
 *   CREATED / ENCRYPTING     → queued / encrypting
 *   ENCRYPTED                → encrypting (ciphertext exists)
 *   QUEUED                   → ready (attempts=0) or retrying (attempts>0)
 *   RETRYING                 → retrying
 *   SENDING                  → sending
 *   SENT / RELAYING          → sent  (transport accepted; NOT delivered)
 *   DELIVERED                → delivered  (recipient crypto_box delivery_ack)
 *   READ                     → read
 *   FAILED / EXPIRED         → failed
 */
export const CanonicalLifecycle = {
  queued: "queued",
  encrypting: "encrypting",
  ready: "ready",
  sending: "sending",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  retrying: "retrying",
  failed: "failed",
} as const;

export type CanonicalLifecycle = (typeof CanonicalLifecycle)[keyof typeof CanonicalLifecycle];

/** Transport accepted vs recipient device vs recipient read. HTTP 200 is never delivered. */
export const AckLayer = {
  transport_accepted: "transport_accepted",
  delivered: "delivered",
  read: "read",
} as const;

export type AckLayer = (typeof AckLayer)[keyof typeof AckLayer];

/** Durable outbox cap. Prevents unbounded SQLite growth and retry storms. */
export const MAX_OUTBOX_MESSAGES = 256;

export const OUTBOX_STATUSES: readonly string[] = [
  MessageStatus.QUEUED,
  MessageStatus.RETRYING,
  MessageStatus.SENDING,
];

export function isOutboxStatus(status: string): boolean {
  return (
    status === MessageStatus.QUEUED ||
    status === MessageStatus.RETRYING ||
    status === MessageStatus.SENDING
  );
}

export function isTransportAcceptedStatus(status: string): boolean {
  return (
    status === MessageStatus.SENT ||
    status === MessageStatus.RELAYING ||
    status === MessageStatus.DELIVERED ||
    status === MessageStatus.READ
  );
}

export function canonicalLifecycle(status: string, retryAttempts = 0): CanonicalLifecycle {
  switch (status) {
    case MessageStatus.CREATED:
      return CanonicalLifecycle.queued;
    case MessageStatus.ENCRYPTING:
    case MessageStatus.ENCRYPTED:
      return CanonicalLifecycle.encrypting;
    case MessageStatus.QUEUED:
      return retryAttempts > 0 ? CanonicalLifecycle.retrying : CanonicalLifecycle.ready;
    case MessageStatus.RETRYING:
      return CanonicalLifecycle.retrying;
    case MessageStatus.SENDING:
      return CanonicalLifecycle.sending;
    case MessageStatus.SENT:
    case MessageStatus.RELAYING:
      return CanonicalLifecycle.sent;
    case MessageStatus.DELIVERED:
      return CanonicalLifecycle.delivered;
    case MessageStatus.READ:
      return CanonicalLifecycle.read;
    case MessageStatus.FAILED:
    case MessageStatus.EXPIRED:
      return CanonicalLifecycle.failed;
    default:
      return CanonicalLifecycle.queued;
  }
}

export function ackLayerFromStatus(status: string): AckLayer | null {
  if (status === MessageStatus.READ) return AckLayer.read;
  if (status === MessageStatus.DELIVERED) return AckLayer.delivered;
  if (isTransportAcceptedStatus(status)) return AckLayer.transport_accepted;
  return null;
}

export interface ConversationOrderFields {
  message_id: string;
  sender_id: string;
  created_at: string;
  send_seq?: number | null;
}

/**
 * Conversation convergence order (not a second sync protocol).
 *
 * Each sender has a causal stream ordered by `send_seq` (monotonic per sender,
 * assigned at encrypt time, carried inside crypto_box). Streams are merged by a
 * cycle-free key of authenticated plaintext fields:
 *   (created_at, sender_id, send_seq, message_id)
 *
 * Pairwise "same-sender by seq else by created_at" can cycle under clock jumps.
 * `sortConversationMessages` therefore merge-sorts per-sender streams so both
 * devices render the same order after BLE/Internet/duplicates/out-of-order
 * delivery. Wall-clock is never used alone; receive-time is never used.
 */
export function compareSenderStream(a: ConversationOrderFields, b: ConversationOrderFields): number {
  if (a.message_id === b.message_id) return 0;
  const seqA = a.send_seq;
  const seqB = b.send_seq;
  if (seqA != null && seqB != null && seqA !== seqB) return seqA - seqB;
  if (seqA != null && seqB == null) return -1;
  if (seqA == null && seqB != null) return 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.message_id < b.message_id ? -1 : 1;
}

/** Merge key for heads of per-sender streams. Cycle-free total order. */
export function compareMergeKey(a: ConversationOrderFields, b: ConversationOrderFields): number {
  if (a.message_id === b.message_id) return 0;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.sender_id !== b.sender_id) return a.sender_id < b.sender_id ? -1 : 1;
  const seqA = a.send_seq ?? 0;
  const seqB = b.send_seq ?? 0;
  if (seqA !== seqB) return seqA - seqB;
  return a.message_id < b.message_id ? -1 : 1;
}

/**
 * Pairwise helper: same sender uses the causal stream; different senders use the
 * merge key. Do not rely on transitivity across mixed pairs — use
 * `sortConversationMessages` to render a conversation.
 */
export function compareConversationMessages(a: ConversationOrderFields, b: ConversationOrderFields): number {
  if (a.message_id === b.message_id) return 0;
  if (a.sender_id === b.sender_id) return compareSenderStream(a, b);
  return compareMergeKey(a, b);
}

export function sortConversationMessages<T extends ConversationOrderFields>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const list = groups.get(row.sender_id);
    if (list) list.push(row);
    else groups.set(row.sender_id, [row]);
  }
  const streams = [...groups.values()].map((list) => [...list].sort(compareSenderStream));
  const heads = streams.map(() => 0);
  const out: T[] = [];
  for (;;) {
    let best = -1;
    for (let i = 0; i < streams.length; i++) {
      const index = heads[i]!;
      const stream = streams[i]!;
      if (index >= stream.length) continue;
      if (best < 0 || compareMergeKey(stream[index]!, streams[best]![heads[best]!]!) < 0) {
        best = i;
      }
    }
    if (best < 0) break;
    out.push(streams[best]![heads[best]!]!);
    heads[best]! += 1;
  }
  return out;
}

export function sameLogicalIdentity(
  a: Pick<ConversationOrderFields, "message_id"> & { conversation_id?: string; sender_id?: string },
  b: Pick<ConversationOrderFields, "message_id"> & { conversation_id?: string; sender_id?: string },
): boolean {
  if (a.message_id !== b.message_id) return false;
  if (a.conversation_id && b.conversation_id && a.conversation_id !== b.conversation_id) return false;
  if (a.sender_id && b.sender_id && a.sender_id !== b.sender_id) return false;
  return true;
}
