import {
  IdentityError,
  bindPendingIdentityToUser,
  eraseLocalIdentity as wipeLocalIdentitySecrets,
  hashedInstallHeaderValue,
  loadOrCreateDeviceSecret,
  loadOrCreatePendingIdentity,
  mustNotCreateNewAccount,
  peekDeviceSecret,
  readIdentityOwner,
  recoverExistingIdentity,
  resetAppSession as discardUnpublishedPendingIdentity,
  sanitizeHandleHint,
  shouldSkipOnboarding,
  writeHandleHint,
  writeIdentityOwner,
  type IdentityKeyPair,
  type NonSecretStore,
  type RecoveryProof,
  type SecretBackend,
} from '@hop/protocol';

type AuthUser = {
  id: string;
  username: string;
  created_at: string;
  identity_public_key?: string;
};
type AuthResponse = { token: string; user: AuthUser };
type RecoveryAuthResponse = AuthResponse & { needs_passkey_enrollment?: boolean };

export type DeviceOnboardingApi = {
  registerDevice: (
    username: string,
    publicKey: string,
    deviceSecret: string,
    installHeader?: string,
  ) => Promise<AuthResponse>;
  deviceLogin: (deviceSecret: string) => Promise<AuthResponse>;
};

export type RecoveryOnboardingApi = {
  recoverPassword: (username: string, password: string) => Promise<RecoveryAuthResponse>;
  passkeyAuthenticate: (username: string) => Promise<RecoveryAuthResponse>;
  bindRecoveredDevice: (token: string, deviceSecret: string) => Promise<AuthResponse>;
  logout: (token: string) => Promise<unknown>;
  getIdentityWrap: (token: string) => Promise<{ wrapped_blob: string }>;
  putIdentityWrap: (token: string, wrappedBlob: string) => Promise<unknown>;
};

export const RESET_HOP_TITLE = 'Reset HOP app?';
export const RESET_HOP_MESSAGE =
  'This clears the signed-in session and cached app data on this phone. It does not mint a new identity or a new account. Your HOP keys stay on this iPhone so it can restore the same account automatically. Blocks and reports stay on the server. This is not logout that creates a replacement identity.';
export const RESET_HOP_CONFIRM = 'Reset HOP app';

export const ERASE_IDENTITY_TITLE = 'Erase HOP identity from this device?';
export const ERASE_IDENTITY_MESSAGE =
  'This permanently deletes the HOP keys stored on THIS phone. Encrypted history may be unrecoverable without a recovery backup or passkey on a device that still has the original keys. Your account, chats, events, contacts, blocks, and reports stay on the server. You cannot take this handle unless it is released. This is not a normal reset.';
export const ERASE_IDENTITY_CONTINUE = 'Continue';
export const ERASE_IDENTITY_TITLE_2 = 'Really erase this identity?';
export const ERASE_IDENTITY_MESSAGE_2 =
  'This iPhone will not be able to prove ownership of this account unless you restore an encrypted backup from before this erase. A remembered handle can still help Recover from another device, but the keys on this phone will be gone.';
export const ERASE_IDENTITY_CONFIRM = 'Erase identity';

export type RestoredSession = { token: string | null; user: AuthUser };

function isUnauthorized(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 401);
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 404);
}

export async function reconnectExistingIdentity(
  backend: SecretBackend,
  api: DeviceOnboardingApi,
  cachedUser: AuthUser | null,
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
  cachedUser: AuthUser | null,
  token: string | null,
  fetchMe: (token: string) => Promise<AuthUser>,
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
  const installHeader = await hashedInstallHeaderValue(backend);
  const result = await api.registerDevice(username, identity.publicKey, deviceSecret, installHeader);
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

export async function recoverHopAccount(
  backend: SecretBackend,
  api: RecoveryOnboardingApi,
  username: string,
  proof: RecoveryProof,
): Promise<AuthResponse> {
  return recoverExistingIdentity(
    backend,
    {
      recoverPassword: (handle, password) => api.recoverPassword(handle, password),
      passkeyAuthenticate: (handle) => api.passkeyAuthenticate(handle),
      bindDevice: (token, deviceSecret) => api.bindRecoveredDevice(token, deviceSecret),
      logout: async (token) => {
        await api.logout(token);
      },
      getIdentityWrap: async (token) => {
        try {
          const wrap = await api.getIdentityWrap(token);
          return wrap.wrapped_blob;
        } catch (err) {
          if (isNotFound(err)) return null;
          return null;
        }
      },
      putIdentityWrap: async (token, blob) => {
        await api.putIdentityWrap(token, blob);
      },
    },
    username,
    proof,
  );
}

export async function existingInstallSkipsOnboarding(
  backend: SecretBackend,
  hasSessionUser: boolean,
): Promise<boolean> {
  return shouldSkipOnboarding(backend, hasSessionUser);
}

async function rememberHandleHint(
  hint?: { store: NonSecretStore; lastHandle?: string | null },
): Promise<void> {
  if (!hint?.store) return;
  const handle = sanitizeHandleHint(hint.lastHandle ?? null);
  if (handle) await writeHandleHint(hint.store, handle);
}

/**
 * Normal Reset HOP app. Clears unpublished pending leftovers only.
 * Preserves hop.box.{userId}, marker, wrap, hop.identity.userId, hop.device.secret,
 * and hop.install.id. Does not call register-device. Does not delete the server user.
 * Copies the last-used handle into non-secret storage first. That hint is not
 * authentication and never restores identity keys.
 */
export async function resetAppSession(
  backend: SecretBackend,
  hint?: { store: NonSecretStore; lastHandle?: string | null },
): Promise<void> {
  await rememberHandleHint(hint);
  await discardUnpublishedPendingIdentity(backend);
}

/**
 * Permanent identity erase on this device. SecureStore wipe of keys and device_secret.
 * Does not delete the server user row, chats, events, contacts, or blocks.
 * Copies the last-used handle into non-secret storage first. That hint is not
 * authentication and never restores identity keys.
 */
export async function eraseLocalIdentity(
  backend: SecretBackend,
  hint?: { store: NonSecretStore; lastHandle?: string | null },
): Promise<void> {
  await rememberHandleHint(hint);
  await wipeLocalIdentitySecrets(backend);
}
