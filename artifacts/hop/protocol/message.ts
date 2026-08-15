// Ported from packages/protocol/src/message.ts (jaydaexx-oss/hop)
// No bugs in this file — faithfully reproduced.

export const MessageStatus = {
  CREATED: 'CREATED',
  ENCRYPTED: 'ENCRYPTED',
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  RELAYING: 'RELAYING',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;

export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_HOPS = 8;

export interface HopMessage {
  message_id: string;
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  /** ciphertext only — never a plaintext body */
  encrypted_payload: string;
  created_at: string;
  expires_at: string;
  ttl: number;
  hop_count: number;
  status: MessageStatus;
}

export interface CreateMessageInput {
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  /** plaintext content, stored locally until encrypted */
  plaintext?: string;
  ttl_ms?: number;
  now?: Date;
}

export function createMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older RN)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createMessage(input: CreateMessageInput): HopMessage {
  const now = input.now ?? new Date();
  const ttl = input.ttl_ms ?? DEFAULT_TTL_MS;
  return {
    message_id: createMessageId(),
    sender_id: input.sender_id,
    recipient_id: input.recipient_id,
    conversation_id: input.conversation_id,
    encrypted_payload: '',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl).toISOString(),
    ttl,
    hop_count: 0,
    status: MessageStatus.CREATED,
  };
}

export function isExpired(
  message: Pick<HopMessage, 'expires_at'>,
  now = new Date(),
): boolean {
  return now.getTime() >= Date.parse(message.expires_at);
}

export function shouldStopForwarding(
  message: Pick<HopMessage, 'expires_at' | 'hop_count'>,
  now = new Date(),
  maxHops = MAX_HOPS,
): boolean {
  return message.hop_count >= maxHops || isExpired(message, now);
}
