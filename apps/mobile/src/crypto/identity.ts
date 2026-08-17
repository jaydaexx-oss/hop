import {
  IdentityError,
  assertPublishedIdentityMatches,
  identityPublishBody,
  loadOrCreateIdentity as loadStoredIdentity,
  publishIdentityIfAllowed,
  replaceIdentityExplicit as rotateStoredIdentity,
  type IdentityKeyPair,
  type SecretBackend,
} from '@hop/protocol';

import { readSecret, writeSecret } from '@/src/crypto/secretStore';

const backend: SecretBackend = {
  read: (key) => readSecret(key),
  write: (key, value) => writeSecret(key, value),
};

export { IdentityError, assertPublishedIdentityMatches, identityPublishBody, publishIdentityIfAllowed };
export type { IdentityKeyPair };

export async function loadOrCreateIdentity(userId: string): Promise<IdentityKeyPair> {
  return loadStoredIdentity(userId, backend);
}

/** Explicit user action only. Does not upload the secret key. Server PUT will 409 if a key was already published. */
export async function replaceIdentityExplicit(userId: string): Promise<IdentityKeyPair> {
  return rotateStoredIdentity(userId, backend);
}
