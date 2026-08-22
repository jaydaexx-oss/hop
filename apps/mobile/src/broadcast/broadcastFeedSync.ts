import {
  adoptServerBroadcast,
  mergeBroadcastFeed,
  type NearbyBroadcast,
} from '@hop/protocol';

export type BroadcastFeedCtx = {
  selfId: string | null;
  blockedIds: Iterable<string>;
  now?: number;
};

/**
 * Keep a post that GET omitted. Empty GET is not "delete everything":
 * local authored (pending) and BLE-only received posts stay.
 * Internet-sourced posts (previously returned by GET, including the author's
 * own acked copies) are dropped so another device's delete can sync.
 */
export function keepWhenMissingFromDiscovery(
  post: NearbyBroadcast,
  selfId: string | null,
): boolean {
  if (post.source === 'internet') return false;
  if (selfId && post.authorId === selfId) return true;
  return post.source === 'bluetooth' || post.source === 'local';
}

/**
 * Apply a discovery/GET payload. An empty list does not wipe local authored
 * posts. Received internet posts missing from GET are dropped.
 */
export function applyBroadcastDiscovery(
  local: NearbyBroadcast[],
  discovered: NearbyBroadcast[] | null | undefined,
  ctx: BroadcastFeedCtx,
): NearbyBroadcast[] {
  const incoming = discovered ?? [];
  const incomingIds = new Set(incoming.map((row) => row.id));
  const retained = local.filter((post) => incomingIds.has(post.id) || keepWhenMissingFromDiscovery(post, ctx.selfId));
  return mergeBroadcastFeed(retained, incoming, ctx);
}

export function removeBroadcastFromFeed(local: NearbyBroadcast[], id: string): NearbyBroadcast[] {
  return local.filter((post) => post.id !== id);
}

export function restoreBroadcastFeedAfterFailedDelete(
  current: NearbyBroadcast[],
  snapshot: NearbyBroadcast[],
  ctx: BroadcastFeedCtx,
): NearbyBroadcast[] {
  return mergeBroadcastFeed(current, snapshot, ctx);
}

/** Hydrate from disk without clobbering in-memory posts sent since the read started. */
export function applyPersistedBroadcasts(
  inMemory: NearbyBroadcast[],
  stored: NearbyBroadcast[],
  ctx: BroadcastFeedCtx,
): NearbyBroadcast[] {
  return mergeBroadcastFeed(inMemory, stored, ctx);
}

export function applyServerBroadcastAck(
  local: NearbyBroadcast[],
  optimisticId: string,
  server: NearbyBroadcast,
  ctx: BroadcastFeedCtx,
): NearbyBroadcast[] {
  return adoptServerBroadcast(local, optimisticId, server, ctx);
}

/** 404 (migration missing), network, and 5xx must not be treated as an empty feed. */
export function discoveryErrorKeepsLocalFeed(status?: number): boolean {
  return status === undefined || status === 0 || status === 404 || status >= 500;
}
