/**
 * Tests for HopContext's toggleMute failure path.
 *
 * Scenario: a user mutes or unmutes a conversation and the AsyncStorage write
 * fails (e.g. storage is full).  The tests verify that:
 *
 *  1. The in-memory mutedIds set is rolled back to the pre-toggle state.
 *  2. An error toast is shown — the failure is never silent.
 *  3. No toast is pushed and no rollback occurs on the happy path.
 *  4. Any UI component deriving a badge count from mutedIds.size (tab-bar
 *     badge, section header count, etc.) snaps back to the correct value
 *     after the rollback, covering both mute (0→1→0) and unmute (1→0→1).
 *
 * Runs under jest-expo (see jest.context.config.js).
 */

import React from 'react';
import { Text } from 'react-native';
import { renderHook, render, act, waitFor, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop, storageErrorToastUpdater } from '../context/HopContext';
import type { MyProfile, ToastNotification } from '../context/HopContext';

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

const MUTED_KEY = `@hop/muted/${STORED_PROFILE.id}`;

/**
 * Mount HopProvider with a pre-existing stored profile and an empty muted set.
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

describe('HopContext — toggleMute storage failure', () => {
  it('rolls back the in-memory muted set when the write rejects', async () => {
    const { result } = await mountWithProfile();

    // Verify initially not muted.
    expect(result.current.isMuted('u1')).toBe(false);

    // Make the write fail.
    mockSetItem.mockRejectedValue(new Error('storage full'));

    await act(async () => {
      await result.current.toggleMute('u1');
    });
    await flushMicrotasks();

    // Optimistic update must be rolled back — u1 should NOT be muted.
    expect(result.current.isMuted('u1')).toBe(false);
  });

  it('shows an error toast when the mute write rejects', async () => {
    const { result } = await mountWithProfile();

    mockSetItem.mockRejectedValue(new Error('storage full'));

    await act(async () => {
      await result.current.toggleMute('u2');
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).not.toBeNull();
    expect(result.current.pendingToast?.kind).toBe('error');
  });

  it('rolls back an unmute (re-mutes) when the write rejects', async () => {
    // Pre-load with u3 already muted.
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === MUTED_KEY) return Promise.resolve(JSON.stringify(['u3']));
      return Promise.resolve(null);
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const hookResult = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
    await waitFor(() => expect(hookResult.result.current.isMuted('u3')).toBe(true));

    // Make the unmute write fail.
    mockSetItem.mockRejectedValue(new Error('quota exceeded'));

    await act(async () => {
      await hookResult.result.current.toggleMute('u3');
    });
    await flushMicrotasks();

    // Rollback: u3 should still be muted.
    expect(hookResult.result.current.isMuted('u3')).toBe(true);
    expect(hookResult.result.current.pendingToast?.kind).toBe('error');
  });
});

// ─── 2. Happy path ────────────────────────────────────────────────────────────

describe('HopContext — toggleMute happy path', () => {
  it('mutes a conversation when the write succeeds', async () => {
    const { result } = await mountWithProfile();

    await act(async () => {
      await result.current.toggleMute('u1');
    });
    await flushMicrotasks();

    expect(result.current.isMuted('u1')).toBe(true);
    expect(result.current.pendingToast).toBeNull();
  });

  it('unmutes a conversation when the write succeeds', async () => {
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === MUTED_KEY) return Promise.resolve(JSON.stringify(['u2']));
      return Promise.resolve(null);
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const hookResult = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
    await waitFor(() => expect(hookResult.result.current.isMuted('u2')).toBe(true));

    await act(async () => {
      await hookResult.result.current.toggleMute('u2');
    });
    await flushMicrotasks();

    expect(hookResult.result.current.isMuted('u2')).toBe(false);
    expect(hookResult.result.current.pendingToast).toBeNull();
  });

  it('persists the muted id to storage on success', async () => {
    const { result } = await mountWithProfile();

    await act(async () => {
      await result.current.toggleMute('u4');
    });
    await flushMicrotasks();

    expect(mockSetItem).toHaveBeenCalledWith(MUTED_KEY, JSON.stringify(['u4']));
  });

  it('no error toast is pushed when the write succeeds', async () => {
    const { result } = await mountWithProfile();

    await act(async () => {
      await result.current.toggleMute('u5');
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toBeNull();
  });
});

// ─── 3. Concurrent toggle ordering ────────────────────────────────────────────
//
// Verifies the surgical rollback: a failed early toggle must not clobber
// successful later toggles on different IDs.

describe('HopContext — toggleMute concurrent ordering', () => {
  it('a failed earlier toggle does not remove a different id added by a later successful toggle', async () => {
    const { result } = await mountWithProfile();

    // Toggle A will fail; toggle B will succeed.
    let rejectA!: (err: Error) => void;
    const writeA = new Promise<undefined>((_res, rej) => { rejectA = rej; });
    let resolveB!: () => void;
    const writeB = new Promise<undefined>(res => { resolveB = () => res(undefined); });

    // First call → writeA (will fail), second call → writeB (will succeed).
    mockSetItem
      .mockReturnValueOnce(writeA)
      .mockReturnValueOnce(writeB);

    // Start toggle A (mute u1) — optimistic update applied, write pending.
    let promiseA!: Promise<void>;
    await act(async () => {
      promiseA = result.current.toggleMute('u1');
      await Promise.resolve(); // flush optimistic state
    });
    expect(result.current.isMuted('u1')).toBe(true);

    // Start toggle B (mute u2) — optimistic update applied on top of A's.
    let promiseB!: Promise<void>;
    await act(async () => {
      promiseB = result.current.toggleMute('u2');
      await Promise.resolve();
    });
    expect(result.current.isMuted('u1')).toBe(true);
    expect(result.current.isMuted('u2')).toBe(true);

    // B's write resolves successfully, then A's write rejects.
    await act(async () => {
      resolveB();
      await promiseB;
    });
    await act(async () => {
      rejectA(new Error('storage full'));
      await promiseA.catch(() => {}); // toggleMute swallows internally
    });
    await flushMicrotasks();

    // A's rollback should surgically remove only u1.
    // u2 was added by B and must remain muted.
    expect(result.current.isMuted('u1')).toBe(false);
    expect(result.current.isMuted('u2')).toBe(true);
    expect(result.current.pendingToast?.kind).toBe('error');
  });

  it('a failed earlier toggle does not re-add an id that was unmuted by a later successful toggle', async () => {
    // Start with u5 already muted.
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === MUTED_KEY) return Promise.resolve(JSON.stringify(['u5', 'u6']));
      return Promise.resolve(null);
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const hookResult = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
    await waitFor(() => expect(hookResult.result.current.isMuted('u5')).toBe(true));

    // Toggle A: unmute u6 (will fail).
    // Toggle B: unmute u5 (will succeed).
    let rejectA!: (err: Error) => void;
    const writeA = new Promise<undefined>((_res, rej) => { rejectA = rej; });
    let resolveB!: () => void;
    const writeB = new Promise<undefined>(res => { resolveB = () => res(undefined); });

    mockSetItem
      .mockReturnValueOnce(writeA)
      .mockReturnValueOnce(writeB);

    let promiseA!: Promise<void>;
    await act(async () => {
      promiseA = hookResult.result.current.toggleMute('u6');
      await Promise.resolve();
    });
    expect(hookResult.result.current.isMuted('u6')).toBe(false); // optimistic

    let promiseB!: Promise<void>;
    await act(async () => {
      promiseB = hookResult.result.current.toggleMute('u5');
      await Promise.resolve();
    });
    expect(hookResult.result.current.isMuted('u5')).toBe(false); // optimistic

    // B succeeds, A fails.
    await act(async () => {
      resolveB();
      await promiseB;
    });
    await act(async () => {
      rejectA(new Error('storage full'));
      await promiseA.catch(() => {});
    });
    await flushMicrotasks();

    // A's rollback re-mutes u6, but must NOT re-mute u5 (B succeeded).
    expect(hookResult.result.current.isMuted('u6')).toBe(true);  // rolled back
    expect(hookResult.result.current.isMuted('u5')).toBe(false); // B's unmute persists
    expect(hookResult.result.current.pendingToast?.kind).toBe('error');
  });
});

// ─── 4. storageErrorToastUpdater deduplication ───────────────────────────────

describe('storageErrorToastUpdater (reused by toggleMute)', () => {
  it('adds a storage error toast to an empty queue', () => {
    const result = storageErrorToastUpdater([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: 'error',
      content: "Couldn't save messages — storage may be full.",
    });
  });

  it('does not add a second error toast when one already exists (deduplication)', () => {
    const existing: ToastNotification[] = [
      { kind: 'error', content: "Couldn't save messages — storage may be full." },
    ];
    const result = storageErrorToastUpdater(existing);
    expect(result).toBe(existing);
    expect(result).toHaveLength(1);
  });
});

// ─── 5. Muted-count badge stays in sync after rollback ────────────────────────
//
// Mounts a component (via HopProvider) that reads mutedIds.size from context
// and renders it as text.  After a failed toggle the badge count must snap
// back to the pre-toggle value — covering both the mute (0 → 1 → 0) and
// unmute (1 → 0 → 1) directions.
//
// Each test uses a self-contained component tree: a single HopProvider wraps
// both the badge display and a toggle trigger so the badge and the action
// share the same context instance.  mockGetItem is set explicitly in every
// test to avoid stale implementations leaking from prior tests
// (jest.clearAllMocks does not reset implementations).

/**
 * Self-contained test component.
 * Renders the muted-count badge and a button that calls toggleMute(id).
 */
function MutedCountFixture({ id }: { id: string }) {
  const { mutedIds, toggleMute, pendingToast, loaded } = useHop();
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Text, { testID: 'loaded' }, loaded ? 'yes' : 'no'),
    React.createElement(Text, { testID: 'muted-count' }, String(mutedIds.size)),
    React.createElement(Text, { testID: 'toast-kind' }, pendingToast?.kind ?? 'none'),
    React.createElement(
      // Use Text as a pressable stand-in; we call toggleMute imperatively.
      Text,
      { testID: 'toggle-btn', onPress: () => { void toggleMute(id); } },
      'toggle'
    ),
  );
}

describe('HopContext — muted-count badge stays in sync after failed toggleMute', () => {
  it('returns the badge count to 0 after a failed mute (0 → 1 → 0 on rollback)', async () => {
    // Explicit mockGetItem so stale implementations from prior tests don't leak.
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      return Promise.resolve(null); // no pre-existing muted ids
    });

    render(
      React.createElement(HopProvider, null,
        React.createElement(MutedCountFixture, { id: 'u1' })
      )
    );

    // Wait for the provider to finish loading; badge starts at 0.
    await waitFor(() => expect(screen.getByTestId('loaded').props.children).toBe('yes'));
    expect(screen.getByTestId('muted-count').props.children).toBe('0');

    // Make the next storage write fail.
    mockSetItem.mockRejectedValue(new Error('storage full'));

    // Trigger the mute — optimistic update pushes count to 1, rollback returns to 0.
    await act(async () => {
      screen.getByTestId('toggle-btn').props.onPress();
      // Flush the async toggle to completion.
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    // Badge must have snapped back to 0 and an error toast must be queued.
    expect(screen.getByTestId('muted-count').props.children).toBe('0');
    expect(screen.getByTestId('toast-kind').props.children).toBe('error');
  });

  it('returns the badge count to 1 after a failed unmute (1 → 0 → 1 on rollback)', async () => {
    // Pre-load with one id already muted.
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === MUTED_KEY) return Promise.resolve(JSON.stringify(['u9']));
      return Promise.resolve(null);
    });

    render(
      React.createElement(HopProvider, null,
        React.createElement(MutedCountFixture, { id: 'u9' })
      )
    );

    // Wait for the provider to finish loading; badge starts at 1.
    await waitFor(() => expect(screen.getByTestId('loaded').props.children).toBe('yes'));
    await waitFor(() => expect(screen.getByTestId('muted-count').props.children).toBe('1'));

    // Make the unmute write fail.
    mockSetItem.mockRejectedValue(new Error('quota exceeded'));

    // Trigger the unmute — optimistic update drops count to 0, rollback returns to 1.
    await act(async () => {
      screen.getByTestId('toggle-btn').props.onPress();
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    // Badge must have snapped back to 1 and an error toast must be queued.
    expect(screen.getByTestId('muted-count').props.children).toBe('1');
    expect(screen.getByTestId('toast-kind').props.children).toBe('error');
  });
});
