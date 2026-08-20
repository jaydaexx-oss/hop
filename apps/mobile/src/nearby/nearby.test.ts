import { describe, expect, it } from 'vitest';

import { createEphemeralDiscoveryId, looksLikeEphemeralDiscoveryLabel, opaquePeerToken } from './ephemeralId';
import {
  isPeerVisible,
  projectNearbyPeers,
  pruneStalePeers,
  rssiToProximity,
  sortAroundUsPeers,
  toAroundUsPeer,
} from './proximity';
import { deriveScanState } from './scanState';
import { DEFAULT_PEER_STALE_MS } from './types';
import type { AroundUsPeer } from './types';
import { mockBlePeer } from './MockNearbyTransport';

function around(overrides: Partial<AroundUsPeer>): AroundUsPeer {
  return {
    token: 'p1',
    ephemeralId: 'abc12345',
    deviceId: 'hidden-device',
    displayName: 'HOP user',
    avatarInitials: '?',
    proximity: 'nearby',
    rssi: null,
    lastSeenAt: 1_000,
    discovered: true,
    encrypted: false,
    connected: false,
    canMessage: false,
    ...overrides,
  };
}

describe('proximity and sorting', () => {
  it('maps RSSI to Very Close / Nearby / Farther Away without meters', () => {
    expect(rssiToProximity(-40)).toBe('very_close');
    expect(rssiToProximity(-60)).toBe('very_close');
    expect(rssiToProximity(-72)).toBe('nearby');
    expect(rssiToProximity(-80)).toBe('nearby');
    expect(rssiToProximity(-95)).toBe('farther');
    expect(rssiToProximity(undefined)).toBe('farther');
  });

  it('sorts by proximity then freshness', () => {
    const sorted = sortAroundUsPeers([
      around({ token: 'far-old', proximity: 'farther', lastSeenAt: 50 }),
      around({ token: 'close-old', proximity: 'very_close', lastSeenAt: 10 }),
      around({ token: 'close-new', proximity: 'very_close', lastSeenAt: 90 }),
      around({ token: 'near', proximity: 'nearby', lastSeenAt: 80 }),
    ]);
    expect(sorted.map((p) => p.token)).toEqual(['close-new', 'close-old', 'near', 'far-old']);
  });

  it('removes stale peers and keeps a connected peer', () => {
    const now = 100_000;
    const live = pruneStalePeers(
      [
        mockBlePeer({ deviceId: 'stale', lastSeenAt: now - DEFAULT_PEER_STALE_MS - 1 }),
        mockBlePeer({ deviceId: 'fresh', lastSeenAt: now - 1_000 }),
        mockBlePeer({ deviceId: 'hooked', lastSeenAt: now - DEFAULT_PEER_STALE_MS - 5_000 }),
      ],
      now,
      DEFAULT_PEER_STALE_MS,
      'hooked',
    );
    expect(live.map((p) => p.deviceId)).toEqual(['fresh', 'hooked']);
  });
});

describe('privacy modes', () => {
  it('hides everyone while Invisible', () => {
    expect(
      isPeerVisible(around({ userId: 'a' }), 'invisible', 'me', new Set(['a'])),
    ).toBe(false);
  });

  it('shows unidentified and contact peers in Contacts only, hides other identified people', () => {
    const contacts = new Set(['friend']);
    expect(isPeerVisible(around({ userId: 'friend' }), 'contacts', 'me', contacts)).toBe(true);
    expect(isPeerVisible(around({ userId: undefined }), 'contacts', 'me', contacts)).toBe(true);
    expect(isPeerVisible(around({ userId: 'stranger' }), 'contacts', 'me', contacts)).toBe(false);
  });

  it('shows everyone nearby except self', () => {
    expect(isPeerVisible(around({ userId: 'stranger' }), 'everyone', 'me', new Set())).toBe(true);
    expect(isPeerVisible(around({ userId: 'me' }), 'everyone', 'me', new Set())).toBe(false);
  });

  it('hides blocked peers even when Discoverable is on', () => {
    expect(
      isPeerVisible(around({ userId: 'blocked' }), 'everyone', 'me', new Set(), new Set(['blocked'])),
    ).toBe(false);
    expect(
      isPeerVisible(around({ userId: 'ok' }), 'everyone', 'me', new Set(), new Set(['blocked'])),
    ).toBe(true);
  });
});

describe('mocked discovery', () => {
  it('never uses a MAC or OS UUID as the display name', () => {
    const identities = new Map();
    const mac = toAroundUsPeer(
      mockBlePeer({
        deviceId: 'AA:BB:CC:DD:EE:FF',
        displayName: 'AA:BB:CC:DD:EE:FF',
        rssi: -50,
        lastSeenAt: Date.now(),
      }),
      null,
      identities,
    );
    expect(mac.displayName).toBe('HOP user');
    expect(mac.displayName).not.toContain(':');
    expect(mac.avatarInitials).toBe('?');
    expect(mac.proximity).toBe('very_close');
    expect(mac.token.startsWith('p')).toBe(true);
  });

  it('projects mocked peers with identity after handshake and drops stale rows', () => {
    const now = 50_000;
    const identities = new Map([['blake-id', { username: 'blake', publicKey: 'pk' }]]);
    const peers = projectNearbyPeers({
      peers: [
        mockBlePeer({
          deviceId: 'dev-1',
          displayName: 'k7m2p9qx',
          userId: 'blake-id',
          publicKey: 'pk',
          sessionEstablished: true,
          rssi: -45,
          lastSeenAt: now,
        }),
        mockBlePeer({
          deviceId: 'dev-stale',
          displayName: 'ghost',
          rssi: -40,
          lastSeenAt: 0,
        }),
      ],
      connectedId: null,
      privacyMode: 'everyone',
      selfUserId: 'me',
      contactIds: new Set(),
      identities,
      now,
    });
    expect(peers).toHaveLength(1);
    expect(peers[0].displayName).toBe('blake');
    expect(peers[0].encrypted).toBe(true);
    expect(peers[0].canMessage).toBe(true);
    expect(peers[0].ephemeralId).toBe('k7m2p9qx');
  });

  it('creates rotating discovery ids that are not UUIDs', () => {
    const id = createEphemeralDiscoveryId();
    expect(id).toHaveLength(8);
    expect(looksLikeEphemeralDiscoveryLabel(id)).toBe(true);
    expect(id).not.toMatch(/-/);
    expect(opaquePeerToken('AA:BB:CC:DD:EE:FF')).not.toContain(':');
  });
});

describe('scan states', () => {
  const status = {
    implemented: true,
    bluetoothOn: true,
    permissionGranted: true,
    advertising: true,
    scanning: true,
    advertisingSupported: true,
    detail: 'ok',
  };

  it('reports Bluetooth off, permission needed, searching, empty, and found', () => {
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status: { ...status, bluetoothOn: false },
        sessionActive: true,
        peerCount: 0,
        connectionError: null,
        now: 20_000,
        sessionStartedAt: 19_000,
      }),
    ).toBe('bluetooth_off');
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status: { ...status, bluetoothOn: false, permissionGranted: false },
        sessionActive: true,
        peerCount: 0,
        connectionError: null,
        now: 20_000,
        sessionStartedAt: 19_000,
      }),
    ).toBe('permission_needed');
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status: {
          ...status,
          bluetoothOn: false,
          permissionGranted: false,
          adapterState: 'unauthorized',
          authorization: 'notDetermined',
        },
        sessionActive: true,
        peerCount: 0,
        connectionError: null,
        now: 20_000,
        sessionStartedAt: 19_000,
      }),
    ).toBe('permission_needed');
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status: {
          ...status,
          bluetoothOn: false,
          permissionGranted: true,
          adapterState: 'poweredOff',
          authorization: 'allowedAlways',
        },
        sessionActive: true,
        peerCount: 0,
        connectionError: null,
        now: 20_000,
        sessionStartedAt: 19_000,
      }),
    ).toBe('bluetooth_off');
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status: {
          ...status,
          adapterState: 'unknown',
          authorization: 'unknown',
        },
        sessionActive: true,
        peerCount: 0,
        connectionError: null,
        now: 20_000,
        sessionStartedAt: 19_000,
      }),
    ).toBe('searching');
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status: { ...status, implemented: false, nativeProbed: false, bluetoothOn: false, permissionGranted: false },
        sessionActive: true,
        peerCount: 0,
        connectionError: null,
        now: 20_000,
        sessionStartedAt: 19_000,
      }),
    ).toBe('permission_needed');
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status,
        sessionActive: true,
        peerCount: 0,
        connectionError: null,
        now: 20_000,
        sessionStartedAt: 19_000,
      }),
    ).toBe('searching');
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status: { ...status, scanning: false },
        sessionActive: true,
        peerCount: 0,
        connectionError: null,
        now: 40_000,
        sessionStartedAt: 10_000,
      }),
    ).toBe('nobody_nearby');
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status,
        sessionActive: true,
        peerCount: 2,
        connectionError: null,
        now: 20_000,
        sessionStartedAt: 10_000,
      }),
    ).toBe('peers_found');
    expect(
      deriveScanState({
        privacyMode: 'everyone',
        status,
        sessionActive: true,
        peerCount: 0,
        connectionError: 'Connect timed out',
        now: 20_000,
        sessionStartedAt: 10_000,
      }),
    ).toBe('connection_failure');
  });

  it('stays Invisible even when Bluetooth is on and peers exist', () => {
    expect(
      deriveScanState({
        privacyMode: 'invisible',
        status,
        sessionActive: true,
        peerCount: 4,
        connectionError: null,
        now: 20_000,
        sessionStartedAt: 10_000,
      }),
    ).toBe('invisible');
  });
});
