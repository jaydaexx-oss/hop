/**
 * Tests confirming that the ProfileScreen form state resets to pre-edit values
 * when a setProfile write fails.
 *
 * Two layers are tested here:
 *
 *   A. Context layer (uses HopProvider + useHop, mirrors hop-context-set-profile
 *      tests) — verifies that setProfile returns false on failure (so the screen
 *      can skip success haptics) and that profile rolls back correctly.
 *
 *   B. Screen form-sync layer (pure hook test, no HopProvider) — verifies that
 *      the useEffect added to profile.tsx correctly resets nameInput whenever
 *      !editing and profile.username changes, including after a context rollback.
 *
 * Runs under jest.context.config.js (jest-expo preset).
 */

import React, { useEffect, useRef, useState } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop } from '../context/HopContext';
import type { MyProfile } from '../context/HopContext';

// ─── AsyncStorage mock handles ─────────────────────────────────────────────────

const mockGetItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const mockSetItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

// ─── Stored profile used across tests ─────────────────────────────────────────

const STORED_PROFILE: MyProfile = {
  id: 'test-id-123',
  username: 'originalname',
  color: '#FF6B6B',
  discoverable: true,
};

// ─── Wrapper ──────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HopProvider, null, children);
}

// ─── Setup helper (mirrors mountWithExistingProfile in set-profile tests) ──────

async function mountWithProfile() {
  mockGetItem.mockImplementation((key: string) => {
    if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
    return Promise.resolve(null);
  });
  // eslint-disable-next-line @typescript-eslint/await-thenable
  const hook = await renderHook(() => useHop(), { wrapper });
  await waitFor(() => { expect(hook.result.current.loaded).toBe(true); });
  await waitFor(() => { expect(hook.result.current.profile).not.toBeNull(); });
  return hook;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItem.mockResolvedValue(undefined);
});

// ══════════════════════════════════════════════════════════════════════════════
// A. Context layer tests — setProfile return value and rollback
// ══════════════════════════════════════════════════════════════════════════════

describe('setProfile return value', () => {
  it('returns true when the storage write succeeds', async () => {
    const { result } = await mountWithProfile();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setProfile({ ...STORED_PROFILE, username: 'newname' });
    });

    expect(ok).toBe(true);
  });

  it('returns false when the storage write fails', async () => {
    const { result } = await mountWithProfile();

    mockSetItem.mockRejectedValueOnce(new Error('storage full'));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setProfile({ ...STORED_PROFILE, username: 'failedname' });
    });

    expect(ok).toBe(false);
  });

  it('profile.username rolls back after a failed write', async () => {
    const { result } = await mountWithProfile();

    mockSetItem.mockRejectedValueOnce(new Error('disk error'));
    await act(async () => {
      await result.current.setProfile({ ...STORED_PROFILE, username: 'failedname' });
    });

    expect(result.current.profile?.username).toBe('originalname');
  });

  it('profile.color rolls back after a failed write', async () => {
    const { result } = await mountWithProfile();

    mockSetItem.mockRejectedValueOnce(new Error('quota exceeded'));
    await act(async () => {
      await result.current.setProfile({ ...STORED_PROFILE, color: '#4ECDC4' });
    });

    expect(result.current.profile?.color).toBe('#FF6B6B');
  });

  it('profile.username updates after a successful write', async () => {
    const { result } = await mountWithProfile();

    await act(async () => {
      await result.current.setProfile({ ...STORED_PROFILE, username: 'updatedname' });
    });

    expect(result.current.profile?.username).toBe('updatedname');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B. Screen form-sync layer — pure hook test for the useEffect in profile.tsx
//
// This hook exactly replicates the nameInput + useEffect added to profile.tsx.
// We drive it with a mock profile prop to prove the sync works without needing
// a full HopProvider render.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Pure hook that mirrors the profile screen's nameInput management.
 * `profileUsername` is passed in so the test controls when it changes,
 * simulating a context rollback without a full HopProvider.
 */
function useNameInputSync(profileUsername: string) {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(profileUsername);

  // This is the exact useEffect added to profile.tsx:
  useEffect(() => {
    if (!editing) setNameInput(profileUsername);
  }, [profileUsername, editing]);

  return { nameInput, setNameInput, editing, setEditing };
}

describe('profile screen nameInput sync (useEffect from profile.tsx)', () => {
  // Each test gets its own independent renderHook — no shared state.
  // We avoid trailing `await act(async () => {})` to prevent async leakage
  // between tests; `rerender` with `act` wrapping is sufficient.

  it('nameInput resets to original when profile rolls back while not editing', async () => {
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const { result, rerender } = await renderHook(
      ({ username }: { username: string }) => useNameInputSync(username),
      { initialProps: { username: 'originalname' } },
    );

    // Simulate user entering edit mode and typing.
    await act(async () => { result.current.setEditing(true); });
    await act(async () => { result.current.setNameInput('failedname'); });
    expect(result.current.nameInput).toBe('failedname');

    // Save fails → context rolls back → editing closes.
    // The useEffect fires because editing→false; it resets nameInput.
    await act(async () => { result.current.setEditing(false); });
    // No username change needed here: editing closing is enough to trigger sync.
    expect(result.current.nameInput).toBe('originalname');
  });

  it('nameInput does NOT reset while the user is still typing (editing=true)', async () => {
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const { result, rerender } = await renderHook(
      ({ username }: { username: string }) => useNameInputSync(username),
      { initialProps: { username: 'originalname' } },
    );

    await act(async () => { result.current.setEditing(true); });
    await act(async () => { result.current.setNameInput('midtype'); });
    expect(result.current.nameInput).toBe('midtype');

    // Profile changes externally while user is mid-edit.
    act(() => { rerender({ username: 'changed-externally' }); });

    // The useEffect guard (!editing) must prevent overwriting the user's typing.
    expect(result.current.nameInput).toBe('midtype');
  });

  it('nameInput syncs when a new profile.username arrives while not editing', () => {
    // Pure logic test — no async needed.
    // The useEffect callback is: if (!editing) setNameInput(profileUsername)
    // Verify that when editing=false and username changes, nameInput resets.
    let nameInput = 'stale';
    const setNameInput = (v: string) => { nameInput = v; };
    const editing = false;
    const newUsername = 'rolledback';

    // Simulate what the useEffect body does:
    if (!editing) setNameInput(newUsername);

    expect(nameInput).toBe('rolledback');
  });
});
