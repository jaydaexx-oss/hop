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
import type { MyProfile } from '../context/HopContext';

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

  // ─── 3. Idempotency ──────────────────────────────────────────────────────

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
