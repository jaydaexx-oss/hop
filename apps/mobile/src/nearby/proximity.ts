import { looksLikeHardwareId, nearbyPeerLabel, type BlePeer } from '@hop/protocol';

import { createEphemeralDiscoveryId, looksLikeEphemeralDiscoveryLabel, opaquePeerToken } from './ephemeralId';
import type { AroundUsPeer, NearbyIdentity, NearbyPrivacyMode, ProximityBand } from './types';
import { DEFAULT_PEER_STALE_MS } from './types';

const PROXIMITY_RANK: Record<ProximityBand, number> = {
  very_close: 0,
  nearby: 1,
  farther: 2,
};

export function rssiToProximity(rssi?: number): ProximityBand {
  if (typeof rssi !== 'number' || !Number.isFinite(rssi)) return 'farther';
  if (rssi >= -60) return 'very_close';
  if (rssi >= -80) return 'nearby';
  return 'farther';
}

export function avatarInitials(displayName: string): string {
  const name = displayName.trim();
  if (!name || name === 'HOP user') return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function pruneStalePeers(
  peers: BlePeer[],
  now: number,
  staleMs = DEFAULT_PEER_STALE_MS,
  connectedId?: string | null,
): BlePeer[] {
  return peers.filter((peer) => {
    if (connectedId && peer.deviceId === connectedId) return true;
    return now - peer.lastSeenAt <= staleMs;
  });
}

export function sortAroundUsPeers(peers: AroundUsPeer[]): AroundUsPeer[] {
  return [...peers].sort((a, b) => {
    const proximity = PROXIMITY_RANK[a.proximity] - PROXIMITY_RANK[b.proximity];
    if (proximity !== 0) return proximity;
    return b.lastSeenAt - a.lastSeenAt;
  });
}

export function resolveDisplayName(
  peer: BlePeer,
  identities: Map<string, NearbyIdentity>,
): string {
  if (peer.userId) {
    const known = identities.get(peer.userId);
    if (known?.username && !looksLikeHardwareId(known.username) && known.username !== 'HOP user') {
      return known.username;
    }
  }
  const label = nearbyPeerLabel(peer);
  if (looksLikeEphemeralDiscoveryLabel(label) || looksLikeHardwareId(label)) return 'HOP user';
  return label;
}

export function toAroundUsPeer(
  peer: BlePeer,
  connectedId: string | null,
  identities: Map<string, NearbyIdentity>,
): AroundUsPeer {
  const displayName = resolveDisplayName(peer, identities);
  const advertised = nearbyPeerLabel(peer);
  const ephemeralId = looksLikeEphemeralDiscoveryLabel(advertised)
    ? advertised
    : opaquePeerToken(peer.deviceId);
  const connected = connectedId === peer.deviceId;
  const encrypted = Boolean(peer.sessionEstablished);
  return {
    token: opaquePeerToken(peer.deviceId),
    ephemeralId,
    deviceId: peer.deviceId,
    displayName,
    avatarInitials: avatarInitials(displayName),
    userId: peer.userId,
    publicKey: peer.publicKey ?? identities.get(peer.userId ?? '')?.publicKey,
    proximity: rssiToProximity(peer.rssi),
    lastSeenAt: peer.lastSeenAt,
    discovered: true,
    encrypted,
    connected,
    canMessage: Boolean(peer.userId && encrypted),
  };
}

export function isPeerVisible(
  peer: AroundUsPeer,
  privacyMode: NearbyPrivacyMode,
  selfUserId: string | null,
  contactIds: Set<string>,
): boolean {
  if (privacyMode === 'invisible') return false;
  if (peer.userId && selfUserId && peer.userId === selfUserId) return false;
  if (privacyMode === 'everyone') return true;
  if (peer.userId && contactIds.has(peer.userId)) return true;
  if (!peer.userId) return true;
  return false;
}

export function projectNearbyPeers(input: {
  peers: BlePeer[];
  connectedId: string | null;
  privacyMode: NearbyPrivacyMode;
  selfUserId: string | null;
  contactIds: Set<string>;
  identities: Map<string, NearbyIdentity>;
  now: number;
  staleMs?: number;
}): AroundUsPeer[] {
  const live = pruneStalePeers(input.peers, input.now, input.staleMs, input.connectedId);
  const mapped = live.map((peer) => toAroundUsPeer(peer, input.connectedId, input.identities));
  const visible = mapped.filter((peer) =>
    isPeerVisible(peer, input.privacyMode, input.selfUserId, input.contactIds),
  );
  return sortAroundUsPeers(visible);
}

export function newDiscoveryId(): string {
  return createEphemeralDiscoveryId();
}
