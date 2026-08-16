/**
 * Tests for HopContext's blockUser failure path.
 *
 * Scenario: a user blocks someone and the AsyncStorage write for the blocked-ids
 * key fails (e.g. storage is full).  The tests verify that:
 *
 *  1. The in-memory blockedIds list is rolled back — the userId is removed.
 *  2. An error toast is shown — the failure is never silent.
 *  3. On the happy path the userId stays in blockedIds and no toast is pushed.
 *
 * Runs under jest-expo (see jest.context.config.js).
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop, storageErrorToastUpdater } from '../context/HopContext';
import type { MyProfile, Conversation, HopUser, Message } from '../context/HopContext';

const mockGetItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const mockSetItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HopProvider, null, children);
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
  });
}

const STORED_PROFILE: MyProfile = {
  id: 'test-user-id',
  username: 'testuser',
  color: '#FF6B6B',
  discoverable: true,
};

const BLOCKED_KEY = `@hop/blocked/${STORED_PROFILE.id}`;

/**
 * Mount HopProvider with a pre-existing stored profile and no blocked ids.
 */
async function mountWithProfile() {
  mockGetItem.mockImplementation((key: string) => {
    if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
    return Promise.resolve(null);
  });
  // eslint-disable-next-line @typescript-eslint/await-thenable
  const hookResult = await renderHook(() => useHop(), { wrapper });
  await waitFor(() => {
    expect(hookResult.result.current.loaded).toBe(true);
  });
  await waitFor(() => {
    expect(hookResult.result.current.profile).not.toBeNull();
  });
  return hookResult;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItem.mockResolvedValue(undefined);
});

// ─── 1. Rollback on write failure ─────────────────────────────────────────────

describe('HopContext — blockUser storage failure', () => {
  it('rolls back blockedIds when the storage write rejects', async () => {
    const { result } = await mountWithProfile();

    // Verify the user is not blocked initially.
    expect(result.current.blockedIds).not.toContain('u1');

    // Make the write for the blocked key fail.
    mockSetItem.mockImplementation((key: string) => {
      if (key === BLOCKED_KEY) return Promise.reject(new Error('storage full'));
      return Promise.resolve(undefined);
    });

    await act(async () => {
      await result.current.blockUser('u1');
    });
    await flushMicrotasks();

    // Rollback must have fired — u1 must NOT be in blockedIds.
    expect(result.current.blockedIds).not.toContain('u1');
  });

  it('shows an error toast when the block write rejects', async () => {
    const { result } = await mountWithProfile();

    mockSetItem.mockImplementation((key: string) => {
      if (key === BLOCKED_KEY) return Promise.reject(new Error('storage full'));
      return Promise.resolve(undefined);
    });

    await act(async () => {
      await result.current.blockUser('u2');
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).not.toBeNull();
    expect(result.current.pendingToast?.kind).toBe('error');
  });

  // ─── 2. Happy path ───────────────────────────────────────────────────────

  it('keeps the user in blockedIds when the write succeeds', async () => {
    const { result } = await mountWithProfile();

    // Default mock: all writes succeed.
    await act(async () => {
      await result.current.blockUser('u3');
    });
    await flushMicrotasks();

    expect(result.current.blockedIds).toContain('u3');
  });

  it('does not show a toast when the write succeeds', async () => {
    const { result } = await mountWithProfile();

    await act(async () => {
      await result.current.blockUser('u4');
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toBeNull();
  });

  // ─── 3. Conversation rollback ────────────────────────────────────────────

  it('restores the removed conversation when the block write fails', async () => {
    // Seed a stored conversation with u1 so we can verify it comes back.
    const u1User: HopUser = { id: 'u1', username: 'wavejockey', color: '#FF6B6B', signal: 75, angle: 0.4 };
    const msg: Message = { id: 'msg-1', senderId: 'u1', content: 'hello', timestamp: 1000, status: 'DELIVERED' };
    const storedConv: Conversation = { userId: 'u1', user: u1User, messages: [msg], unread: 1 };

    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify([storedConv]));
      return Promise.resolve(null);
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.conversations.some(c => c.userId === 'u1')).toBe(true));

    // Make the block write fail.
    mockSetItem.mockImplementation((key: string) => {
      if (key === BLOCKED_KEY) return Promise.reject(new Error('storage full'));
      return Promise.resolve(undefined);
    });

    await act(async () => {
      await result.current.blockUser('u1');
    });
    await flushMicrotasks();

    // The conversation must be back after the rollback.
    expect(result.current.conversations.some(c => c.userId === 'u1')).toBe(true);
  });

  it('persists the restored conversation list to storage after a failed block', async () => {
    const u1User: HopUser = { id: 'u1', username: 'wavejockey', color: '#FF6B6B', signal: 75, angle: 0.4 };
    const msg: Message = { id: 'msg-1', senderId: 'u1', content: 'hello', timestamp: 1000, status: 'DELIVERED' };
    const storedConv: Conversation = { userId: 'u1', user: u1User, messages: [msg], unread: 1 };

    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify([storedConv]));
      return Promise.resolve(null);
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.conversations.some(c => c.userId === 'u1')).toBe(true));

    const convWritesBefore = mockSetItem.mock.calls.filter(([k]) => k === '@hop/conversations').length;

    mockSetItem.mockImplementation((key: string) => {
      if (key === BLOCKED_KEY) return Promise.reject(new Error('storage full'));
      return Promise.resolve(undefined);
    });

    await act(async () => {
      await result.current.blockUser('u1');
    });
    await flushMicrotasks();

    // The rollback must have re-persisted @hop/conversations with the restored list.
    const convWritesAfter = mockSetItem.mock.calls.filter(([k]) => k === '@hop/conversations').length;
    expect(convWritesAfter).toBeGreaterThan(convWritesBefore);

    // The last conversations write must include u1's conversation.
    const lastConvWrite = mockSetItem.mock.calls
      .filter(([k]) => k === '@hop/conversations')
      .at(-1);
    expect(lastConvWrite).toBeDefined();
    const writtenConvs: Conversation[] = JSON.parse(lastConvWrite![1]);
    expect(writtenConvs.some(c => c.userId === 'u1')).toBe(true);
  });

  it('keeps the conversation removed when the block write succeeds', async () => {
    const u1User: HopUser = { id: 'u1', username: 'wavejockey', color: '#FF6B6B', signal: 75, angle: 0.4 };
    const msg: Message = { id: 'msg-1', senderId: 'u1', content: 'hello', timestamp: 1000, status: 'DELIVERED' };
    const storedConv: Conversation = { userId: 'u1', user: u1User, messages: [msg], unread: 1 };

    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify([storedConv]));
      return Promise.resolve(null);
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.conversations.some(c => c.userId === 'u1')).toBe(true));

    // Default mock: all writes succeed.
    await act(async () => {
      await result.current.blockUser('u1');
    });
    await flushMicrotasks();

    // Conversation stays gone when block is persisted successfully.
    expect(result.current.conversations.some(c => c.userId === 'u1')).toBe(false);
  });

  it('re-inserts the restored conversation in correct timestamp order', async () => {
    const makeUser = (id: string): HopUser => ({ id, username: id, color: '#000', signal: 50, angle: 0 });
    const makeMsg = (id: string, ts: number): Message => ({ id, senderId: 'u1', content: 'hi', timestamp: ts, status: 'DELIVERED' });

    const convU1: Conversation = { userId: 'u1', user: makeUser('u1'), messages: [makeMsg('m1', 3000)], unread: 0 };
    const convU2: Conversation = { userId: 'u2', user: makeUser('u2'), messages: [makeMsg('m2', 1000)], unread: 0 };
    const convU3: Conversation = { userId: 'u3', user: makeUser('u3'), messages: [makeMsg('m3', 2000)], unread: 0 };

    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === '@hop/conversations') return Promise.resolve(JSON.stringify([convU1, convU2, convU3]));
      return Promise.resolve(null);
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.conversations).toHaveLength(3));

    mockSetItem.mockImplementation((key: string) => {
      if (key === BLOCKED_KEY) return Promise.reject(new Error('storage full'));
      return Promise.resolve(undefined);
    });

    // Block u3 (ts=2000) — after rollback it must sit between u1 (ts=3000) and u2 (ts=1000).
    await act(async () => {
      await result.current.blockUser('u3');
    });
    await flushMicrotasks();

    const ids = result.current.conversations.map(c => c.userId);
    expect(ids).toEqual(['u1', 'u3', 'u2']);
  });

  // ─── 4. Idempotency ──────────────────────────────────────────────────────

  it('is a no-op when the user is already blocked', async () => {
    // Pre-load with u5 already in the blocked list.
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === BLOCKED_KEY) return Promise.resolve(JSON.stringify(['u5']));
      return Promise.resolve(null);
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const hookResult = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
    await waitFor(() => expect(hookResult.result.current.blockedIds).toContain('u5'));

    const writeCallsBefore = mockSetItem.mock.calls.length;

    await act(async () => {
      await hookResult.result.current.blockUser('u5');
    });
    await flushMicrotasks();

    // No additional write should have been made.
    expect(mockSetItem.mock.calls.length).toBe(writeCallsBefore);
    expect(hookResult.result.current.blockedIds).toContain('u5');
  });
});
