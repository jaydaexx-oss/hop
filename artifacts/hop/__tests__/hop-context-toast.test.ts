/**
 * Tests for HopContext's error toast behaviour.
 *
 * Runs under jest-expo (see jest.context.config.js) so react-native modules
 * are properly transformed by babel-jest.
 *
 * Coverage:
 *  1. storageErrorToastUpdater — the real exported function that HopProvider
 *     passes to setToastQueue; tested directly so deduplication logic is
 *     exercised against production code, not a local copy.
 *  2. HopProvider mount — AsyncStorage.setItem is forced to reject; context
 *     actions that persist data are called; the resulting pendingToast is
 *     asserted to be an error toast.
 *  3. Deduplication confirmed via the provider — two rapid failures produce
 *     only one error toast.
 */

// ─── 1. Real exported updater function ───────────────────────────────────────

import { storageErrorToastUpdater } from '../context/HopContext';
import type { ToastNotification } from '../context/HopContext';

describe('storageErrorToastUpdater (exported from HopContext)', () => {
  it('adds an error toast to an empty queue', () => {
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
    expect(result).toBe(existing); // same reference — nothing appended
    expect(result).toHaveLength(1);
  });

  it('suppresses even a differently-worded error toast', () => {
    const existing: ToastNotification[] = [{ kind: 'error', content: 'Some other error' }];
    const result = storageErrorToastUpdater(existing);
    expect(result).toBe(existing);
  });

  it('adds an error toast after non-error toasts', () => {
    const existing: ToastNotification[] = [
      { kind: 'dm', targetId: 'u1', senderName: 'wavejockey', senderColor: '#FF6B6B', content: 'hey' },
    ];
    const result = storageErrorToastUpdater(existing);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ kind: 'error' });
  });

  it('calling the updater twice only produces one error toast', () => {
    const after1 = storageErrorToastUpdater([]);
    const after2 = storageErrorToastUpdater(after1);
    expect(after2).toBe(after1); // no-op on second call
    expect(after2.filter(t => t.kind === 'error')).toHaveLength(1);
  });
});

// ─── 2 & 3. HopProvider mount — real context, real callback wiring ──────────

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop } from '../context/HopContext';

const mockGetItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const mockSetItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

/** Minimal profile so HopContext completes its load phase without going to onboarding. */
const FAKE_PROFILE = JSON.stringify({
  id: 'test-me',
  username: 'tester',
  color: '#AAAAAA',
  discoverable: true,
});

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HopProvider, null, children);
}

// Keep track of intervals/timeouts spawned by HopContext so we can flush them.
beforeEach(() => {
  jest.clearAllMocks();

  // Default: profile exists so the load completes quickly.
  mockGetItem.mockImplementation((key: string) => {
    if (key === '@hop/profile') return Promise.resolve(FAKE_PROFILE);
    return Promise.resolve(null);
  });

  // Default: writes succeed (overridden per-test where failure is needed).
  mockSetItem.mockResolvedValue(undefined);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flushes all pending micro-tasks so that async state updates (e.g. from the
 * rejected setItem promise inside saveConvs) are applied before we assert.
 */
async function flushMicrotasks() {
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HopProvider — error toast wiring', () => {
  it('pushes an error toast when saveConvs fails (markRead path)', async () => {
    // Allow the initial load writes to succeed, then reject subsequent ones.
    // The load effect writes the broadcast seed; afterwards all saves fail.
    let loadDone = false;
    mockSetItem.mockImplementation(async () => {
      if (loadDone) throw new Error('quota exceeded');
    });

    const { result } = await renderHook(() => useHop(), { wrapper });

    // Wait for the context to finish loading.
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    loadDone = true; // from here, all writes fail

    // markRead calls saveConvs(updated, showStorageError).
    // saveConvs is fire-and-forget; flush microtasks so its rejection lands.
    await act(async () => {
      result.current.markRead('u1');
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toMatchObject({ kind: 'error' });
  });

  it('pushes an error toast when saveGroups fails (markGroupRead path)', async () => {
    let loadDone = false;
    mockSetItem.mockImplementation(async () => {
      if (loadDone) throw new Error('write error');
    });

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    loadDone = true;

    await act(async () => {
      result.current.markGroupRead('g1');
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toMatchObject({ kind: 'error' });
  });

  it('only shows one error toast even when multiple saves fail in sequence', async () => {
    let loadDone = false;
    mockSetItem.mockImplementation(async () => {
      if (loadDone) throw new Error('quota exceeded');
    });

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    loadDone = true;

    // Two separate save paths back-to-back.
    await act(async () => {
      result.current.markRead('u1');
      result.current.markGroupRead('g1');
    });
    await flushMicrotasks();

    // Only one error toast should be in the queue.
    const errorToasts = result.current.pendingToast !== null ? 1 : 0;
    expect(result.current.pendingToast).toMatchObject({ kind: 'error' });

    // Dismiss it; deduplication means there's no second error toast queued.
    await act(async () => {
      result.current.dismissToast();
    });

    expect(result.current.pendingToast).toBeNull();
  });

  it('does not show an error toast when storage succeeds', async () => {
    // All writes succeed (already the default).
    mockSetItem.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    await act(async () => {
      result.current.markRead('u1');
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toBeNull();
  });

  // ── Hydration / reload path ──────────────────────────────────────────────────
  //
  // This is the scenario named in the task: the app is reloaded and the
  // initial broadcast-seed write (or any other startup persistence) fails.
  // The error must reach the user as a toast even during that first load.

  it('shows an error toast when the broadcast seed write fails on startup', async () => {
    // No existing broadcast data — getItem returns null — so the seed path runs.
    // Force every setItem to reject so the saveBroadcasts onError fires.
    mockSetItem.mockRejectedValue(new Error('storage full'));

    const { result } = await renderHook(() => useHop(), { wrapper });

    // Load should still complete (storage errors are caught internally now and
    // do NOT cause the outer catch to swallow the load into onboarding-only mode).
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    // The error toast must have been enqueued during load.
    await flushMicrotasks();
    expect(result.current.pendingToast).toMatchObject({ kind: 'error' });
  });
});
