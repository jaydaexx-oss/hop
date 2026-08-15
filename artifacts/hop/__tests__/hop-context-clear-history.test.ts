/**
 * Tests for HopContext's "Clear history" behaviour — verifying that:
 *
 *  1. clearHistory() actually empties non-empty conversations AND groups, and
 *     removes the corresponding AsyncStorage keys.
 *  2. After the component's production code path (await clearHistory → slideOut
 *     → dismissToast), the toast is gone and history is already clear by the
 *     time the toast animates out.
 *  3. storageErrorToastUpdater deduplication still works correctly after
 *     clearHistory clears state.
 *
 * Runs under jest-expo (see jest.context.config.js).
 *
 * Component change: NotificationToast's "Clear history" button now does
 *   `await clearHistory(); slideOut();`
 * so we can assert that storage is fully cleared before the toast slides out.
 */

// ─── Pure-function deduplication tests (no React rendering) ──────────────────

import { storageErrorToastUpdater } from '../context/HopContext';
import type { ToastNotification } from '../context/HopContext';

describe('storageErrorToastUpdater — deduplication after clearHistory', () => {
  it('can add a fresh error toast to an empty queue (as seen after dismiss)', () => {
    const after = storageErrorToastUpdater([]);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ kind: 'error' });
  });

  it('deduplicates a second error even after a dismiss-then-refill cycle', () => {
    const step1 = storageErrorToastUpdater([]);
    const afterDismiss = step1.slice(1); // dismissToast removes head
    const step2 = storageErrorToastUpdater(afterDismiss);
    expect(step2).toHaveLength(1);
    expect(step2[0]).toMatchObject({ kind: 'error' });
    const step3 = storageErrorToastUpdater(step2);
    expect(step3).toBe(step2); // same reference — no-op
    expect(step3.filter(t => t.kind === 'error')).toHaveLength(1);
  });

  it('non-error toasts before the error do not break deduplication', () => {
    const queueWithDm: ToastNotification[] = [
      { kind: 'dm', targetId: 'u1', senderName: 'wavejockey', senderColor: '#FF6B6B', content: 'hey' },
    ];
    const step1 = storageErrorToastUpdater(queueWithDm);
    expect(step1).toHaveLength(2);
    const step2 = storageErrorToastUpdater(step1);
    expect(step2).toBe(step1);
    expect(step2.filter(t => t.kind === 'error')).toHaveLength(1);
  });
});

// ─── HopProvider integration tests ───────────────────────────────────────────

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop } from '../context/HopContext';
import type { HopUser } from '../context/HopContext';

const mockGetItem    = AsyncStorage.getItem    as jest.MockedFunction<typeof AsyncStorage.getItem>;
const mockSetItem    = AsyncStorage.setItem    as jest.MockedFunction<typeof AsyncStorage.setItem>;
const mockRemoveItem = AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>;

const FAKE_PROFILE = JSON.stringify({
  id: 'test-me',
  username: 'tester',
  color: '#AAAAAA',
  discoverable: true,
});

// A real user from the USER_POOL so openDirectMessage / createGroup work.
const SEED_USER: HopUser = {
  id: 'u1',
  username: 'wavejockey',
  color: '#FF6B6B',
  signal: 70,
  angle: 0.4,
};

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HopProvider, null, children);
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Only provide profile — mirrors hop-context-toast.test.ts to avoid extra
  // out-of-act state updates during load.
  mockGetItem.mockImplementation((key: string) => {
    if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
    return Promise.resolve(null);
  });
  mockSetItem.mockResolvedValue(undefined);
  mockRemoveItem.mockResolvedValue(undefined);
});

// Helper: mount context and wait for it to finish loading.
async function mountAndLoad() {
  const hookResult = await renderHook(() => useHop(), { wrapper });
  await waitFor(() => {
    expect(hookResult.result.current.loaded).toBe(true);
  });
  return hookResult;
}

// ─── 1. clearHistory empties pre-existing data ────────────────────────────────

describe('HopContext — clearHistory empties pre-existing data', () => {
  it('sets conversations to [] after having at least one conversation', async () => {
    const { result } = await mountAndLoad();

    // Seed a DM conversation via the context API.
    await act(async () => {
      result.current.openDirectMessage(SEED_USER);
    });
    // Pre-condition: the conversation exists.
    expect(result.current.conversations.length).toBeGreaterThan(0);

    await act(async () => {
      await result.current.clearHistory();
    });

    expect(result.current.conversations).toHaveLength(0);
  });

  it('sets groupConversations to [] after having at least one group', async () => {
    const { result } = await mountAndLoad();

    // Seed a group via the context API.
    await act(async () => {
      result.current.createGroup('test group', ['u1', 'u2']);
    });
    // Pre-condition: the group exists.
    expect(result.current.groupConversations.length).toBeGreaterThan(0);

    await act(async () => {
      await result.current.clearHistory();
    });

    expect(result.current.groupConversations).toHaveLength(0);
  });

  it('removes @hop/conversations and @hop/groups from AsyncStorage exactly once', async () => {
    const { result } = await mountAndLoad();

    await act(async () => {
      result.current.openDirectMessage(SEED_USER);
      result.current.createGroup('g', ['u1']);
    });

    mockRemoveItem.mockClear(); // ignore any removes from seeding

    await act(async () => {
      await result.current.clearHistory();
    });

    const removedKeys = mockRemoveItem.mock.calls.map(([key]) => key);
    expect(removedKeys).toContain('@hop/conversations');
    expect(removedKeys).toContain('@hop/groups');
    expect(removedKeys.filter(k => k === '@hop/conversations')).toHaveLength(1);
    expect(removedKeys.filter(k => k === '@hop/groups')).toHaveLength(1);
  });
});

// ─── 2. Production ordering: conversations clear before dismissToast ──────────
//
// NotificationToast's "Clear history" handler does:
//   await clearHistory();
//   slideOut();            // → eventually → dismissToast()
//
// We verify that after clearHistory() resolves, history IS already empty, so
// the toast dismissal (slideOut → dismissToast) always follows a clean state.

describe('HopContext — clearHistory before toast dismissal', () => {
  it('conversations are empty before dismissToast is called (ordering guarantee)', async () => {
    const { result } = await mountAndLoad();

    await act(async () => {
      result.current.openDirectMessage(SEED_USER);
    });
    expect(result.current.conversations.length).toBeGreaterThan(0);

    // Simulate the production button handler: await clearHistory() then dismiss.
    await act(async () => {
      await result.current.clearHistory(); // must complete fully first
    });

    // History is empty BEFORE slideOut/dismissToast runs.
    expect(result.current.conversations).toHaveLength(0);
    expect(result.current.groupConversations).toHaveLength(0);

    // Dismiss can now safely follow.
    await act(async () => {
      result.current.dismissToast();
    });
    expect(result.current.pendingToast).toBeNull();
  });

  it('pendingToast is null after clearHistory() + dismissToast() when an error toast was active', async () => {
    let loadDone = false;
    mockSetItem.mockImplementation(async () => {
      if (loadDone) throw new Error('quota exceeded');
    });

    const { result } = await mountAndLoad();
    loadDone = true;

    // Trigger a save failure to push an error toast into the queue.
    await act(async () => {
      result.current.markRead('u1');
    });
    await flushMicrotasks();
    expect(result.current.pendingToast).toMatchObject({ kind: 'error' });

    // Production button path: await clear → dismiss.
    await act(async () => {
      await result.current.clearHistory();
      result.current.dismissToast(); // mirrors slideOut → dismissToast
    });

    expect(result.current.pendingToast).toBeNull();
  });

  it('clearHistory() does not enqueue a toast on its own', async () => {
    const { result } = await mountAndLoad();
    expect(result.current.pendingToast).toBeNull();

    await act(async () => {
      await result.current.clearHistory();
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toBeNull();
  });
});

// ─── 2b. clearHistory also wipes leftGroups ───────────────────────────────────

describe('HopContext — clearHistory also clears leftGroups', () => {
  it('leftGroups becomes empty after clearHistory when a group was left', async () => {
    const { result } = await mountAndLoad();

    // Create a group then leave it so it lands in leftGroups.
    await act(async () => {
      result.current.createGroup('old group', ['u1']);
    });
    expect(result.current.groupConversations).toHaveLength(1);
    const gid = result.current.groupConversations[0].id;

    await act(async () => {
      await result.current.leaveGroup(gid);
    });
    expect(result.current.leftGroups).toHaveLength(1);

    await act(async () => {
      await result.current.clearHistory();
    });

    expect(result.current.leftGroups).toHaveLength(0);
  });

  it('clearHistory removes the @hop/leftGroups/<profileId> key from AsyncStorage', async () => {
    const { result } = await mountAndLoad();

    await act(async () => {
      result.current.createGroup('past group', ['u1']);
    });
    const gid = result.current.groupConversations[0].id;

    await act(async () => {
      await result.current.leaveGroup(gid);
    });

    mockRemoveItem.mockClear();

    await act(async () => {
      await result.current.clearHistory();
    });

    const removedKeys = mockRemoveItem.mock.calls.map(([key]) => key);
    expect(removedKeys).toContain('@hop/leftGroups/test-me');
  });

  it('leftGroups messages cannot be recovered after clearHistory', async () => {
    const { result } = await mountAndLoad();

    // Create and send a message to a group, then leave it.
    await act(async () => {
      result.current.createGroup('msg group', ['u1']);
    });
    const gid = result.current.groupConversations[0].id;
    await act(async () => {
      result.current.sendGroupMessage(gid, 'secret message');
    });
    // The active group has a message.
    expect(result.current.groupConversations.find(g => g.id === gid)?.messages.length).toBeGreaterThan(0);

    // Leave — LeftGroup snapshot strips messages.
    await act(async () => {
      await result.current.leaveGroup(gid);
    });
    expect(result.current.leftGroups[0].group.messages).toHaveLength(0);

    // clearHistory wipes leftGroups entirely.
    await act(async () => {
      await result.current.clearHistory();
    });
    expect(result.current.leftGroups).toHaveLength(0);
  });
});

// ─── 2c. Rejoin flow ──────────────────────────────────────────────────────────

describe('HopContext — rejoin group flow', () => {
  it('rejoinGroup moves a group from leftGroups back to groupConversations', async () => {
    const { result } = await mountAndLoad();

    await act(async () => {
      result.current.createGroup('test group', ['u1', 'u2']);
    });
    const gid = result.current.groupConversations[0].id;

    await act(async () => {
      await result.current.leaveGroup(gid);
    });
    expect(result.current.groupConversations).toHaveLength(0);
    expect(result.current.leftGroups).toHaveLength(1);

    await act(async () => {
      result.current.rejoinGroup(gid);
    });

    expect(result.current.leftGroups).toHaveLength(0);
    expect(result.current.groupConversations.find(g => g.id === gid)).toBeDefined();
  });

  it('rejoined group has zero unread and no messages (clean slate)', async () => {
    const { result } = await mountAndLoad();

    await act(async () => {
      result.current.createGroup('clean group', ['u1']);
    });
    const gid = result.current.groupConversations[0].id;
    await act(async () => {
      result.current.sendGroupMessage(gid, 'hello');
    });

    await act(async () => {
      await result.current.leaveGroup(gid);
    });
    await act(async () => {
      result.current.rejoinGroup(gid);
    });

    const rejoined = result.current.groupConversations.find(g => g.id === gid);
    expect(rejoined?.unread).toBe(0);
    expect(rejoined?.messages).toHaveLength(0);
  });

  it('rejoinGroup is a no-op when the groupId is not in leftGroups', async () => {
    const { result } = await mountAndLoad();

    await act(async () => {
      result.current.createGroup('active group', ['u1']);
    });
    const before = result.current.groupConversations.length;

    await act(async () => {
      result.current.rejoinGroup('nonexistent-id');
    });

    expect(result.current.groupConversations).toHaveLength(before);
    expect(result.current.leftGroups).toHaveLength(0);
  });

  it('sendGroupMessage on a rejoined group triggers a bot reply', async () => {
    // Mount with real timers so renderHook / waitFor work.
    const { result } = await mountAndLoad();

    // Create a group, leave it, then rejoin.
    await act(async () => {
      result.current.createGroup('comeback group', ['u1', 'u2']);
    });
    const gid = result.current.groupConversations[0].id;

    await act(async () => {
      await result.current.leaveGroup(gid);
    });
    expect(result.current.groupConversations).toHaveLength(0);

    await act(async () => {
      result.current.rejoinGroup(gid);
    });
    expect(result.current.groupConversations.find(g => g.id === gid)).toBeDefined();

    // Switch to fake timers (keep setImmediate real for React scheduler).
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });

    // Send a message to the rejoined group.
    await act(async () => {
      result.current.sendGroupMessage(gid, 'anyone there?');
    });

    // Verify the outgoing message landed.
    const afterSend = result.current.groupConversations.find(g => g.id === gid)!;
    expect(afterSend).toBeDefined();
    expect(afterSend.messages.some(m => m.content === 'anyone there?')).toBe(true);
    expect(afterSend.unread).toBe(0); // outgoing message clears unread

    // Advance fake timers past the maximum bot-reply delay (1500 + 3000 = 4500 ms).
    await act(async () => { jest.advanceTimersByTime(5_000); });
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    // The bot reply must have been appended to the rejoined group.
    const afterReply = result.current.groupConversations.find(g => g.id === gid)!;
    expect(afterReply).toBeDefined();
    // Bot reply increments unread by 1.
    expect(afterReply.unread).toBe(1);
    // Total messages: 1 outgoing + 1 bot reply.
    expect(afterReply.messages.length).toBe(2);
    // The bot reply comes from one of the group members (u1 or u2), not the profile.
    const botReply = afterReply.messages[afterReply.messages.length - 1];
    expect(['u1', 'u2']).toContain(botReply.senderId);

    jest.useRealTimers();
  });

  it('rejoined group starts with zero unread even if it had unread messages before leaving', async () => {
    const { result } = await mountAndLoad();

    await act(async () => {
      result.current.createGroup('stale-badge group', ['u1']);
    });
    const gid = result.current.groupConversations[0].id;

    // Switch to fake timers to trigger a bot reply (which sets unread = 1).
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    await act(async () => {
      result.current.sendGroupMessage(gid, 'hello');
    });
    await act(async () => { jest.advanceTimersByTime(5_000); });
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
    });
    jest.useRealTimers();

    // The bot reply should have set unread > 0.
    expect(result.current.groupConversations.find(g => g.id === gid)?.unread).toBeGreaterThan(0);

    // Leave then rejoin.
    await act(async () => {
      await result.current.leaveGroup(gid);
    });
    await act(async () => {
      result.current.rejoinGroup(gid);
    });

    // Unread must be zeroed after rejoin — no stale badge.
    const rejoined = result.current.groupConversations.find(g => g.id === gid)!;
    expect(rejoined).toBeDefined();
    expect(rejoined.unread).toBe(0);
  });
});

// ─── 3. Deduplication via provider after clearHistory + dismiss ───────────────

describe('HopContext — deduplication still works after clearHistory', () => {
  it('shows at most one error toast even across a clearHistory+dismiss cycle with multiple failures', async () => {
    let loadDone = false;
    mockSetItem.mockImplementation(async () => {
      if (loadDone) throw new Error('full');
    });

    const { result } = await mountAndLoad();
    loadDone = true;

    // First cycle: trigger error → clear → dismiss.
    await act(async () => {
      result.current.markRead('u1');
    });
    await flushMicrotasks();
    expect(result.current.pendingToast).toMatchObject({ kind: 'error' });

    await act(async () => {
      await result.current.clearHistory();
      result.current.dismissToast();
    });
    expect(result.current.pendingToast).toBeNull();

    // Second cycle: two save failures back-to-back — still only one toast.
    await act(async () => {
      result.current.markRead('u1');
      result.current.markGroupRead('g1');
    });
    await flushMicrotasks();
    expect(result.current.pendingToast).toMatchObject({ kind: 'error' });

    // Dismiss — no second error toast behind it.
    await act(async () => {
      result.current.dismissToast();
    });
    expect(result.current.pendingToast).toBeNull();
  });
});
