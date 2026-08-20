import {
  IdentityError,
  bindPendingIdentityToUser,
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
