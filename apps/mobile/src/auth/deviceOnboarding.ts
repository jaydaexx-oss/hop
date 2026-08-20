import {
  IdentityError,
  bindPendingIdentityToUser,
  clearLocalDeviceIdentity,
  loadOrCreateDeviceSecret,
  loadOrCreatePendingIdentity,
  mustNotCreateNewAccount,
  peekDeviceSecret,
  readIdentityOwner,
  shouldSkipOnboarding,
  writeIdentityOwner,
  type IdentityKeyPair,
  type SecretBackend,
} from '@hop/protocol';

import type { AuthResponse, User } from '@/src/api/hop';

export type DeviceOnboardingApi = {
  registerDevice: (username: string, publicKey: string, deviceSecret: string) => Promise<AuthResponse>;
  deviceLogin: (deviceSecret: string) => Promise<AuthResponse>;
};

export const RESET_HOP_TITLE = 'Reset HOP on this device?';
export const RESET_HOP_MESSAGE =
  'This removes the HOP identity, keys, and access stored on THIS phone only. Your account, chats, events, and contacts stay on the server. You cannot take your current handle unless it is released. After reset you will choose a new available handle and create a new device identity.';
export const RESET_HOP_CONFIRM = 'Reset this device';

export type RestoredSession = { token: string | null; user: User };

function isUnauthorized(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 401);
}

export async function reconnectExistingIdentity(
  backend: SecretBackend,
  api: DeviceOnboardingApi,
  cachedUser: User | null,
): Promise<AuthResponse | null> {
  const owner = await readIdentityOwner(backend);
  if (!owner) return null;
  if (mustNotCreateNewAccount(true) && cachedUser && cachedUser.id !== owner) {
    throw new IdentityError(
      'KEY_MISMATCH',
      'Local identity user_id does not match the cached account. HOP will not create a replacement.',
    );
  }
  const deviceSecret = await peekDeviceSecret(backend);
  if (!deviceSecret) return null;
  const result = await api.deviceLogin(deviceSecret);
  if (result.user.id !== owner) {
    throw new IdentityError(
      'KEY_MISMATCH',
      'Device login returned a different user_id. HOP will not adopt it.',
    );
  }
  await writeIdentityOwner(owner, backend);
  return result;
}

/**
 * Restore a valid local device identity without minting keys or showing login UI.
 * Reuses a live session token, or silently POSTs /auth/device with the stored secret.
 */
export async function restoreExistingSession(
  backend: SecretBackend,
  api: DeviceOnboardingApi,
  cachedUser: User | null,
  token: string | null,
  fetchMe: (token: string) => Promise<User>,
): Promise<RestoredSession | null> {
  if (token) {
    try {
      const me = await fetchMe(token);
      await writeIdentityOwner(me.id, backend);
      return { token, user: me };
    } catch (err) {
      if (isUnauthorized(err)) {
        const reconnected = await reconnectExistingIdentity(backend, api, cachedUser).catch(() => null);
        if (reconnected) return reconnected;
        if (cachedUser) return { token: null, user: cachedUser };
        return null;
      }
      if (cachedUser) return { token, user: cachedUser };
      return null;
    }
  }

  const reconnected = await reconnectExistingIdentity(backend, api, cachedUser).catch(() => null);
  if (reconnected) return reconnected;
  const owner = await readIdentityOwner(backend);
  if (cachedUser && owner) return { token: null, user: cachedUser };
  return null;
}

export async function registerDeviceIdentity(
  backend: SecretBackend,
  api: DeviceOnboardingApi,
  username: string,
  generate: () => Promise<IdentityKeyPair>,
): Promise<AuthResponse> {
  const owner = await readIdentityOwner(backend);
  if (owner) {
    throw new IdentityError(
      'IDENTITY_INACCESSIBLE',
      'A local HOP identity already exists on this device. HOP will not create a new account.',
    );
  }
  const identity = await loadOrCreatePendingIdentity(backend, generate);
  const deviceSecret = await loadOrCreateDeviceSecret(backend);
  const result = await api.registerDevice(username, identity.publicKey, deviceSecret);
  const bound = await bindPendingIdentityToUser(result.user.id, backend);
  if (bound.publicKey !== identity.publicKey) {
    throw new IdentityError(
      'KEY_MISMATCH',
      'Bound identity does not match the pending keypair. HOP will not replace local keys.',
    );
  }
  await writeIdentityOwner(result.user.id, backend);
  return result;
}

export async function existingInstallSkipsOnboarding(
  backend: SecretBackend,
  hasSessionUser: boolean,
): Promise<boolean> {
  return shouldSkipOnboarding(backend, hasSessionUser);
}

/** Local SecureStore wipe only. Does not delete the server user row. */
export async function resetLocalHopOnThisDevice(backend: SecretBackend): Promise<void> {
  await clearLocalDeviceIdentity(backend);
}
