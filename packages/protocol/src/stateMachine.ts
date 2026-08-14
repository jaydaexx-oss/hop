import { MessageStatus, isExpired, type HopMessage } from "./message.js";

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly from: MessageStatus,
    public readonly to: MessageStatus,
  ) {
    super(`Illegal message transition: ${from} -> ${to}`);
    this.name = "IllegalStateTransitionError";
  }
}

export const ALLOWED_TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  CREATED: [MessageStatus.ENCRYPTED, MessageStatus.FAILED, MessageStatus.EXPIRED],
  ENCRYPTED: [MessageStatus.QUEUED, MessageStatus.FAILED, MessageStatus.EXPIRED],
  QUEUED: [MessageStatus.SENDING, MessageStatus.FAILED, MessageStatus.EXPIRED],
  SENDING: [
    MessageStatus.SENT,
    MessageStatus.QUEUED,
    MessageStatus.FAILED,
    MessageStatus.EXPIRED,
  ],
  SENT: [
    MessageStatus.DELIVERED,
    MessageStatus.RELAYING,
    MessageStatus.FAILED,
    MessageStatus.EXPIRED,
  ],
  RELAYING: [
    MessageStatus.DELIVERED,
    MessageStatus.RELAYING,
    MessageStatus.FAILED,
    MessageStatus.EXPIRED,
  ],
  DELIVERED: [MessageStatus.READ],
  READ: [],
  FAILED: [],
  EXPIRED: [],
};

export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transition(message: HopMessage, to: MessageStatus, now = new Date()): HopMessage {
  if (isExpired(message, now) && to !== MessageStatus.EXPIRED) {
    throw new IllegalStateTransitionError(message.status, to);
  }
  if (!canTransition(message.status, to)) {
    throw new IllegalStateTransitionError(message.status, to);
  }
  return { ...message, status: to };
}
