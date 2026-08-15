/**
 * Tests for HopContext's inbox sort behaviour.
 *
 * Verifies that conversations and groups are always kept in descending
 * last-message-timestamp order after every state-mutating action:
 *   • sendMessage / sendGroupMessage — user's outgoing message sorts immediately
 *   • Bot reply burst — two delayed bot-reply callbacks arriving in rapid succession
 *     (fake timers, doNotFake setImmediate so React's scheduler keeps working)
 *   • acceptRequest   — new conv inserted into existing list
 *   • undoDeleteConversation / undoDeleteGroup — restored item reinserted
 *   • Rapid succession — items with timestamps 1 ms apart still sort correctly
 *
 * NOTE: the initial load path (setConversations / setGroupConversations)
 * intentionally does NOT call sortedConvs — it trusts the persisted order —
 * so load-time ordering is not tested here.
 *
 * Runs under jest-expo (jest.context.config.js).
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  HopProvider,
  useHop,
} from '../context/HopContext';
import type {
  Conversation,
  GroupConversation,
  HopUser,
  Message,
  MessageRequest,
} from '../context/HopContext';
import { MessageStatus } from '../protocol/message';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetItem    = AsyncStorage.getItem    as jest.MockedFunction<typeof AsyncStorage.getItem>;
const mockSetItem    = AsyncStorage.setItem    as jest.MockedFunction<typeof AsyncStorage.setItem>;
const mockRemoveItem = AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>;

const FAKE_PROFILE = JSON.stringify({
  id: 'test-me',
  username: 'tester',
  color: '#AAAAAA',
  discoverable: true,
});

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HopProvider, null, children);
}

// ─── Cleanup tracking ─────────────────────────────────────────────────────────
// Store the current test's unmount function so afterEach can clean it up.
// This prevents the scan/request intervals from leaking across tests.

let currentUnmount: (() => void) | undefined;

afterEach(async () => {
  // Unmount to trigger useEffect cleanup (clears scan + request intervals).
  if (currentUnmount) {
    await act(async () => { currentUnmount!(); });
    currentUnmount = undefined;
  }
  // Always restore real timers so fake-timer tests don't bleed into later ones.
  jest.useRealTimers();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function flushMicrotasks() {
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
  });
}

/** Mount the provider and wait for the initial load to complete. */
async function mountAndLoad() {
  // renderHook is async in @testing-library/react-native v14.
  const hookResult = await renderHook(() => useHop(), { wrapper });
  await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
  currentUnmount = hookResult.unmount;
  return hookResult;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// IDs match HopContext's USER_POOL so sendMessage / sendGroupMessage resolve the user.
const USER_A: HopUser = { id: 'u1', username: 'wavejockey',  color: '#FF6B6B', signal: 70, angle: 0.4 };
const USER_B: HopUser = { id: 'u2', username: 'neonpulse',   color: '#4ECDC4', signal: 65, angle: 1.1 };
const USER_C: HopUser = { id: 'u3', username: 'staticdrift', color: '#45B7D1', signal: 60, angle: 2.0 };

function makeConv(user: HopUser, ts: number, unread = 0): Conversation {
  const msg: Message = {
    id: `msg-${user.id}-${ts}`,
    senderId: user.id,
    content: 'hi',
    timestamp: ts,
    status: MessageStatus.DELIVERED,
  };
  return { userId: user.id, user, messages: [msg], unread };
}

function makeGroup(id: string, name: string, ts: number, unread = 0): GroupConversation {
  const msg: Message = {
    id: `gmsg-${id}-${ts}`,
    senderId: USER_A.id,
    senderName: USER_A.username,
    senderColor: USER_A.color,
    content: 'yo',
    timestamp: ts,
    status: MessageStatus.DELIVERED,
  };
  return { id, name, members: [USER_A, USER_B], messages: [msg], unread, createdAt: ts - 10_000 };
}

function lastMsgTs(item: Conversation | GroupConversation): number {
  const msgs = item.messages;
  return msgs.length > 0 ? msgs[msgs.length - 1].timestamp : 0;
}

/** Assert that every adjacent pair is newest-first (descending timestamp). */
function expectDescendingOrder(list: (Conversation | GroupConversation)[]) {
  for (let i = 0; i < list.length - 1; i++) {
    expect(lastMsgTs(list[i])).toBeGreaterThanOrEqual(lastMsgTs(list[i + 1]));
  }
}

// ─── Global beforeEach ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockImplementation((key: string) => {
    if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
    return Promise.resolve(null);
  });
  mockSetItem.mockResolvedValue(undefined);
  mockRemoveItem.mockResolvedValue(undefined);
});

// ─── 1. sendMessage — outgoing DM sorts conversation to top ───────────────────

describe('HopContext — sendMessage sorts conversations', () => {
  it('sending a DM to an older conversation brings it to the top', async () => {
    const now = Date.now();
    const convs: Conversation[] = [
      makeConv(USER_B, now - 2_000),
      makeConv(USER_A, now - 10_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify(convs));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    await act(async () => { result.current.sendMessage(USER_A.id, 'hey'); });

    expectDescendingOrder(result.current.conversations);
    expect(result.current.conversations[0].userId).toBe(USER_A.id);
  });

  it('sending sequentially keeps conversations sorted after each send', async () => {
    const now = Date.now();
    const convs: Conversation[] = [
      makeConv(USER_C, now - 10_000),
      makeConv(USER_B, now - 20_000),
      makeConv(USER_A, now - 30_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify(convs));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    // Each send moves the target conversation towards the top.
    // We only assert sorted order (not exact top position) since two sends
    // in the same millisecond produce equal timestamps and the tie-break
    // is intentionally unspecified by the sort comparator.
    await act(async () => { result.current.sendMessage(USER_A.id, 'first'); });
    expectDescendingOrder(result.current.conversations);

    await act(async () => { result.current.sendMessage(USER_B.id, 'second'); });
    expectDescendingOrder(result.current.conversations);
  });
});

// ─── 2. sendGroupMessage — outgoing group msg sorts group to top ──────────────

describe('HopContext — sendGroupMessage sorts groups', () => {
  it('sending to an older group brings it to the top', async () => {
    const now = Date.now();
    const groups: GroupConversation[] = [
      makeGroup('g2', 'Beta',  now - 2_000),
      makeGroup('g1', 'Alpha', now - 20_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/groups') return Promise.resolve(JSON.stringify(groups));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    await act(async () => { result.current.sendGroupMessage('g1', 'hello'); });

    expectDescendingOrder(result.current.groupConversations);
    expect(result.current.groupConversations[0].id).toBe('g1');
  });

  it('sending to two groups sequentially keeps groups sorted after each send', async () => {
    const now = Date.now();
    const groups: GroupConversation[] = [
      makeGroup('g3', 'Gamma', now - 5_000),
      makeGroup('g2', 'Beta',  now - 15_000),
      makeGroup('g1', 'Alpha', now - 30_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/groups') return Promise.resolve(JSON.stringify(groups));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    // Each send moves the target group towards the top; we assert sorted order
    // rather than an exact top-position since two sends within the same
    // millisecond produce equal timestamps (tie-break unspecified by sort).
    await act(async () => { result.current.sendGroupMessage('g1', 'first'); });
    expectDescendingOrder(result.current.groupConversations);

    await act(async () => { result.current.sendGroupMessage('g2', 'second'); });
    expectDescendingOrder(result.current.groupConversations);
  });
});

// ─── 3. Bot reply burst — incoming bot replies via delayed callbacks ───────────
//
// Strategy: mount with real timers (so waitFor / renderHook work), then switch
// to fake timers with doNotFake:['setImmediate'] so React's scheduler continues
// to use real setImmediate while we control setTimeout callbacks.
//
// We send to two different groups, then advance fake time past the maximum
// bot-reply delay (1500 + 3000 = 4500 ms → use 5000 ms) to fire both replies
// concurrently, then assert the inbox is sorted newest-first.

describe('HopContext — bot-reply burst sorts group inbox newest-first', () => {
  it('two bot replies arriving in rapid succession leave groups sorted', async () => {
    const now = Date.now();
    const groups: GroupConversation[] = [
      makeGroup('g1', 'Alpha', now - 60_000),
      makeGroup('g2', 'Beta',  now - 50_000),
      makeGroup('g3', 'Gamma', now - 40_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/groups') return Promise.resolve(JSON.stringify(groups));
      return Promise.resolve(null);
    });

    // Mount with real timers so renderHook / waitFor work.
    const { result } = await mountAndLoad();

    // Switch to fake timers (keep setImmediate real for React scheduler).
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });

    // Send to g1 and g2 — this schedules two independent bot-reply setTimeout callbacks.
    await act(async () => { result.current.sendGroupMessage('g1', 'burst 1'); });
    await act(async () => { result.current.sendGroupMessage('g2', 'burst 2'); });

    // Both sends moved g1 / g2 to the top in sequence; check order so far.
    expectDescendingOrder(result.current.groupConversations);

    // Advance fake timers past the maximum bot-reply delay (4500 ms) to fire
    // both reply callbacks.  They run synchronously inside jest's timer queue,
    // but state updates are deferred to React's scheduler (setImmediate is real).
    await act(async () => { jest.advanceTimersByTime(5_000); });
    await flushMicrotasks();

    // After both replies land, the inbox must still be sorted newest-first.
    expectDescendingOrder(result.current.groupConversations);
    expect(result.current.groupConversations).toHaveLength(3);

    // The groups that received replies have unread badges.
    const g1After = result.current.groupConversations.find(g => g.id === 'g1')!;
    const g2After = result.current.groupConversations.find(g => g.id === 'g2')!;
    expect(g1After.unread).toBeGreaterThan(0);
    expect(g2After.unread).toBeGreaterThan(0);
  });

  it('bot reply for a DM arrives and pushes that conversation to the top', async () => {
    const now = Date.now();
    const convs: Conversation[] = [
      makeConv(USER_B, now - 2_000),
      makeConv(USER_A, now - 10_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify(convs));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    jest.useFakeTimers({ doNotFake: ['setImmediate'] });

    // Send to USER_A (older conv) — this also schedules a bot reply setTimeout.
    await act(async () => { result.current.sendMessage(USER_A.id, 'hello'); });

    // USER_A jumps to top after the send.
    expectDescendingOrder(result.current.conversations);
    expect(result.current.conversations[0].userId).toBe(USER_A.id);

    // Advance fake timers past the maximum DM bot-reply delay (1000 + 2500 = 3500 ms).
    await act(async () => { jest.advanceTimersByTime(4_000); });
    await flushMicrotasks();

    // After the bot reply, USER_A must still be sorted to the top.
    expectDescendingOrder(result.current.conversations);
    expect(result.current.conversations[0].userId).toBe(USER_A.id);

    // The replied-to conversation now has an unread count.
    const convA = result.current.conversations.find(c => c.userId === USER_A.id)!;
    expect(convA.unread).toBeGreaterThan(0);
  });

  it('three group bot replies in a burst — inbox remains sorted newest-first', async () => {
    const now = Date.now();
    const groups: GroupConversation[] = [
      makeGroup('g1', 'Alpha', now - 90_000),
      makeGroup('g2', 'Beta',  now - 80_000),
      makeGroup('g3', 'Gamma', now - 70_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/groups') return Promise.resolve(JSON.stringify(groups));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    jest.useFakeTimers({ doNotFake: ['setImmediate'] });

    // Send to all three groups → three bot-reply timeouts queued.
    await act(async () => { result.current.sendGroupMessage('g1', 'msg 1'); });
    await act(async () => { result.current.sendGroupMessage('g2', 'msg 2'); });
    await act(async () => { result.current.sendGroupMessage('g3', 'msg 3'); });

    // Advance time to fire all three bot-reply callbacks.
    await act(async () => { jest.advanceTimersByTime(5_000); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.groupConversations);
    expect(result.current.groupConversations).toHaveLength(3);
  });
});

// ─── 4. acceptRequest — new conv lands in sorted position ─────────────────────

describe('HopContext — acceptRequest sorts conversations', () => {
  it('accepted request (newer timestamp) goes to the top', async () => {
    const now = Date.now();
    const existing: Conversation[] = [makeConv(USER_B, now - 30_000)];
    const req: MessageRequest = {
      id: 'req-001',
      fromUser: USER_A,
      preview: 'hey stranger',
      timestamp: now - 5_000,
    };
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify(existing));
      if (key === '@hop/requests/test-me') return Promise.resolve(JSON.stringify([req]));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();
    await waitFor(() => expect(result.current.messageRequests).toHaveLength(1));

    await act(async () => { result.current.acceptRequest('req-001'); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.conversations);
    expect(result.current.conversations).toHaveLength(2);
    expect(result.current.conversations[0].userId).toBe(USER_A.id);
  });

  it('accepted request (older timestamp) goes to the bottom', async () => {
    const now = Date.now();
    const existing: Conversation[] = [makeConv(USER_B, now - 1_000)];
    const req: MessageRequest = {
      id: 'req-old',
      fromUser: USER_A,
      preview: 'hi',
      timestamp: now - 60_000,
    };
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify(existing));
      if (key === '@hop/requests/test-me') return Promise.resolve(JSON.stringify([req]));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();
    await waitFor(() => expect(result.current.messageRequests).toHaveLength(1));

    await act(async () => { result.current.acceptRequest('req-old'); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.conversations);
    expect(result.current.conversations).toHaveLength(2);
    expect(result.current.conversations[result.current.conversations.length - 1].userId).toBe(USER_A.id);
  });
});

// ─── 5. undoDeleteConversation — restored conv in sorted position ──────────────

describe('HopContext — undoDeleteConversation sorts conversations', () => {
  it('restoring a conv with a recent timestamp puts it at the top', async () => {
    const now = Date.now();
    const convs: Conversation[] = [
      makeConv(USER_B, now - 20_000),
      makeConv(USER_C, now - 40_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify(convs));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    const toRestore = makeConv(USER_A, now - 2_000); // newest
    await act(async () => { result.current.undoDeleteConversation(toRestore); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.conversations);
    expect(result.current.conversations[0].userId).toBe(USER_A.id);
  });

  it('restoring a conv with an old timestamp puts it at the bottom', async () => {
    const now = Date.now();
    const convs: Conversation[] = [
      makeConv(USER_B, now - 5_000),
      makeConv(USER_C, now - 10_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify(convs));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    const toRestore = makeConv(USER_A, now - 60_000); // oldest
    await act(async () => { result.current.undoDeleteConversation(toRestore); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.conversations);
    const last = result.current.conversations[result.current.conversations.length - 1];
    expect(last.userId).toBe(USER_A.id);
  });

  it('restoring a conv that already exists is a no-op (duplicate guard)', async () => {
    const now = Date.now();
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify([makeConv(USER_A, now - 5_000)]));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();
    expect(result.current.conversations).toHaveLength(1);

    await act(async () => { result.current.undoDeleteConversation(makeConv(USER_A, now - 1_000)); });
    await flushMicrotasks();

    expect(result.current.conversations).toHaveLength(1);
  });
});

// ─── 6. undoDeleteGroup — restored group in sorted position ───────────────────

describe('HopContext — undoDeleteGroup sorts groups', () => {
  it('restoring a group with a recent timestamp puts it at the top', async () => {
    const now = Date.now();
    const groups: GroupConversation[] = [
      makeGroup('g2', 'Beta',  now - 15_000),
      makeGroup('g3', 'Gamma', now - 30_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/groups') return Promise.resolve(JSON.stringify(groups));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    const toRestore = makeGroup('g1', 'Alpha', now - 1_000); // newest
    await act(async () => { result.current.undoDeleteGroup(toRestore); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.groupConversations);
    expect(result.current.groupConversations[0].id).toBe('g1');
  });

  it('restoring a group with an old timestamp puts it at the bottom', async () => {
    const now = Date.now();
    const groups: GroupConversation[] = [
      makeGroup('g2', 'Beta',  now - 5_000),
      makeGroup('g3', 'Gamma', now - 10_000),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/groups') return Promise.resolve(JSON.stringify(groups));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    const toRestore = makeGroup('g1', 'Alpha', now - 60_000); // oldest
    await act(async () => { result.current.undoDeleteGroup(toRestore); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.groupConversations);
    const last = result.current.groupConversations[result.current.groupConversations.length - 1];
    expect(last.id).toBe('g1');
  });

  it('restoring a group that already exists is a no-op (duplicate guard)', async () => {
    const now = Date.now();
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/groups') return Promise.resolve(JSON.stringify([makeGroup('g1', 'Alpha', now - 5_000)]));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();
    expect(result.current.groupConversations).toHaveLength(1);

    await act(async () => { result.current.undoDeleteGroup(makeGroup('g1', 'Alpha', now - 1_000)); });
    await flushMicrotasks();

    expect(result.current.groupConversations).toHaveLength(1);
  });
});

// ─── 7. Rapid succession — items with timestamps 1 ms apart ──────────────────
//
// sortedConvs/sortedGroups uses (a, b) => lastTs(b) - lastTs(a).
// A difference of 1 ms must still produce the correct order.

describe('HopContext — rapid succession: 1 ms apart timestamps sort correctly', () => {
  it('undo-restoring groups with 1 ms apart timestamps produces correct order', async () => {
    const now = Date.now();
    const groups: GroupConversation[] = [
      makeGroup('g1', 'Alpha', now - 3),
      makeGroup('g2', 'Beta',  now - 2),
      makeGroup('g3', 'Gamma', now - 1),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/groups') return Promise.resolve(JSON.stringify(groups));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    // Trigger a sort operation (sendGroupMessage uses sortedGroups).
    await act(async () => { result.current.sendGroupMessage('g3', 'anchor'); });
    expectDescendingOrder(result.current.groupConversations);

    // Delete g1 and g2, then rapid undo-restore.
    const g1Snap = result.current.groupConversations.find(g => g.id === 'g1')!;
    const g2Snap = result.current.groupConversations.find(g => g.id === 'g2')!;

    await act(async () => {
      result.current.deleteGroup('g1');
      result.current.deleteGroup('g2');
    });
    await flushMicrotasks();

    await act(async () => { result.current.undoDeleteGroup(g1Snap); });
    await act(async () => { result.current.undoDeleteGroup(g2Snap); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.groupConversations);
    expect(result.current.groupConversations).toHaveLength(3);
  });

  it('undo-restoring DM convs with 1 ms apart timestamps produces correct order', async () => {
    const now = Date.now();
    const convs: Conversation[] = [
      makeConv(USER_A, now - 3),
      makeConv(USER_B, now - 2),
      makeConv(USER_C, now - 1),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify(convs));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    // Anchor USER_C at top via sendMessage.
    await act(async () => { result.current.sendMessage(USER_C.id, 'anchor'); });
    expectDescendingOrder(result.current.conversations);

    // Delete USER_A and USER_B, then rapid undo-restore.
    const aSnap = result.current.conversations.find(c => c.userId === USER_A.id)!;
    const bSnap = result.current.conversations.find(c => c.userId === USER_B.id)!;

    await act(async () => {
      result.current.deleteConversation(USER_A.id);
      result.current.deleteConversation(USER_B.id);
    });
    await flushMicrotasks();

    await act(async () => { result.current.undoDeleteConversation(aSnap); });
    await act(async () => { result.current.undoDeleteConversation(bSnap); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.conversations);
    expect(result.current.conversations).toHaveLength(3);
  });

  it('bot-reply burst with near-identical timestamps still sorts groups correctly', async () => {
    // Two groups with timestamps 1 ms apart; both receive bot replies at the
    // same fake-timer tick.  The sort must handle the tight difference correctly.
    const now = Date.now();
    const groups: GroupConversation[] = [
      makeGroup('g1', 'Alpha', now - 3),
      makeGroup('g2', 'Beta',  now - 2),
    ];
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
      if (key === '@hop/groups') return Promise.resolve(JSON.stringify(groups));
      return Promise.resolve(null);
    });

    const { result } = await mountAndLoad();

    jest.useFakeTimers({ doNotFake: ['setImmediate'] });

    // Trigger bot-reply timeouts for both groups in one burst.
    await act(async () => { result.current.sendGroupMessage('g1', 'msg'); });
    await act(async () => { result.current.sendGroupMessage('g2', 'msg'); });

    // Fire all pending bot-reply callbacks.
    await act(async () => { jest.advanceTimersByTime(5_000); });
    await flushMicrotasks();

    expectDescendingOrder(result.current.groupConversations);
    expect(result.current.groupConversations).toHaveLength(2);
  });
});
