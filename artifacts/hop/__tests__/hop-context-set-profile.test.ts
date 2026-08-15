/**
 * Tests for HopContext's setProfile failure path.
 *
 * Scenario: a user updates their profile (username, color, avatar) after
 * onboarding and the AsyncStorage write fails.  The tests verify that:
 *
 *  1. An error toast is shown — the failure is never silent.
 *  2. The toast content does NOT mention "messages" — it references
 *     profile/settings, not the onboarding or messaging flow.
 *  3. The in-memory profile is rolled back to the previous value.
 *  4. No toast is pushed when the write succeeds (happy path regression).
 *
 * Runs under jest-expo (see jest.context.config.js).
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop } from '../context/HopContext';
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
  username: 'originalname',
  color: '#FF6B6B',
  discoverable: true,
};

/**
 * Mount HopProvider with a pre-existing stored profile (returning user).
 */
async function mountWithExistingProfile() {
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

// ─── 1. Error toast appears when setProfile write fails ───────────────────────

describe('HopContext — setProfile storage failure', () => {
  it('shows an error toast when the profile write rejects', async () => {
    const { result } = await mountWithExistingProfile();

    mockSetItem.mockRejectedValue(new Error('storage full'));

    const updatedProfile: MyProfile = { ...STORED_PROFILE, username: 'newname' };
    await act(async () => {
      await result.current.setProfile(updatedProfile);
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).not.toBeNull();
    expect(result.current.pendingToast?.kind).toBe('error');
  });

  it('toast content does not mention "messages"', async () => {
    const { result } = await mountWithExistingProfile();

    mockSetItem.mockRejectedValue(new Error('disk error'));

    const updatedProfile: MyProfile = { ...STORED_PROFILE, color: '#4ECDC4' };
    await act(async () => {
      await result.current.setProfile(updatedProfile);
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toMatchObject({ kind: 'error' });
    expect(result.current.pendingToast?.content).not.toMatch(/messages/i);
  });

  it('toast content references profile or settings', async () => {
    const { result } = await mountWithExistingProfile();

    mockSetItem.mockRejectedValue(new Error('quota exceeded'));

    const updatedProfile: MyProfile = { ...STORED_PROFILE, username: 'another' };
    await act(async () => {
      await result.current.setProfile(updatedProfile);
    });
    await flushMicrotasks();

    // The toast must communicate a profile-save failure, not a messaging one.
    expect(result.current.pendingToast).toMatchObject({
      kind: 'error',
      content: "Couldn't save your profile — please try again.",
    });
  });

  it('in-memory profile is rolled back to the previous value on failure', async () => {
    const { result } = await mountWithExistingProfile();

    mockSetItem.mockRejectedValue(new Error('write failed'));

    const updatedProfile: MyProfile = { ...STORED_PROFILE, username: 'failedname' };
    await act(async () => {
      await result.current.setProfile(updatedProfile);
    });
    await flushMicrotasks();

    // The optimistic update should have been rolled back.
    expect(result.current.profile?.username).toBe(STORED_PROFILE.username);
    expect(result.current.profile?.username).not.toBe('failedname');
  });
});

// ─── 2. Happy path — no toast on success ──────────────────────────────────────

describe('HopContext — setProfile happy path', () => {
  it('no error toast is pushed when the write succeeds', async () => {
    const { result } = await mountWithExistingProfile();

    // All writes succeed (default mock).
    const updatedProfile: MyProfile = { ...STORED_PROFILE, username: 'newname' };
    await act(async () => {
      await result.current.setProfile(updatedProfile);
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toBeNull();
  });

  it('profile is updated in memory when the write succeeds', async () => {
    const { result } = await mountWithExistingProfile();

    const updatedProfile: MyProfile = { ...STORED_PROFILE, username: 'updatedname', color: '#45B7D1' };
    await act(async () => {
      await result.current.setProfile(updatedProfile);
    });

    expect(result.current.profile?.username).toBe('updatedname');
    expect(result.current.profile?.color).toBe('#45B7D1');
  });
});

// ─── 3. profileErrorToastUpdater unit tests ───────────────────────────────────

import { profileErrorToastUpdater } from '../context/HopContext';
import type { ToastNotification } from '../context/HopContext';

describe('profileErrorToastUpdater (exported from HopContext)', () => {
  it('adds a profile error toast to an empty queue', () => {
    const result = profileErrorToastUpdater([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: 'error',
      content: "Couldn't save your profile — please try again.",
    });
  });

  it('does not add a second error toast when one already exists (deduplication)', () => {
    const existing: ToastNotification[] = [
      { kind: 'error', content: "Couldn't save your profile — please try again." },
    ];
    const result = profileErrorToastUpdater(existing);
    expect(result).toBe(existing);
    expect(result).toHaveLength(1);
  });

  it('the profile error toast content does not mention messages', () => {
    const result = profileErrorToastUpdater([]);
    expect(result[0].content).not.toMatch(/messages/i);
  });
});
