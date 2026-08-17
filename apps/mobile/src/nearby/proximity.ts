import { looksLikeHardwareId, nearbyPeerLabel, sanitizeUntrustedLabel, type BlePeer } from '@hop/protocol';

import { createEphemeralDiscoveryId, looksLikeEphemeralDiscoveryLabel, opaquePeerToken } from './ephemeralId';
import type { AroundUsPeer, NearbyIdentity, NearbyPrivacyMode, ProximityBand } from './types';
import { DEFAULT_PEER_STALE_MS } from './types';

const PROXIMITY_RANK: Record<ProximityBand, number> = {
  very_close: 0,
  nearby: 1,
  farther: 2,
};

const MAX_DISPLAY_NAME = 32;

export function rssiToProximity(rssi?: number): ProximityBand {
  if (typeof rssi !== 'number' || !Number.isFinite(rssi)) return 'farther';
  if (rssi >= -60) return 'very_close';
  if (rssi >= -80) return 'nearby';
  return 'farther';
}

export function sanitizePeerDisplayName(value: string): string {
  const name = sanitizeUntrustedLabel(value, MAX_DISPLAY_NAME);
  if (!name || looksLikeHardwareId(name)) return 'HOP user';
  return name;
}

export function avatarInitials(displayName: string): string {
  const name = sanitizePeerDisplayName(displayName);
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
    if (!peer || typeof peer.deviceId !== 'string' || !peer.deviceId) return false;
    if (connectedId && peer.deviceId === connectedId) return true;
    const seen = typeof peer.lastSeenAt === 'number' && Number.isFinite(peer.lastSeenAt) ? peer.lastSeenAt : 0;
    return now - seen <= staleMs;
  });
}

export function dedupePeersByDeviceId(peers: BlePeer[]): BlePeer[] {
  const byId = new Map<string, BlePeer>();
  for (const peer of peers) {
    if (!peer || typeof peer.deviceId !== 'string' || !peer.deviceId) continue;
    const existing = byId.get(peer.deviceId);
    const seen = typeof peer.lastSeenAt === 'number' && Number.isFinite(peer.lastSeenAt) ? peer.lastSeenAt : 0;
    const existingSeen =
      existing && typeof existing.lastSeenAt === 'number' && Number.isFinite(existing.lastSeenAt)
        ? existing.lastSeenAt
        : -1;
    if (!existing || seen >= existingSeen) byId.set(peer.deviceId, peer);
  }
  return [...byId.values()];
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
  if (peer.sessionEstablished && peer.userId) {
    const known = identities.get(peer.userId);
    if (known?.username) {
      const sanitized = sanitizePeerDisplayName(known.username);
      if (sanitized !== 'HOP user') return sanitized;
    }
    const handshakeName = sanitizePeerDisplayName(typeof peer.displayName === 'string' ? peer.displayName : '');
    if (handshakeName !== 'HOP user') return handshakeName;
  }
  return 'HOP user';
}

function advertisedDiscoveryLabel(peer: BlePeer): string {
  const raw = typeof peer.displayName === 'string' ? peer.displayName.trim() : '';
  const fromLabel = nearbyPeerLabel(peer);
  if (looksLikeEphemeralDiscoveryLabel(fromLabel)) return fromLabel;
  if (looksLikeEphemeralDiscoveryLabel(raw)) return raw;
  return '';
}

export function toAroundUsPeer(
  peer: BlePeer,
  connectedId: string | null,
  identities: Map<string, NearbyIdentity>,
): AroundUsPeer {
  const displayName = resolveDisplayName(peer, identities);
  const advertised = advertisedDiscoveryLabel(peer);
  const connected = connectedId === peer.deviceId;
  const encrypted = Boolean(peer.sessionEstablished);
  const lastSeenAt =
    typeof peer.lastSeenAt === 'number' && Number.isFinite(peer.lastSeenAt) ? peer.lastSeenAt : 0;
  return {
    token: opaquePeerToken(peer.deviceId),
    ephemeralId: advertised || opaquePeerToken(peer.deviceId),
    deviceId: peer.deviceId,
    displayName,
    avatarInitials: avatarInitials(displayName),
    userId: encrypted ? peer.userId : undefined,
    publicKey: encrypted ? (peer.publicKey ?? identities.get(peer.userId ?? '')?.publicKey) : undefined,
    proximity: rssiToProximity(peer.rssi),
    rssi: typeof peer.rssi === 'number' && Number.isFinite(peer.rssi) ? peer.rssi : null,
    lastSeenAt,
    discovered: true,
    encrypted,
    connected,
    canMessage: Boolean(encrypted && peer.userId),
  };
}

export function isPeerVisible(
  peer: AroundUsPeer,
  privacyMode: NearbyPrivacyMode,
  selfUserId: string | null,
  contactIds: Set<string>,
  blockedIds: Set<string> = new Set(),
): boolean {
  if (privacyMode === 'invisible') return false;
  if (peer.userId && selfUserId && peer.userId === selfUserId) return false;
  if (peer.userId && blockedIds.has(peer.userId)) return false;
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
  blockedIds?: Set<string>;
}): AroundUsPeer[] {
  const unique = dedupePeersByDeviceId(input.peers);
  const live = pruneStalePeers(unique, input.now, input.staleMs, input.connectedId);
  const mapped = live.map((peer) => toAroundUsPeer(peer, input.connectedId, input.identities));
  const visible = mapped.filter((peer) =>
    isPeerVisible(
      peer,
      input.privacyMode,
      input.selfUserId,
      input.contactIds,
      input.blockedIds ?? new Set(),
    ),
  );
  return sortAroundUsPeers(visible);
}

export function newDiscoveryId(): string {
  return createEphemeralDiscoveryId();
}
