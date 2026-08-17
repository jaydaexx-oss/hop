import { MessageStatus } from "./message.js";
import type { ApplicationPlaintext } from "./cryptoBox.js";
import type { StoredMessage } from "./store.js";

/** Application-layer receipt protocol. Carried inside crypto_box, never as HTTP status. */
export const ACK_PROTOCOL_VERSION = 1;

export const AckType = {
  DELIVERED_ACK: "DELIVERED_ACK",
  READ_ACK: "READ_ACK",
} as const;

export type AckType = (typeof AckType)[keyof typeof AckType];

export interface ValidatedAck {
  ack_of: string;
  ack_type: AckType;
  ack_status: "DELIVERED" | "READ";
  ack_v: number;
  message_id: string;
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
}

export function ackTypeFromStatus(status: "DELIVERED" | "READ"): AckType {
  return status === "READ" ? AckType.READ_ACK : AckType.DELIVERED_ACK;
}

export function ackStatusFromType(type: AckType): "DELIVERED" | "READ" {
  return type === AckType.READ_ACK ? "READ" : "DELIVERED";
}

export function isAckType(value: unknown): value is AckType {
  return value === AckType.DELIVERED_ACK || value === AckType.READ_ACK;
}

/**
 * READ_ACK is only generated when this conversation is the focused foreground screen.
 * Push arrival, app launch, and conversation-list render must not call this.
 */
export function conversationIsActivelyViewed(input: {
  isConversationScreenFocused: boolean;
  appState: string;
}): boolean {
  return input.isConversationScreenFocused === true && input.appState === "active";
}

export function compactAckPlaintext(plain: ApplicationPlaintext, ack: ValidatedAck): ApplicationPlaintext {
  return {
    message_id: ack.message_id,
    sender_id: ack.sender_id,
    recipient_id: ack.recipient_id,
    conversation_id: ack.conversation_id,
    text: "",
    created_at: plain.created_at,
    expires_at: plain.expires_at,
    ttl: plain.ttl,
    hop_count: 0,
    kind: "delivery_ack",
    ack_of: ack.ack_of,
    ack_type: ack.ack_type,
    ack_status: ack.ack_status,
    ack_v: ACK_PROTOCOL_VERSION,
  };
}

/**
 * Authenticated receipt body. Rejects forged-looking fields, content-bearing acks,
 * unknown versions, and inconsistent type/status pairs. Does not authorize against
 * local message state — callers must still bind sender/session/conversation.
 */
export function parseAckPlain(plain: Partial<ApplicationPlaintext> | null | undefined): ValidatedAck | null {
  if (!plain || plain.kind !== "delivery_ack") return null;
  if (typeof plain.message_id !== "string" || !plain.message_id) return null;
  if (typeof plain.ack_of !== "string" || !plain.ack_of) return null;
  if (typeof plain.sender_id !== "string" || !plain.sender_id) return null;
  if (typeof plain.recipient_id !== "string" || !plain.recipient_id) return null;
  if (typeof plain.conversation_id !== "string" || !plain.conversation_id) return null;
  if (plain.ack_of === plain.message_id) return null;
  if (typeof plain.text === "string" && plain.text.trim()) return null;
  if (plain.audio_b64 || plain.audio) return null;

  if (plain.ack_v != null && plain.ack_v !== ACK_PROTOCOL_VERSION) return null;
  const ack_v = plain.ack_v ?? ACK_PROTOCOL_VERSION;

  let ack_type: AckType | null = null;
  let ack_status: "DELIVERED" | "READ" | null = null;
  if (isAckType(plain.ack_type)) ack_type = plain.ack_type;
  else if (plain.ack_type != null) return null;
  if (plain.ack_status === "DELIVERED" || plain.ack_status === "READ") ack_status = plain.ack_status;
  else if (plain.ack_status != null) return null;
  if (!ack_type && !ack_status) return null;
  if (ack_type && ack_status && ackStatusFromType(ack_type) !== ack_status) return null;
  if (!ack_type && ack_status) ack_type = ackTypeFromStatus(ack_status);
  if (!ack_status && ack_type) ack_status = ackStatusFromType(ack_type);
  if (!ack_type || !ack_status) return null;

  return {
    ack_of: plain.ack_of,
    ack_type,
    ack_status,
    ack_v,
    message_id: plain.message_id,
    sender_id: plain.sender_id,
    recipient_id: plain.recipient_id,
    conversation_id: plain.conversation_id,
  };
}

export function assertAckPlain(plain: ApplicationPlaintext): ValidatedAck {
  const parsed = parseAckPlain(plain);
  if (!parsed) {
    throw new Error("delivery_ack is malformed");
  }
  return parsed;
}

/** Receipt chain rank. FAILED is a local retry outcome, not above SENT. */
export function receiptRank(status: string): number {
  switch (status) {
    case MessageStatus.READ:
      return 80;
    case MessageStatus.DELIVERED:
      return 70;
    case MessageStatus.RELAYING:
    case MessageStatus.SENT:
      return 60;
    case MessageStatus.SENDING:
      return 50;
    case MessageStatus.RETRYING:
      return 40;
    case MessageStatus.QUEUED:
      return 30;
    case MessageStatus.ENCRYPTED:
      return 20;
    case MessageStatus.ENCRYPTING:
      return 10;
    case MessageStatus.CREATED:
      return 0;
    case MessageStatus.FAILED:
      return -10;
    case MessageStatus.EXPIRED:
      return -20;
    default:
      return -100;
  }
}

/**
 * Never regress SENT → DELIVERED → READ. READ + delayed DELIVERED stays READ.
 * FAILED may advance to DELIVERED/READ when a late crypto ACK arrives.
 * EXPIRED stays expired.
 */
export function mergePersistedStatus(current: string, incoming: string): string {
  if (current === incoming) return current;
  if (current === MessageStatus.EXPIRED) return MessageStatus.EXPIRED;
  if (current === MessageStatus.READ) return MessageStatus.READ;
  if (current === MessageStatus.DELIVERED) {
    return incoming === MessageStatus.READ ? MessageStatus.READ : MessageStatus.DELIVERED;
  }
  if (current === MessageStatus.FAILED) {
    if (
      incoming === MessageStatus.QUEUED ||
      incoming === MessageStatus.DELIVERED ||
      incoming === MessageStatus.READ
    ) {
      return incoming;
    }
    return MessageStatus.FAILED;
  }
  if (receiptRank(current) >= receiptRank(MessageStatus.SENT) && receiptRank(incoming) < receiptRank(MessageStatus.SENT)) {
    if (incoming === MessageStatus.FAILED || incoming === MessageStatus.EXPIRED) return incoming;
    return current;
  }
  return incoming;
}

export function isVisibleChatKind(kind: StoredMessage["kind"] | null | undefined): boolean {
  return kind !== "delivery_ack";
}

/** Unread = inbound chat rows still in DELIVERED (accepted, not yet read). */
export function isUnreadInbound(message: Pick<StoredMessage, "sender_id" | "status" | "kind">, viewerId: string): boolean {
  if (!viewerId || message.sender_id === viewerId) return false;
  if (!isVisibleChatKind(message.kind)) return false;
  return message.status === MessageStatus.DELIVERED;
}

export function countUnread(messages: Array<Pick<StoredMessage, "sender_id" | "status" | "kind">>, viewerId: string): number {
  let n = 0;
  for (const row of messages) {
    if (isUnreadInbound(row, viewerId)) n += 1;
  }
  return n;
}

export function formatUnreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (count > 99) return "99+";
  return String(Math.floor(count));
}
