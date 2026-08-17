import { rssiSignalBars, rssiPercentForDisplay } from '@hop/protocol';

import type { AroundUsPeer, ProximityBand } from './types';

export const RADAR_RING_RATIOS: Record<ProximityBand, number> = {
  very_close: 0.28,
  nearby: 0.54,
  farther: 0.8,
};

export type RadarNode = {
  token: string;
  displayName: string;
  avatarInitials: string;
  proximity: ProximityBand;
  x: number;
  y: number;
  angle: number;
  /** 0 when RSSI is unknown — never a random bar count. */
  signalBars: 0 | 1 | 2 | 3 | 4;
  rssiKnown: boolean;
};

/** Stable angle from the opaque peer token. Not random RSSI. */
export function tokenAngle(token: string): number {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 33 + token.charCodeAt(i)) >>> 0;
  }
  return ((hash % 360) * Math.PI) / 180;
}

/**
 * Place real NearbyService / projectNearbyPeers rows on the radar.
 * Empty input → empty nodes (nobody nearby, not a demo roster).
 */
export function layoutRadarNodes(peers: AroundUsPeer[], radarSize: number): RadarNode[] {
  if (!peers.length) return [];
  const center = radarSize / 2;
  return peers.map((peer) => {
    const radius = center * RADAR_RING_RATIOS[peer.proximity];
    const angle = tokenAngle(peer.token);
    const rssiKnown = typeof peer.rssi === 'number' && Number.isFinite(peer.rssi);
    return {
      token: peer.token,
      displayName: peer.displayName,
      avatarInitials: peer.avatarInitials,
      proximity: peer.proximity,
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
      angle,
      signalBars: rssiKnown ? rssiSignalBars(peer.rssi ?? undefined) : 0,
      rssiKnown,
    };
  });
}

export function radarInventedRssiPercent(peer: AroundUsPeer): null {
  return rssiPercentForDisplay(peer.rssi);
}
