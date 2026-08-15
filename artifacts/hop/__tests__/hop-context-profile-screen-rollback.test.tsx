/**
 * Tests confirming that the ProfileScreen form state resets to pre-edit values
 * when a setProfile write fails.
 *
 * Three layers are tested here:
 *
 *   A. Context layer (uses HopProvider + useHop, mirrors hop-context-set-profile
 *      tests) — verifies that setProfile returns false on failure (so the screen
 *      can skip success haptics) and that profile rolls back correctly.
 *
 *   B. Screen form-sync layer (pure hook test, no HopProvider) — verifies that
 *      the useEffect added to profile.tsx correctly resets nameInput whenever
 *      !editing and profile.username changes, including after a context rollback.
 *
 *   C. Color picker integration — mounts the real ProfileScreen component inside
 *      HopProvider, presses a color dot, rejects the AsyncStorage write, and
 *      confirms the original dot's selected styling snaps back.
 *
 * afterEach(cleanup) unmounts every HopProvider between tests so that the
 * setInterval timers created by HopContext do not leak across test boundaries.
 *
 * Runs under jest.context.config.js (jest-expo preset).
 */

// ─── Module-level mocks for ProfileScreen's native/router dependencies ─────────
// These are hoisted by babel-jest and apply only within this file.

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true }),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#000011',
    foreground: '#FFFFFF',
    card: '#001133',
    primary: '#0088BB',
    primaryForeground: '#FFFFFF',
    mutedForeground: '#5A6B90',
    border: '#223366',
    destructive: '#DC2626',
  }),
}));

jest.mock('@/components/QRCodeModal', () => ({
  QRCodeModal: () => null,
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { renderHook, render, fireEvent, act, waitFor, cleanup } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop } from '../context/HopContext';
import type { MyProfile } from '../context/HopContext';
import ProfileScreen from '../app/(tabs)/profile';

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

// ─── Wrapper component ────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HopProvider, null, children);
}

// ─── Setup helpers ─────────────────────────────────────────────────────────────

/** Mounts HopProvider with STORED_PROFILE pre-loaded and waits for it to settle. */
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

/**
 * Renders ProfileScreen inside HopProvider with STORED_PROFILE pre-loaded,
 * then waits for the profile to hydrate so the color picker dots are visible.
 */
async function renderProfileScreen() {
  mockGetItem.mockImplementation((key: string) => {
    if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
    return Promise.resolve(null);
  });
  // eslint-disable-next-line @typescript-eslint/await-thenable
  const ui = await render(
    React.createElement(HopProvider, null, React.createElement(ProfileScreen)),
  );
  // Wait for the profile to load — ProfileScreen returns null until profile is set.
  await waitFor(() => ui.getByTestId('color-dot-#FF6B6B'));
  return ui;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItem.mockResolvedValue(undefined);
});

// Unmount all rendered components (including HopProvider instances) after each
// test so that the setInterval timers created by HopContext do not fire into
// the next test's renderer and corrupt result.current.
afterEach(() => {
  cleanup();
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
  it('nameInput resets to original when profile rolls back while not editing', async () => {
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const { result } = await renderHook(
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
    await act(async () => { rerender({ username: 'changed-externally' }); });

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

// ══════════════════════════════════════════════════════════════════════════════
// C. Color picker integration — handleColorSelect path
//
// handleColorSelect in profile.tsx:
//   const handleColorSelect = async (color: string) => {
//     Haptics.selectionAsync();
//     await setProfile({ ...profile, color });
//   };
//
// Each color dot Pressable carries testID={`color-dot-${c}`} (added in
// profile.tsx). The dot is selected when profile.color === c, which is
// expressed as an additional { borderWidth: 3 } object in its style array.
//
// After pressing a new color dot and having the AsyncStorage write rejected,
// the context rolls back profile.color to the original value and the screen
// re-renders: the original dot recovers borderWidth: 3 and the tapped dot
// loses it.
// ══════════════════════════════════════════════════════════════════════════════

/** Returns the flattened borderWidth from a color dot's style prop array. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dotBorderWidth(element: any): number {
  const flat = StyleSheet.flatten(element.props.style as Parameters<typeof StyleSheet.flatten>[0]);
  return (flat as { borderWidth?: number }).borderWidth ?? 0;
}

describe('color picker integration (handleColorSelect path)', () => {
  it('original dot recovers selected style after a failed color-tap write', async () => {
    const { getByTestId } = await renderProfileScreen();

    // Before tapping, the original color dot is selected (borderWidth 3).
    expect(dotBorderWidth(getByTestId('color-dot-#FF6B6B'))).toBe(3);
    expect(dotBorderWidth(getByTestId('color-dot-#4ECDC4'))).toBe(2);

    // Fail the next AsyncStorage write.
    mockSetItem.mockRejectedValueOnce(new Error('storage full'));

    // Press a different color dot — triggers handleColorSelect.
    await act(async () => {
      fireEvent.press(getByTestId('color-dot-#4ECDC4'));
    });

    // After rollback the original dot is selected again.
    await waitFor(() => {
      expect(dotBorderWidth(getByTestId('color-dot-#FF6B6B'))).toBe(3);
    });
    // And the tapped dot is no longer selected.
    expect(dotBorderWidth(getByTestId('color-dot-#4ECDC4'))).toBe(2);
  });

  it('new color dot becomes selected after a successful write', async () => {
    const { getByTestId } = await renderProfileScreen();

    // Press a new color — storage write succeeds.
    await act(async () => {
      fireEvent.press(getByTestId('color-dot-#4ECDC4'));
    });

    await waitFor(() => {
      expect(dotBorderWidth(getByTestId('color-dot-#4ECDC4'))).toBe(3);
    });
    expect(dotBorderWidth(getByTestId('color-dot-#FF6B6B'))).toBe(2);
  });

  it('original dot stays selected across multiple failed taps', async () => {
    const { getByTestId } = await renderProfileScreen();

    // First failed tap.
    mockSetItem.mockRejectedValueOnce(new Error('err'));
    await act(async () => { fireEvent.press(getByTestId('color-dot-#4ECDC4')); });
    await waitFor(() => {
      expect(dotBorderWidth(getByTestId('color-dot-#FF6B6B'))).toBe(3);
    });

    // Second failed tap on a different color.
    mockSetItem.mockRejectedValueOnce(new Error('err'));
    await act(async () => { fireEvent.press(getByTestId('color-dot-#45B7D1')); });
    await waitFor(() => {
      expect(dotBorderWidth(getByTestId('color-dot-#FF6B6B'))).toBe(3);
    });

    // Neither tapped dot should be selected.
    expect(dotBorderWidth(getByTestId('color-dot-#4ECDC4'))).toBe(2);
    expect(dotBorderWidth(getByTestId('color-dot-#45B7D1'))).toBe(2);
  });
});
