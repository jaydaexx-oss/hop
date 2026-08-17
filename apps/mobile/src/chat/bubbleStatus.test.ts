import { describe, expect, it } from 'vitest';
import {
  MessageStatus,
  formatMessageStatus,
  isFailedMessageStatus,
  isInFlightOutboundStatus,
} from '@hop/protocol';

describe('chat bubble delivery labels', () => {
  it('shows Queued, Sending, Sent, Delivered, Read, Failed', () => {
    expect(formatMessageStatus(MessageStatus.QUEUED)).toBe('Queued');
    expect(formatMessageStatus(MessageStatus.SENDING)).toBe('Sending');
    expect(formatMessageStatus(MessageStatus.SENT)).toBe('Sent');
    expect(formatMessageStatus(MessageStatus.DELIVERED)).toBe('Delivered');
    expect(formatMessageStatus(MessageStatus.READ)).toBe('Read');
    expect(formatMessageStatus(MessageStatus.FAILED)).toBe('Failed');
  });

  it('treats failed bubbles as retryable and queued as in-flight', () => {
    expect(isFailedMessageStatus(MessageStatus.FAILED)).toBe(true);
    expect(isFailedMessageStatus(MessageStatus.SENT)).toBe(false);
    expect(isInFlightOutboundStatus(MessageStatus.QUEUED)).toBe(true);
    expect(isInFlightOutboundStatus(MessageStatus.RETRYING)).toBe(true);
    expect(isInFlightOutboundStatus(MessageStatus.SENT)).toBe(false);
  });
});
