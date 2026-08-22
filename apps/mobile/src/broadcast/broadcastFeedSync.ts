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
 * Apply a discovery/GET payload. An empty or missing list is not authoritative —
 * locally sent and received posts stay unless they are expired.
 */
export function applyBroadcastDiscovery(
  local: NearbyBroadcast[],
  discovered: NearbyBroadcast[] | null | undefined,
  ctx: BroadcastFeedCtx,
): NearbyBroadcast[] {
  return mergeBroadcastFeed(local, discovered ?? [], ctx);
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
