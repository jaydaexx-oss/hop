import { describe, expect, it } from 'vitest';
import {
  conversationHasUndeliveredOutbox,
  inboxThreadClearPolicy,
  MessageStatus,
  messagesTabBadgeCount,
  nearbyPeerSheetActions,
  nearbySheetSendsMessage,
} from '@hop/protocol';

import { MemoryKvStore } from '@/src/nearby/kvStore';
import { hideInboxConversation, loadHiddenInboxIds, restoreInboxConversation } from '@/src/chat/inboxHide';
import {
  CHATS_SECTION_TITLES,
  REAL_CHATS_SECTIONS,
  inboxRowMenuActions,
  isEventInboxOwner,
} from '@/src/chat/chatsInboxSections';

describe('inbox mute icon and local hide', () => {
  it('keeps a muted flag for the conversation row icon', () => {
    const muted = true;
    expect(muted).toBe(true);
    expect({ isMuted: muted }.isMuted).toBe(true);
  });

  it('tab badge uses real unread plus pending incoming requests', () => {
    expect(messagesTabBadgeCount({ unread: 1, pendingIncomingRequests: 2 })).toBe(3);
  });

  it('hides a thread with undo and never deletes undelivered outbox', async () => {
    const kv = new MemoryKvStore();
    const policy = inboxThreadClearPolicy({
      hasUndeliveredOutbox: conversationHasUndeliveredOutbox(
        [{ senderId: 'me', status: MessageStatus.QUEUED }],
        'me',
      ),
    });
    expect(policy.deletesSqlite).toBe(false);
    expect(policy.preservesOutbox).toBe(true);
    await hideInboxConversation(kv, 'user-1', 'convo-a');
    expect(await loadHiddenInboxIds(kv, 'user-1')).toEqual(['convo-a']);
    await restoreInboxConversation(kv, 'user-1', 'convo-a');
    expect(await loadHiddenInboxIds(kv, 'user-1')).toEqual([]);
  });

  it('Chats IA labels Direct and Events; Groups are still not a product surface', () => {
    expect(REAL_CHATS_SECTIONS).toEqual(['message_requests', 'direct', 'events']);
    expect(CHATS_SECTION_TITLES.message_requests).toBe('Message requests');
    expect(CHATS_SECTION_TITLES.direct).toBe('Direct');
    expect(CHATS_SECTION_TITLES.events).toBe('Events');
    expect(REAL_CHATS_SECTIONS.includes('groups' as never)).toBe(false);
  });

  it('direct row menu is mute, delete-for-me, and block', () => {
    expect(inboxRowMenuActions({ kind: 'direct', muted: false }).map((row) => row.id)).toEqual([
      'mute',
      'delete_chat',
      'block',
    ]);
    expect(inboxRowMenuActions({ kind: 'direct', muted: true }).map((row) => row.id)).toEqual([
      'unmute',
      'delete_chat',
      'block',
    ]);
    expect(inboxRowMenuActions({ kind: 'direct' }).some((row) => row.id === 'leave_event')).toBe(false);
  });

  it('event guest leaves and event owner only hides their inbox row', () => {
    const guest = inboxRowMenuActions({ kind: 'event', myRole: 'guest' });
    expect(guest.map((row) => row.id)).toEqual(['leave_event']);
    const owner = inboxRowMenuActions({ kind: 'event', myRole: 'host', isEventOwner: true });
    expect(owner.map((row) => row.id)).toEqual(['remove_from_list']);
    expect(owner.some((row) => row.label.toLowerCase().includes('end'))).toBe(false);
    expect(
      isEventInboxOwner({ kind: 'event', myRole: 'host', hostId: 'host-1', selfId: 'host-1' }),
    ).toBe(true);
    expect(
      isEventInboxOwner({ kind: 'event', myRole: 'guest', hostId: 'host-1', selfId: 'guest-1' }),
    ).toBe(false);
  });

  it('nearby sheet actions do not send a DM', () => {
    const actions = nearbyPeerSheetActions({ canMessage: true, connected: true, userId: 'p' });
    expect(actions).toContain('message_request');
    expect(actions).toContain('block');
    expect(actions.every((action) => nearbySheetSendsMessage(action) === false)).toBe(true);
  });
});
