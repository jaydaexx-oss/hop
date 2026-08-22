import { describe, expect, it } from 'vitest';
import {
  createNearbyBroadcast,
  isNearbyBroadcastExpired,
  pruneExpiredBroadcasts,
} from '@hop/protocol';

import { MemoryKvStore } from '@/src/nearby/kvStore';

import {
  applyBroadcastDiscovery,
  applyPersistedBroadcasts,
  applyServerBroadcastAck,
  discoveryErrorKeepsLocalFeed,
} from './broadcastFeedSync';
import { loadBroadcastFeed, saveBroadcastFeed } from './broadcastStore';

const NOW = new Date('2026-08-21T22:00:00.000Z');
const CTX = { selfId: 'maya', blockedIds: [] as string[], now: NOW.getTime() };

function sent(overrides: Partial<Parameters<typeof createNearbyBroadcast>[0]> = {}) {
  return createNearbyBroadcast({
    authorId: 'maya',
    displayName: 'maya',
    body: 'Coffee on the patio',
    now: NOW,
    id: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  });
}

describe('broadcast feed persistence', () => {
  it('keeps a sent post after an empty discovery fetch', () => {
    const local = [sent()];
    expect(applyBroadcastDiscovery(local, [], CTX)).toEqual(local);
  });

  it('merges local sent + received and dedupes by broadcastId', () => {
    const mine = sent();
    const peer = createNearbyBroadcast({
      authorId: 'blake',
      displayName: 'blake',
      body: 'Anyone here?',
      now: NOW,
      id: '22222222-2222-4222-8222-222222222222',
      source: 'bluetooth',
    });
    const duplicate = { ...peer, source: 'internet' as const, body: 'Anyone here?' };
    const merged = applyBroadcastDiscovery([mine, peer], [duplicate, mine], CTX);
    expect(merged.map((row) => row.id)).toEqual([mine.id, peer.id]);
  });

  it('still removes TTL-expired posts', () => {
    const live = sent({ ttlMs: 60_000 });
    const expired = sent({
      id: '33333333-3333-4333-8333-333333333333',
      body: 'old',
      now: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
    });
    expect(isNearbyBroadcastExpired(expired, NOW.getTime())).toBe(true);
    expect(applyBroadcastDiscovery([live, expired], [], CTX)).toEqual([live]);
    expect(pruneExpiredBroadcasts([live, expired], NOW.getTime())).toEqual([live]);
  });

  it('focus/refetch with [] keeps locally sent posts', async () => {
    const store = new MemoryKvStore();
    const mine = sent();
    await saveBroadcastFeed(store, 'maya', [mine]);
    const stored = await loadBroadcastFeed(store, 'maya');
    const afterSend = applyPersistedBroadcasts([mine], stored, CTX);
    const afterFocus = applyBroadcastDiscovery(afterSend, [], CTX);
    expect(afterFocus.map((row) => row.id)).toEqual([mine.id]);
  });

  it('replaces an optimistic id with the server id without duplicating', () => {
    const optimistic = sent({ id: '44444444-4444-4444-8444-444444444444' });
    const server = createNearbyBroadcast({
      authorId: 'maya',
      displayName: 'maya',
      body: optimistic.body,
      now: new Date('2026-08-21T22:00:01.000Z'),
      id: '55555555-5555-4555-8555-555555555555',
      source: 'internet',
    });
    const next = applyServerBroadcastAck([optimistic], optimistic.id, server, CTX);
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe(server.id);
    expect(next[0]?.createdAt).toBe(server.createdAt);
    expect(next.map((row) => row.id)).not.toContain(optimistic.id);
  });

  it('does not wipe local cache on GET 404 / network errors', () => {
    expect(discoveryErrorKeepsLocalFeed(404)).toBe(true);
    expect(discoveryErrorKeepsLocalFeed(0)).toBe(true);
    expect(discoveryErrorKeepsLocalFeed(503)).toBe(true);
    const local = [sent()];
    expect(applyBroadcastDiscovery(local, null, CTX)).toEqual(local);
    expect(applyBroadcastDiscovery(local, undefined, CTX)).toEqual(local);
  });

  it('stale empty disk read does not overwrite a just-sent in-memory post', () => {
    const mine = sent();
    expect(applyPersistedBroadcasts([mine], [], CTX)).toEqual([mine]);
  });
});
