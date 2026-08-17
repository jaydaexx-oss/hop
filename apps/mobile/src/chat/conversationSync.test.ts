import { describe, expect, it } from 'vitest';
import {
  MessageStatus,
  compareConversationMessages,
  mergePersistedStatus,
  sameLogicalIdentity,
  sortConversationMessages,
} from '@hop/protocol';

function row(
  message_id: string,
  sender_id: string,
  send_seq: number,
  created_at: string,
  conversation_id = 'convo-a',
) {
  return { message_id, sender_id, send_seq, created_at, conversation_id };
}

describe('mobile conversation convergence helpers', () => {
  it('renders 1000 shuffled messages in a stable send_seq / id order', () => {
    const messages = Array.from({ length: 1000 }, (_, i) =>
      row(
        `id-${String(i).padStart(4, '0')}`,
        i % 2 === 0 ? 'alice' : 'bob',
        Math.floor(i / 2) + 1,
        `2026-08-16T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      ),
    );
    const reversed = sortConversationMessages([...messages].reverse());
    const random = sortConversationMessages(
      [...messages].sort((a, b) => (a.message_id < b.message_id ? 1 : -1)),
    );
    const forward = sortConversationMessages(messages);
    expect(reversed.map((item) => item.message_id)).toEqual(forward.map((item) => item.message_id));
    expect(random.map((item) => item.message_id)).toEqual(forward.map((item) => item.message_id));
    expect(forward).toHaveLength(1000);
    const alice = forward.filter((item) => item.sender_id === 'alice').map((item) => item.send_seq);
    expect(alice).toEqual([...alice].sort((a, b) => a - b));
  });

  it('keeps the same logical identity across duplicate BLE and HTTPS copies', () => {
    const ble = row('msg-1', 'alice', 1, '2026-08-16T00:00:00.000Z');
    const https = { ...ble, created_at: '2026-08-16T00:00:09.000Z' };
    expect(sameLogicalIdentity(ble, https)).toBe(true);
    expect(sameLogicalIdentity(ble, row('msg-2', 'alice', 1, ble.created_at))).toBe(false);
    expect(sameLogicalIdentity(ble, row('msg-1', 'alice', 1, ble.created_at, 'convo-b'))).toBe(false);
  });

  it('orders reverse, random, same-timestamp, and clock-skewed copies identically', () => {
    const skewed = [
      row('a2', 'alice', 2, '2026-01-01T00:00:00.000Z'),
      row('a1', 'alice', 1, '2026-12-01T00:00:00.000Z'),
      row('b1', 'bob', 1, '2026-08-16T00:00:00.000Z'),
    ];
    const sameTs = [
      row('m-b', 'bob', 1, '2026-08-16T12:00:00.000Z'),
      row('m-a', 'alice', 1, '2026-08-16T12:00:00.000Z'),
    ];
    expect(sortConversationMessages(skewed).map((item) => item.message_id)).toEqual(['b1', 'a1', 'a2']);
    expect(sortConversationMessages([...skewed].reverse()).map((item) => item.message_id)).toEqual([
      'b1',
      'a1',
      'a2',
    ]);
    expect(sortConversationMessages(sameTs).map((item) => item.message_id)).toEqual(['m-a', 'm-b']);
    expect(compareConversationMessages(skewed[1]!, skewed[0]!)).toBeLessThan(0);
  });

  it('never regresses READ when a stale DELIVERED ack arrives after READ-before-DELIVERED', () => {
    const readFirst = mergePersistedStatus(MessageStatus.SENT, MessageStatus.READ);
    expect(readFirst).toBe(MessageStatus.READ);
    expect(mergePersistedStatus(readFirst, MessageStatus.DELIVERED)).toBe(MessageStatus.READ);
    expect(mergePersistedStatus(MessageStatus.DELIVERED, MessageStatus.SENT)).toBe(MessageStatus.DELIVERED);
    expect(mergePersistedStatus(MessageStatus.ENCRYPTING, MessageStatus.CREATED)).toBe(
      MessageStatus.ENCRYPTING,
    );
    expect(mergePersistedStatus(MessageStatus.QUEUED, MessageStatus.ENCRYPTING)).toBe(MessageStatus.QUEUED);
  });

  it('treats duplicate synchronization of two conversations as independent identities', () => {
    const a = row('shared-looking', 'alice', 1, '2026-08-16T00:00:00.000Z', 'convo-a');
    const b = row('shared-looking', 'alice', 1, '2026-08-16T00:00:00.000Z', 'convo-b');
    expect(sameLogicalIdentity(a, a)).toBe(true);
    expect(sameLogicalIdentity(a, b)).toBe(false);
    const mixed = sortConversationMessages([
      row('b2', 'bob', 2, '2026-08-16T00:00:04.000Z'),
      row('a1', 'alice', 1, '2026-08-16T00:00:01.000Z'),
      row('b1', 'bob', 1, '2026-08-16T00:00:02.000Z'),
      row('a2', 'alice', 2, '2026-08-16T00:00:03.000Z'),
    ]);
    expect(mixed.map((item) => item.message_id)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });
});
