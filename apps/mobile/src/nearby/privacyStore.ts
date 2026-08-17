import type { NearbyPrivacyMode } from './types';
import type { KvStore } from './types';

const PREFIX = 'hop.nearby.privacy.';

function parseMode(value: string | null): NearbyPrivacyMode {
  if (value === 'contacts' || value === 'everyone' || value === 'invisible') return value;
  return 'invisible';
}

export async function loadPrivacyMode(store: KvStore, userId: string): Promise<NearbyPrivacyMode> {
  return parseMode(await store.get(`${PREFIX}${userId}`));
}

export async function savePrivacyMode(
  store: KvStore,
  userId: string,
  mode: NearbyPrivacyMode,
): Promise<void> {
  await store.set(`${PREFIX}${userId}`, mode);
}
