import { describe, expect, it } from 'vitest';
import {
  conversationIsActivelyViewed,
  formatUnreadBadge,
  MessageStatus,
  formatMessageStatus,
} from '@hop/protocol';

describe('chat unread and read-receipt UI helpers', () => {
  it('does not mark read from list render, background, or launch', () => {
    expect(conversationIsActivelyViewed({ isConversationScreenFocused: false, appState: 'active' })).toBe(false);
    expect(conversationIsActivelyViewed({ isConversationScreenFocused: true, appState: 'background' })).toBe(false);
    expect(conversationIsActivelyViewed({ isConversationScreenFocused: true, appState: 'inactive' })).toBe(false);
    expect(conversationIsActivelyViewed({ isConversationScreenFocused: true, appState: 'active' })).toBe(true);
  });

  it('formats unread badges and keeps bubble labels', () => {
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(1)).toBe('1');
    expect(formatUnreadBadge(99)).toBe('99');
    expect(formatUnreadBadge(100)).toBe('99+');
    expect(formatMessageStatus(MessageStatus.QUEUED)).toBe('Queued');
    expect(formatMessageStatus(MessageStatus.SENDING)).toBe('Sending');
    expect(formatMessageStatus(MessageStatus.SENT)).toBe('Sent');
    expect(formatMessageStatus(MessageStatus.DELIVERED)).toBe('Delivered');
    expect(formatMessageStatus(MessageStatus.READ)).toBe('Read');
    expect(formatMessageStatus(MessageStatus.FAILED)).toBe('Failed');
  });
});
