import { rememberDiscoverableMode } from '@hop/protocol';

import type { NearbyPrivacyMode } from './types';
import type { KvStore } from './types';

const PREFIX = 'hop.nearby.privacy.';
const LAST_ON_PREFIX = 'hop.nearby.lastDiscoverable.';

function parseMode(value: string | null): NearbyPrivacyMode {
  if (value === 'contacts' || value === 'everyone' || value === 'invisible') return value;
  return 'invisible';
}

function parseLastOn(value: string | null): Exclude<NearbyPrivacyMode, 'invisible'> {
  if (value === 'contacts' || value === 'everyone') return value;
  return 'everyone';
}

export async function loadPrivacyMode(store: KvStore, userId: string): Promise<NearbyPrivacyMode> {
  return parseMode(await store.get(`${PREFIX}${userId}`));
}

export async function loadLastDiscoverableMode(
  store: KvStore,
  userId: string,
): Promise<Exclude<NearbyPrivacyMode, 'invisible'>> {
  return parseLastOn(await store.get(`${LAST_ON_PREFIX}${userId}`));
}

export async function savePrivacyMode(
  store: KvStore,
  userId: string,
  mode: NearbyPrivacyMode,
): Promise<void> {
  await store.set(`${PREFIX}${userId}`, mode);
  if (mode === 'contacts' || mode === 'everyone') {
    await store.set(`${LAST_ON_PREFIX}${userId}`, rememberDiscoverableMode(mode, mode));
  }
}

export async function saveLastDiscoverableMode(
  store: KvStore,
  userId: string,
  mode: Exclude<NearbyPrivacyMode, 'invisible'>,
): Promise<void> {
  await store.set(`${LAST_ON_PREFIX}${userId}`, mode);
}
