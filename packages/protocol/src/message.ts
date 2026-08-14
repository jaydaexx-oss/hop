import { createMessageId } from "./ids.js";
import type { TransportId } from "./transport.js";

export const MessageStatus = {
  CREATED: "CREATED",
  ENCRYPTED: "ENCRYPTED",
  QUEUED: "QUEUED",
  SENDING: "SENDING",
  SENT: "SENT",
  RELAYING: "RELAYING",
  DELIVERED: "DELIVERED",
  READ: "READ",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
} as const;

export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_HOPS = 8;

export interface HopMessage {
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
  status: MessageStatus;
}

export interface CreateMessageInput {
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  ttl_ms?: number;
  now?: Date;
}

export function createMessage(input: CreateMessageInput): HopMessage {
  const now = input.now ?? new Date();
  const ttl = input.ttl_ms ?? DEFAULT_TTL_MS;
  const created = now.toISOString();
  const expires = new Date(now.getTime() + ttl).toISOString();

  return {
    message_id: createMessageId(),
    sender_id: input.sender_id,
    recipient_id: input.recipient_id,
    conversation_id: input.conversation_id,
    encrypted_payload: "",
    created_at: created,
    expires_at: expires,
    ttl,
    hop_count: 0,
    transport: "local",
    status: MessageStatus.CREATED,
  };
}

export function isExpired(message: Pick<HopMessage, "expires_at">, now = new Date()): boolean {
  return now.getTime() >= Date.parse(message.expires_at);
}

export function shouldStopForwarding(
  message: Pick<HopMessage, "expires_at" | "hop_count">,
  now = new Date(),
  maxHops = MAX_HOPS,
): boolean {
  return message.hop_count >= maxHops || isExpired(message, now);
}
