import type { NearbyBroadcast } from '@hop/protocol';

import type { KvStore } from '@/src/nearby/types';

const PREFIX = 'hop.broadcast.feed.';

export async function loadBroadcastFeed(store: KvStore, userId: string): Promise<NearbyBroadcast[]> {
  const raw = await store.get(`${PREFIX}${userId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredBroadcast).map((row) => ({ ...row, source: row.source ?? 'local' }));
  } catch {
    return [];
  }
}

export async function saveBroadcastFeed(store: KvStore, userId: string, posts: NearbyBroadcast[]): Promise<void> {
  await store.set(`${PREFIX}${userId}`, JSON.stringify(posts));
}

function isStoredBroadcast(value: unknown): value is NearbyBroadcast {
  if (!value || typeof value !== 'object') return false;
  const row = value as NearbyBroadcast;
  return (
    typeof row.id === 'string' &&
    typeof row.authorId === 'string' &&
    typeof row.displayName === 'string' &&
    typeof row.body === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.expiresAt === 'string' &&
    typeof row.ttlMs === 'number'
  );
}
