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
 * Deterministic conversation order. Same-sender streams follow monotonic send_seq
 * (survives clock skew, delayed BLE, retries). Cross-sender ties break on created_at
 * then message_id — never wall-clock alone.
 */
export function compareConversationMessages(a: ConversationOrderFields, b: ConversationOrderFields): number {
  if (a.sender_id === b.sender_id && a.send_seq != null && b.send_seq != null && a.send_seq !== b.send_seq) {
    return a.send_seq - b.send_seq;
  }
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? -1 : 1;
  }
  const seqA = a.send_seq ?? 0;
  const seqB = b.send_seq ?? 0;
  if (seqA !== seqB) return seqA - seqB;
  if (a.message_id === b.message_id) return 0;
  return a.message_id < b.message_id ? -1 : 1;
}

export function sortConversationMessages<T extends ConversationOrderFields>(rows: T[]): T[] {
  return [...rows].sort(compareConversationMessages);
}
