import { LOCAL_AVATAR_COLORS } from '@hop/protocol';

import type { KvStore } from '@/src/nearby/types';

const PREFIX = 'hop.profile.avatarColor.';

export { LOCAL_AVATAR_COLORS };

export function defaultLocalAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return LOCAL_AVATAR_COLORS[hash % LOCAL_AVATAR_COLORS.length]!;
}

export function isLocalAvatarColor(value: string): boolean {
  return (LOCAL_AVATAR_COLORS as readonly string[]).includes(value);
}

export async function loadLocalAvatarColor(store: KvStore, userId: string): Promise<string> {
  const raw = await store.get(`${PREFIX}${userId}`);
  if (raw && isLocalAvatarColor(raw)) return raw;
  return defaultLocalAvatarColor(userId || 'hop');
}

export async function saveLocalAvatarColor(store: KvStore, userId: string, color: string): Promise<void> {
  if (!isLocalAvatarColor(color)) return;
  await store.set(`${PREFIX}${userId}`, color);
}
