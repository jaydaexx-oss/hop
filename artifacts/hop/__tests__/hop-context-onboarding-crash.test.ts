/**
 * Tests for HopContext's completeOnboarding failure path.
 *
 * Scenario: the very first profile write to AsyncStorage fails (quota full,
 * I/O error, app killed mid-write).  The test verifies that:
 *
 *  1. The app stays in onboarding mode — isOnboarding remains true and
 *     profile is null after the failed call.
 *  2. No partial profile state leaks to a subsequent simulated launch —
 *     because @hop/profile was never written, the next mount also sees
 *     isOnboarding: true.
 *  3. An error toast is surfaced so the failure is never invisible to the user.
 *
 * Runs under jest-expo (see jest.context.config.js).
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop } from '../context/HopContext';

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

/**
 * Mount a fresh HopProvider with no stored profile (first-time install).
 *
 * Mirrors the mountAndLoad() pattern from the other context test suites:
 * call renderHook directly (it is synchronous), then waitFor loaded:true so
 * the async load IIFE has time to complete.  The HopContext load refactor
 * batches setIsOnboarding(true) + setLoaded(true) together in the finally
 * block so both fire in a single React batch at the end of the IIFE.
 */
async function mountFreshInstall() {
  mockGetItem.mockImplementation(() => Promise.resolve(null));
  // eslint-disable-next-line @typescript-eslint/await-thenable
  const hookResult = await renderHook(() => useHop(), { wrapper });
  await waitFor(() => {
    expect(hookResult.result.current.loaded).toBe(true);
  });
  return hookResult;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: all writes succeed; overridden per-test for failure scenarios.
  mockSetItem.mockResolvedValue(undefined);
});

// ─── 1. isOnboarding stays true after a failed completeOnboarding ─────────────

describe('HopContext — completeOnboarding storage failure', () => {
  it('isOnboarding remains true when the profile write rejects', async () => {
    const { result } = await mountFreshInstall();

    // Pre-condition: fresh install starts in onboarding.
    expect(result.current.isOnboarding).toBe(true);
    expect(result.current.profile).toBeNull();

    // Force the @hop/profile write to fail.
    mockSetItem.mockRejectedValue(new Error('storage full'));

    await act(async () => {
      await result.current.completeOnboarding('alice', '#FF6B6B');
    });

    // Still in onboarding — the failure must not advance the user past setup.
    expect(result.current.isOnboarding).toBe(true);
  });

  it('profile is null after the failed write (no partial in-memory state)', async () => {
    const { result } = await mountFreshInstall();

    mockSetItem.mockRejectedValue(new Error('disk error'));

    await act(async () => {
      await result.current.completeOnboarding('bob', '#4ECDC4');
    });

    // The optimistic setProfileState must have been rolled back.
    expect(result.current.profile).toBeNull();
  });

  it('an error toast is shown so the failure is not silent', async () => {
    const { result } = await mountFreshInstall();

    mockSetItem.mockRejectedValue(new Error('quota exceeded'));

    await act(async () => {
      await result.current.completeOnboarding('carol', '#45B7D1');
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toMatchObject({
      kind: 'error',
      content: "Couldn't save your profile — please try again.",
    });
    expect(result.current.pendingToast).not.toMatchObject({
      content: expect.stringContaining('messages'),
    });
  });
});

// ─── 2. No partial state leaks to the next simulated launch ───────────────────

describe('HopContext — next launch after a failed onboarding save', () => {
  it('re-mount with no stored profile still enters onboarding (no leaked key)', async () => {
    // ── First "crash" run ──
    const { result: firstResult } = await mountFreshInstall();

    mockSetItem.mockRejectedValue(new Error('write failed'));
    await act(async () => {
      await firstResult.current.completeOnboarding('dave', '#96CEB4');
    });

    // The write was attempted but rejected; @hop/profile was never committed.
    const profileWrites = mockSetItem.mock.calls.filter(([key]) => key === '@hop/profile');
    expect(profileWrites).toHaveLength(1); // attempted exactly once, then failed

    // ── Second launch: storage still has no profile (write failed above) ──
    mockSetItem.mockResolvedValue(undefined); // writes succeed now

    const secondHook = await mountFreshInstall();

    // Must enter onboarding again — no partial profile from the first run.
    expect(secondHook.result.current.isOnboarding).toBe(true);
    expect(secondHook.result.current.profile).toBeNull();
  });
});

// ─── 3. Successful onboarding still works after this change ───────────────────

describe('HopContext — completeOnboarding happy path (regression guard)', () => {
  it('exits onboarding and sets profile when the write succeeds', async () => {
    const { result } = await mountFreshInstall();

    await act(async () => {
      await result.current.completeOnboarding('eve', '#DDA0DD');
    });

    expect(result.current.isOnboarding).toBe(false);
    expect(result.current.profile).not.toBeNull();
    expect(result.current.profile?.username).toBe('eve');
    expect(result.current.profile?.color).toBe('#DDA0DD');
  });

  it('persists profile to AsyncStorage on success', async () => {
    const { result } = await mountFreshInstall();

    await act(async () => {
      await result.current.completeOnboarding('frank', '#F0A500');
    });

    const profileWrites = mockSetItem.mock.calls.filter(([key]) => key === '@hop/profile');
    expect(profileWrites).toHaveLength(1);
    const saved = JSON.parse(profileWrites[0][1] as string);
    expect(saved.username).toBe('frank');
    expect(saved.color).toBe('#F0A500');
    expect(saved.discoverable).toBe(true);
  });

  it('no error toast is pushed when onboarding completes successfully', async () => {
    const { result } = await mountFreshInstall();

    await act(async () => {
      await result.current.completeOnboarding('grace', '#6C5CE7');
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toBeNull();
  });
});
