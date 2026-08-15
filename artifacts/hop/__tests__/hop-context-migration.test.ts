/**
 * Tests for the one-time migration that lifts unscoped legacy storage keys
 * (@hop/blocked, @hop/requests) into profile-scoped keys on app update.
 *
 * The migration block lives in HopContext.tsx (useEffect, around line 227).
 *
 * Runs under jest-expo (jest.context.config.js) so react-native packages are
 * correctly transformed.
 *
 * Coverage:
 *  1. App update path — legacy data copied to scoped key, legacy key removed,
 *     and the migrated data surfaces correctly in context state.
 *  2. Legacy key present but scoped key already exists — no overwrite, legacy removed,
 *     context uses the existing scoped data.
 *  3. New install — no legacy keys, no scoped keys written, no error.
 *  4. Already-migrated user — scoped data present, no legacy, untouched.
 *  5. First-time install (no profile yet) — migration entirely skipped.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop } from '../context/HopContext';

const mockGetItem    = AsyncStorage.getItem    as jest.MockedFunction<typeof AsyncStorage.getItem>;
const mockSetItem    = AsyncStorage.setItem    as jest.MockedFunction<typeof AsyncStorage.setItem>;
const mockRemoveItem = AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>;

// ─── Constants ────────────────────────────────────────────────────────────────

const PROFILE_ID = 'test-user-123';
const FAKE_PROFILE = JSON.stringify({
  id: PROFILE_ID,
  username: 'tester',
  color: '#AAAAAA',
  discoverable: true,
});

const LEGACY_BLOCKED_KEY  = '@hop/blocked';
const LEGACY_REQUESTS_KEY = '@hop/requests';
const LEGACY_MUTED_KEY    = '@hop/muted';
const SCOPED_BLOCKED_KEY  = `@hop/blocked/${PROFILE_ID}`;
const SCOPED_REQUESTS_KEY = `@hop/requests/${PROFILE_ID}`;
const SCOPED_MUTED_KEY    = `@hop/muted/${PROFILE_ID}`;

const SAMPLE_BLOCKED  = JSON.stringify(['u2', 'u3']);
const SAMPLE_MUTED    = JSON.stringify(['u5']);
const SAMPLE_REQUESTS = JSON.stringify([
  {
    id: 'req1',
    fromUser: { id: 'u4', username: 'phaseloop', color: '#DDA0DD', signal: 0, angle: 3.8 },
    preview: 'hey!',
    timestamp: 1_000_000,
  },
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HopProvider, null, children);
}

/**
 * Build stateful AsyncStorage mocks from an initial key → value seed.
 * setItem updates the in-memory store, so subsequent getItem calls see the
 * written value — matching how real AsyncStorage behaves across the migration
 * and then the data-load phases that happen in the same useEffect.
 */
function makeStatefulStore(seed: Record<string, string | null>) {
  const store: Record<string, string | null> = { ...seed };

  mockGetItem.mockImplementation((key: string) =>
    Promise.resolve(store[key] ?? null)
  );
  mockSetItem.mockImplementation((key: string, value: string) => {
    store[key] = value;
    return Promise.resolve(undefined);
  });
  mockRemoveItem.mockImplementation((key: string) => {
    store[key] = null;
    return Promise.resolve(undefined);
  });

  return store;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Block-list and request-history migration on app update', () => {
  // ── Scenario 1: Typical app-update path ─────────────────────────────────────
  //
  // The user had data stored under the old unscoped keys.  After the update the
  // migration block should copy both values to the scoped keys, then delete the
  // legacy keys so the migration never runs again.  Crucially the data must also
  // be visible in the context state after load.

  it('copies legacy blocked + requests to scoped keys, removes legacy keys, and surfaces the data in state', async () => {
    makeStatefulStore({
      '@hop/profile':        FAKE_PROFILE,
      [LEGACY_BLOCKED_KEY]:  SAMPLE_BLOCKED,
      [LEGACY_REQUESTS_KEY]: SAMPLE_REQUESTS,
      // scoped keys intentionally absent
    });

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Migration must write the legacy values into the scoped keys.
    expect(mockSetItem).toHaveBeenCalledWith(SCOPED_BLOCKED_KEY, SAMPLE_BLOCKED);
    expect(mockSetItem).toHaveBeenCalledWith(SCOPED_REQUESTS_KEY, SAMPLE_REQUESTS);

    // Legacy keys must be cleaned up.
    expect(mockRemoveItem).toHaveBeenCalledWith(LEGACY_BLOCKED_KEY);
    expect(mockRemoveItem).toHaveBeenCalledWith(LEGACY_REQUESTS_KEY);

    // The migrated data must surface in context state.
    expect(result.current.blockedIds).toEqual(['u2', 'u3']);
    expect(result.current.messageRequests).toHaveLength(1);
    expect(result.current.messageRequests[0].id).toBe('req1');
  });

  // ── Scenario 2: Scoped key already exists (partial re-run guard) ─────────────
  //
  // If the app crashed mid-migration last time, or a concurrent process already
  // wrote the scoped key, the migration must not overwrite it with stale legacy
  // data.  But the legacy key should still be cleaned up.

  it('does not overwrite an existing scoped key, but still removes the legacy key', async () => {
    const EXISTING_SCOPED_BLOCKED  = JSON.stringify(['u5']);
    const EXISTING_SCOPED_REQUESTS = JSON.stringify([]);

    makeStatefulStore({
      '@hop/profile':           FAKE_PROFILE,
      [LEGACY_BLOCKED_KEY]:     SAMPLE_BLOCKED,    // stale leftover
      [LEGACY_REQUESTS_KEY]:    SAMPLE_REQUESTS,   // stale leftover
      [SCOPED_BLOCKED_KEY]:     EXISTING_SCOPED_BLOCKED,
      [SCOPED_REQUESTS_KEY]:    EXISTING_SCOPED_REQUESTS,
    });

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Must NOT overwrite scoped keys with the stale legacy values.
    expect(mockSetItem).not.toHaveBeenCalledWith(SCOPED_BLOCKED_KEY, SAMPLE_BLOCKED);
    expect(mockSetItem).not.toHaveBeenCalledWith(SCOPED_REQUESTS_KEY, SAMPLE_REQUESTS);

    // Legacy keys must still be removed.
    expect(mockRemoveItem).toHaveBeenCalledWith(LEGACY_BLOCKED_KEY);
    expect(mockRemoveItem).toHaveBeenCalledWith(LEGACY_REQUESTS_KEY);

    // Context must reflect the already-scoped data, not the stale legacy data.
    expect(result.current.blockedIds).toEqual(['u5']);
    expect(result.current.messageRequests).toHaveLength(0);
  });

  // ── Scenario 3: Fresh install — no legacy keys anywhere ──────────────────────
  //
  // A brand-new user has never had the unscoped keys.  The migration block must
  // be a silent no-op: no scoped keys written, no removals, no error toast.

  it('leaves storage untouched on a fresh install with no legacy keys', async () => {
    makeStatefulStore({
      '@hop/profile': FAKE_PROFILE,
      // no legacy keys, no scoped keys
    });

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // No migration writes for blocked/requests.
    expect(mockSetItem).not.toHaveBeenCalledWith(SCOPED_BLOCKED_KEY, expect.anything());
    expect(mockSetItem).not.toHaveBeenCalledWith(SCOPED_REQUESTS_KEY, expect.anything());

    // No removal of keys that never existed.
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_BLOCKED_KEY);
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_REQUESTS_KEY);

    // Context starts clean.
    expect(result.current.blockedIds).toHaveLength(0);
    expect(result.current.messageRequests).toHaveLength(0);
    expect(result.current.pendingToast).toBeNull();
  });

  // ── Scenario 4: Already-migrated user — second launch ────────────────────────
  //
  // The migration already ran in a previous session.  Scoped data is present and
  // legacy keys are gone.  Nothing should change on this load.

  it('is a no-op when the user was already migrated in a prior session', async () => {
    makeStatefulStore({
      '@hop/profile':       FAKE_PROFILE,
      [SCOPED_BLOCKED_KEY]:  SAMPLE_BLOCKED,
      [SCOPED_REQUESTS_KEY]: SAMPLE_REQUESTS,
      // no legacy keys
    });

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // No removal attempted for keys that do not exist.
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_BLOCKED_KEY);
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_REQUESTS_KEY);

    // No re-write of scoped keys.
    expect(mockSetItem).not.toHaveBeenCalledWith(SCOPED_BLOCKED_KEY, expect.anything());
    expect(mockSetItem).not.toHaveBeenCalledWith(SCOPED_REQUESTS_KEY, expect.anything());

    // Scoped data loads correctly into context.
    expect(result.current.blockedIds).toEqual(['u2', 'u3']);
    expect(result.current.messageRequests).toHaveLength(1);
    expect(result.current.messageRequests[0].id).toBe('req1');
    expect(result.current.pendingToast).toBeNull();
  });

  // ── Scenario 5: First-time onboarding — no profile yet ───────────────────────
  //
  // When there is no profile the migration block is guarded by `if (profileId)`
  // and must be skipped entirely.  The app enters onboarding mode without error.

  it('skips migration entirely when no profile exists (first-time onboarding)', async () => {
    makeStatefulStore({
      // No profile — the rest of the keys are irrelevant.
      [LEGACY_BLOCKED_KEY]:  SAMPLE_BLOCKED,
      [LEGACY_REQUESTS_KEY]: SAMPLE_REQUESTS,
    });

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.isOnboarding).toBe(true);

    // Migration must not have run — no writes to any scoped blocked/requests key.
    expect(mockSetItem).not.toHaveBeenCalledWith(
      expect.stringContaining('/blocked/'),
      expect.anything(),
    );
    expect(mockSetItem).not.toHaveBeenCalledWith(
      expect.stringContaining('/requests/'),
      expect.anything(),
    );
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_BLOCKED_KEY);
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_REQUESTS_KEY);
  });

  // ── Scenario 6: setItem fails mid-migration — no silent data loss ─────────────
  //
  // If the write to the scoped key throws (e.g. storage quota exceeded), the
  // migration must NOT remove the legacy key.  Leaving the legacy key intact
  // means the next app launch will retry the migration safely — the user's data
  // is never silently destroyed.
  //
  // The context must also surface an error toast so the user knows something
  // went wrong rather than silently swallowing the failure.

  it('does not remove legacy keys when the scoped-key write fails (no silent data loss)', async () => {
    const store: Record<string, string | null> = {
      '@hop/profile':        FAKE_PROFILE,
      [LEGACY_BLOCKED_KEY]:  SAMPLE_BLOCKED,
      [LEGACY_REQUESTS_KEY]: SAMPLE_REQUESTS,
      [LEGACY_MUTED_KEY]:    SAMPLE_MUTED,
      // scoped keys absent — migration should attempt to run
    };

    mockGetItem.mockImplementation((key: string) =>
      Promise.resolve(store[key] ?? null)
    );

    // setItem rejects for any scoped migration target; succeeds for everything else.
    mockSetItem.mockImplementation((key: string, value: string) => {
      if (
        key === SCOPED_BLOCKED_KEY ||
        key === SCOPED_REQUESTS_KEY ||
        key === SCOPED_MUTED_KEY
      ) {
        return Promise.reject(new Error('Storage quota exceeded'));
      }
      store[key] = value;
      return Promise.resolve(undefined);
    });

    mockRemoveItem.mockImplementation((key: string) => {
      store[key] = null;
      return Promise.resolve(undefined);
    });

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Legacy keys must be preserved — removing them would silently destroy the
    // user's data since the scoped write never landed.
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_BLOCKED_KEY);
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_REQUESTS_KEY);
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_MUTED_KEY);

    // An error toast must be shown so the failure is not invisible to the user.
    await waitFor(() => expect(result.current.pendingToast).not.toBeNull());
    expect(result.current.pendingToast).toMatchObject({
      kind: 'error',
      content: expect.stringContaining("Couldn't save"),
    });
  });

  // ── Scenario 7: Only the muted scoped-key write fails — per-key independence ──
  //
  // The three migrations run as independent promise chains inside Promise.all.
  // If the muted setItem throws but blocked and requests succeed, then:
  //   • @hop/blocked and @hop/requests MUST be removed (their chains completed)
  //   • @hop/muted MUST be preserved (its chain never reached removeItem)
  //   • An error toast must surface to signal the partial failure
  //   • The successfully migrated blocked/requests data must appear in state
  //
  // This verifies that a kill mid-update only forces a retry for the key that
  // actually failed — not for the keys that were already cleanly migrated.

  it('only preserves the muted legacy key when the muted scoped-key write fails, and cleans up blocked/requests', async () => {
    const store: Record<string, string | null> = {
      '@hop/profile':        FAKE_PROFILE,
      [LEGACY_BLOCKED_KEY]:  SAMPLE_BLOCKED,
      [LEGACY_REQUESTS_KEY]: SAMPLE_REQUESTS,
      [LEGACY_MUTED_KEY]:    SAMPLE_MUTED,
      // scoped keys absent — all three migrations should attempt to run
    };

    mockGetItem.mockImplementation((key: string) =>
      Promise.resolve(store[key] ?? null)
    );

    // Only the muted scoped write fails; blocked and requests writes succeed.
    mockSetItem.mockImplementation((key: string, value: string) => {
      if (key === SCOPED_MUTED_KEY) {
        return Promise.reject(new Error('Storage quota exceeded'));
      }
      store[key] = value;
      return Promise.resolve(undefined);
    });

    mockRemoveItem.mockImplementation((key: string) => {
      store[key] = null;
      return Promise.resolve(undefined);
    });

    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // blocked and requests chains completed fully — legacy keys must be gone.
    expect(mockRemoveItem).toHaveBeenCalledWith(LEGACY_BLOCKED_KEY);
    expect(mockRemoveItem).toHaveBeenCalledWith(LEGACY_REQUESTS_KEY);

    // muted chain never reached removeItem — legacy key must still exist.
    expect(mockRemoveItem).not.toHaveBeenCalledWith(LEGACY_MUTED_KEY);

    // Successfully migrated data must surface in context state.
    expect(result.current.blockedIds).toEqual(['u2', 'u3']);
    expect(result.current.messageRequests).toHaveLength(1);
    expect(result.current.messageRequests[0].id).toBe('req1');

    // An error toast must be shown so the partial failure is not invisible.
    await waitFor(() => expect(result.current.pendingToast).not.toBeNull());
    expect(result.current.pendingToast).toMatchObject({
      kind: 'error',
      content: expect.stringContaining("Couldn't save"),
    });
  });
});
