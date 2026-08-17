import { describe, expect, it } from 'vitest';
import { rssiSignalBars } from '@hop/protocol';

import { NearbyService } from './NearbyService';
import { MockNearbyTransport, mockBlePeer } from './MockNearbyTransport';
import { layoutRadarNodes, radarInventedRssiPercent } from './radarLayout';
import { projectNearbyPeers, toAroundUsPeer } from './proximity';

describe('radar uses real NearbyService peers only', () => {
  it('is empty when nobody is nearby — not a demo roster', () => {
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => 20_000);
    service.setPrivacyMode('everyone');
    service.setSessionActive(true, 20_000);
    expect(service.listPeers()).toEqual([]);
    expect(layoutRadarNodes(service.listPeers(), 320)).toEqual([]);
    expect(layoutRadarNodes(projectNearbyPeers({
      peers: [],
      connectedId: null,
      privacyMode: 'everyone',
      selfUserId: 'me',
      contactIds: new Set(),
      identities: new Map(),
      now: 20_000,
    }), 320)).toEqual([]);
  });

  it('places only projected peers and never invents RSSI percent', () => {
    const now = 20_000;
    const identities = new Map([['blake-id', { username: 'blake' }]]);
    const peers = projectNearbyPeers({
      peers: [
        mockBlePeer({
          deviceId: 'dev-1',
          displayName: 'blake',
          userId: 'blake-id',
          sessionEstablished: true,
          rssi: -48,
          lastSeenAt: now,
        }),
        mockBlePeer({
          deviceId: 'dev-unknown',
          displayName: 'k7m2p9qx',
          lastSeenAt: now,
        }),
      ],
      connectedId: null,
      privacyMode: 'everyone',
      selfUserId: 'me',
      contactIds: new Set(),
      identities,
      now,
    });
    expect(peers).toHaveLength(2);
    const nodes = layoutRadarNodes(peers, 320);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.token).sort()).toEqual(peers.map((p) => p.token).sort());
    const known = peers.find((p) => p.rssi === -48)!;
    const unknown = peers.find((p) => p.rssi === null)!;
    expect(radarInventedRssiPercent(known)).toBeNull();
    expect(radarInventedRssiPercent(unknown)).toBeNull();
    const knownNode = nodes.find((n) => n.token === known.token)!;
    const unknownNode = nodes.find((n) => n.token === unknown.token)!;
    expect(knownNode.rssiKnown).toBe(true);
    expect(knownNode.signalBars).toBe(rssiSignalBars(-48));
    expect(unknownNode.rssiKnown).toBe(false);
    expect(unknownNode.signalBars).toBe(0);
  });

  it('passes through real RSSI and leaves unknown as null', () => {
    const withRssi = toAroundUsPeer(
      mockBlePeer({ deviceId: 'a', rssi: -72, lastSeenAt: Date.now() }),
      null,
      new Map(),
    );
    const missing = toAroundUsPeer(
      mockBlePeer({ deviceId: 'b', lastSeenAt: Date.now() }),
      null,
      new Map(),
    );
    expect(withRssi.rssi).toBe(-72);
    expect(missing.rssi).toBeNull();
  });
});
