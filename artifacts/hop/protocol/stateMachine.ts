// Ported from packages/protocol/src/stateMachine.ts (jaydaexx-oss/hop)
//
// BUG FIXED: transition() used to throw IllegalStateTransitionError when a
// message was expired but the caller requested a non-EXPIRED status. The error
// message said "Illegal message transition: SENDING -> DELIVERED" even though
// the real cause was expiry, making debugging impossible. Now throws a distinct
// ExpiredMessageError so callers can distinguish the two failure modes.

import { MessageStatus, isExpired, type HopMessage } from './message';

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly from: MessageStatus,
    public readonly to: MessageStatus,
  ) {
    super(`Illegal message transition: ${from} -> ${to}`);
    this.name = 'IllegalStateTransitionError';
  }
}

// FIX (bug 3): new error class so callers can distinguish expiry from a
// truly illegal transition rather than catching a misleadingly-labelled
// IllegalStateTransitionError.
export class ExpiredMessageError extends Error {
  constructor(
    public readonly status: MessageStatus,
    public readonly attemptedTo: MessageStatus,
  ) {
    super(
      `Cannot transition expired message from ${status} to ${attemptedTo}. ` +
        `Transition to EXPIRED instead.`,
    );
    this.name = 'ExpiredMessageError';
  }
}

export const ALLOWED_TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  CREATED:   [MessageStatus.ENCRYPTED, MessageStatus.FAILED, MessageStatus.EXPIRED],
  ENCRYPTED: [MessageStatus.QUEUED,    MessageStatus.FAILED, MessageStatus.EXPIRED],
  QUEUED:    [MessageStatus.SENDING,   MessageStatus.FAILED, MessageStatus.EXPIRED],
  SENDING:   [MessageStatus.SENT, MessageStatus.QUEUED, MessageStatus.FAILED, MessageStatus.EXPIRED],
  SENT:      [MessageStatus.DELIVERED, MessageStatus.RELAYING, MessageStatus.FAILED, MessageStatus.EXPIRED],
  RELAYING:  [MessageStatus.DELIVERED, MessageStatus.RELAYING, MessageStatus.FAILED, MessageStatus.EXPIRED],
  DELIVERED: [MessageStatus.READ],
  READ:      [],
  FAILED:    [],
  EXPIRED:   [],
};

export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transition(
  message: HopMessage,
  to: MessageStatus,
  now = new Date(),
): HopMessage {
  // FIX (bug 3): if the message is expired and the caller is NOT transitioning
  // to EXPIRED, throw ExpiredMessageError (not IllegalStateTransitionError) so
  // the failure reason is clear.
  if (isExpired(message, now) && to !== MessageStatus.EXPIRED) {
    throw new ExpiredMessageError(message.status, to);
  }
  if (!canTransition(message.status, to)) {
    throw new IllegalStateTransitionError(message.status, to);
  }
  return { ...message, status: to };
}
