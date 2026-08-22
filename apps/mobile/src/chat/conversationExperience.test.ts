import { describe, expect, it } from 'vitest';
import {
  CHAT_PAGE_SIZE,
  MAX_APPLICATION_TEXT_CHARS,
  MessageStatus,
  applyOptimisticSendFailure,
  conversationIsActivelyViewed,
  formatMessageStatus,
  formatMessageStatusDescription,
  formatUnreadBadge,
  isComposerSendable,
  isFailedMessageStatus,
  mergeChatWindow,
  paginateConversationMessages,
  sameLogicalIdentity,
  shouldMarkConversationRead,
  sortInboxConversations,
  userFacingSendError,
} from '@hop/protocol';

import { storedToChat } from '@/src/chat/storedToChat';
import type { ChatMessage } from '@/src/api/hop';

function chat(
  message_id: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    message_id,
    sender_id: extra.sender_id ?? 'alice',
    recipient_id: extra.recipient_id ?? 'bob',
    conversation_id: extra.conversation_id ?? 'convo-a',
    text: extra.text ?? 'hello',
    status: extra.status ?? MessageStatus.SENT,
    created_at: extra.created_at ?? '2026-08-16T00:00:00.000Z',
    e2ee: true,
    send_seq: extra.send_seq ?? 1,
    retry_attempts: extra.retry_attempts,
    kind: extra.kind,
  };
}

describe('mobile conversation experience', () => {
  it('optimistic send keeps the canonical message_id from MessageService', () => {
    const allocated = storedToChat({
      message_id: '11111111-1111-4111-8111-111111111111',
      conversation_id: 'convo-a',
      sender_id: 'alice',
      recipient_id: 'bob',
      text: 'hello',
      encrypted_payload: '',
      status: MessageStatus.ENCRYPTING,
      transport: 'local',
      created_at: '2026-08-16T00:00:00.000Z',
      expires_at: '2026-08-23T00:00:00.000Z',
      ttl: 1,
      hop_count: 0,
      send_seq: 1,
    });
    const flushed = { ...allocated, status: MessageStatus.QUEUED, encrypted_payload: 'box' };
    const merged = mergeChatWindow([allocated], [flushed]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.message_id).toBe(allocated.message_id);
    expect(merged[0]?.status).toBe(MessageStatus.QUEUED);
  });

  it('renders queued, failed, retry, delivered, and read from protocol status only', () => {
    expect(formatMessageStatus(MessageStatus.QUEUED)).toBe('Queued');
    expect(formatMessageStatus(MessageStatus.FAILED)).toBe('Failed');
    expect(formatMessageStatus(MessageStatus.RETRYING)).toBe('Retrying');
    expect(formatMessageStatus(MessageStatus.DELIVERED)).toBe('Delivered');
    expect(formatMessageStatus(MessageStatus.READ)).toBe('Read');
    expect(formatMessageStatusDescription(MessageStatus.FAILED)).toContain('retry');
    expect(isFailedMessageStatus(MessageStatus.FAILED)).toBe(true);
  });

  it('retries the same message_id instead of cloning a bubble', () => {
    const failed = chat('msg-1', { status: MessageStatus.FAILED, send_seq: 4 });
    const retried = chat('msg-1', { status: MessageStatus.QUEUED, send_seq: 4 });
    const merged = mergeChatWindow([failed], [retried]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.message_id).toBe('msg-1');
    expect(merged[0]?.status).toBe(MessageStatus.QUEUED);
  });

  it('suppresses duplicate logical delivery from BLE and HTTPS', () => {
    const ble = chat('msg-1', { created_at: '2026-08-16T00:00:00.000Z' });
    const https = chat('msg-1', { created_at: '2026-08-16T00:00:09.000Z' });
    expect(sameLogicalIdentity(ble, https)).toBe(true);
    expect(mergeChatWindow([ble], [https])).toHaveLength(1);
  });

  it('paginates without reordering newer messages', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      chat(`m${i}`, { send_seq: i + 1, created_at: `2026-08-16T00:00:0${i}.000Z` }),
    );
    const latest = paginateConversationMessages(rows, { limit: 3 });
    const older = paginateConversationMessages(rows, { beforeMessageId: latest.rows[0]!.message_id, limit: 3 });
    expect(latest.rows.map((row) => row.message_id)).toEqual(['m5', 'm6', 'm7']);
    expect(older.rows.map((row) => row.message_id)).toEqual(['m2', 'm3', 'm4']);
    expect(mergeChatWindow(latest.rows, older.rows).map((row) => row.message_id)).toEqual([
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
    ]);
    expect(CHAT_PAGE_SIZE).toBe(50);
  });

  it('keeps unread badges and never marks READ from background rendering', () => {
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(4)).toBe('4');
    expect(shouldMarkConversationRead({ isConversationScreenFocused: true, appState: 'background' })).toBe(false);
    expect(conversationIsActivelyViewed({ isConversationScreenFocused: false, appState: 'active' })).toBe(false);
    expect(shouldMarkConversationRead({ isConversationScreenFocused: true, appState: 'active' })).toBe(true);
  });

  it('orders conversations by last visible activity, not delayed receipts', () => {
    const items = [
      {
        id: 'old',
        created_at: '2026-08-01T00:00:00.000Z',
        last: { message_id: 'a', sender_id: 'bob', created_at: '2026-08-16T00:00:00.000Z', send_seq: 1 },
      },
      {
        id: 'new',
        created_at: '2026-07-01T00:00:00.000Z',
        last: { message_id: 'b', sender_id: 'alice', created_at: '2026-08-16T00:10:00.000Z', send_seq: 1 },
      },
    ];
    expect(sortInboxConversations(items).map((item) => item.id)).toEqual(['new', 'old']);
    const afterAck = [
      { ...items[0]!, last: { ...items[0]!.last!, created_at: items[0]!.last!.created_at } },
      items[1]!,
    ];
    expect(sortInboxConversations(afterAck).map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('applies rapid receipt updates onto one bubble', () => {
    let window = [chat('msg-1', { status: MessageStatus.SENT })];
    window = mergeChatWindow(window, [chat('msg-1', { status: MessageStatus.DELIVERED })]);
    window = mergeChatWindow(window, [chat('msg-1', { status: MessageStatus.READ })]);
    window = mergeChatWindow(window, [chat('msg-1', { status: MessageStatus.DELIVERED })]);
    expect(window).toHaveLength(1);
    expect(window[0]?.status).toBe(MessageStatus.READ);
  });

  it('recovers offline queued messages without duplicating the bubble', () => {
    const queued = chat('msg-1', { status: MessageStatus.QUEUED });
    const sent = chat('msg-1', { status: MessageStatus.SENT });
    expect(mergeChatWindow([queued], [sent])).toHaveLength(1);
    expect(mergeChatWindow([queued], [sent])[0]?.status).toBe(MessageStatus.SENT);
  });

  it('keeps the composer disabled for empty text and within protocol limits', () => {
    expect(isComposerSendable('')).toBe(false);
    expect(isComposerSendable('   ')).toBe(false);
    expect(isComposerSendable('ok')).toBe(true);
    expect(isComposerSendable('x'.repeat(MAX_APPLICATION_TEXT_CHARS + 1))).toBe(false);
  });

  it('does not show crypto or database errors in the chat UI', () => {
    expect(userFacingSendError(new Error('crypto_box nonce'))).toBe('Could not send this message securely.');
    expect(userFacingSendError(new Error('SQLITE_ERROR'))).toBe('Could not send this message.');
    expect(storedToChat({
      message_id: 'id',
      conversation_id: 'c',
      sender_id: 'a',
      recipient_id: 'b',
      text: 'visible',
      encrypted_payload: 'CIPHERTEXT_MUST_NOT_RENDER',
      status: MessageStatus.SENT,
      transport: 'internet',
      created_at: '2026-08-16T00:00:00.000Z',
      expires_at: '2026-08-23T00:00:00.000Z',
      ttl: 1,
      hop_count: 0,
    }).text).toBe('visible');
  });

  it('optimistic voice send keeps one bubble and the same message_id', () => {
    const allocated = storedToChat({
      message_id: '22222222-2222-4222-8222-222222222222',
      conversation_id: 'convo-a',
      sender_id: 'alice',
      recipient_id: 'bob',
      text: 'Voice message',
      encrypted_payload: '',
      status: MessageStatus.ENCRYPTING,
      transport: 'local',
      created_at: '2026-08-16T00:00:00.000Z',
      expires_at: '2026-08-23T00:00:00.000Z',
      ttl: 1,
      hop_count: 0,
      send_seq: 2,
      kind: 'voice',
      duration_ms: 1500,
      audio_b64: 'QQ==',
    });
    const flushed = { ...allocated, status: MessageStatus.QUEUED, encrypted_payload: 'box' };
    const merged = mergeChatWindow([allocated], [flushed]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.message_id).toBe(allocated.message_id);
    expect(merged[0]?.kind).toBe('voice');
    expect(merged[0]?.status).toBe(MessageStatus.QUEUED);
  });

  it('does not let a post-send load error mark a SENT bubble Failed', () => {
    const allocated = chat('msg-1', { status: MessageStatus.ENCRYPTING });
    const sent = chat('msg-1', { status: MessageStatus.SENT });
    const recovered = applyOptimisticSendFailure(mergeChatWindow([allocated], [sent]), 'msg-1');
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.status).toBe(MessageStatus.SENT);
    expect(applyOptimisticSendFailure([allocated], 'msg-1')[0]?.status).toBe(MessageStatus.FAILED);
  });
});
