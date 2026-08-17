import { describe, expect, it } from 'vitest';

import { NearbyService } from './NearbyService';
import { MockNearbyTransport, mockBlePeer } from './MockNearbyTransport';
import { discoveryProfileFor, isEventModeAllowed, shouldRunNearbyDiscovery } from './nearbyPolicy';
import { projectNearbyPeers, toAroundUsPeer } from './proximity';
import { SEARCHING_GRACE_MS } from './types';

const SESSION = {
  userId: '11111111-2222-3333-4444-555555555555',
  username: 'jaydae',
  scanMode: 'balanced' as const,
  identityPublicKey: 'pk',
  discoveryId: 'k7m2p9qx',
};

describe('nearby policy', () => {
  it('never lets Event Mode override Invisible', () => {
    expect(isEventModeAllowed('invisible')).toBe(false);
    expect(discoveryProfileFor('invisible', true)).toBe('standard');
    expect(discoveryProfileFor('everyone', true)).toBe('event');
    expect(discoveryProfileFor('contacts', false)).toBe('standard');
  });

  it('stops discovery when Bluetooth is off, permission is revoked, or the app is backgrounded', () => {
    expect(
      shouldRunNearbyDiscovery({
        privacyMode: 'everyone',
        appActive: true,
        bluetoothOn: true,
        permissionGranted: true,
      }),
    ).toBe(true);
    expect(
      shouldRunNearbyDiscovery({
        privacyMode: 'invisible',
        appActive: true,
        bluetoothOn: true,
        permissionGranted: true,
      }),
    ).toBe(false);
    expect(
      shouldRunNearbyDiscovery({
        privacyMode: 'everyone',
        appActive: false,
        bluetoothOn: true,
        permissionGranted: true,
      }),
    ).toBe(false);
    expect(
      shouldRunNearbyDiscovery({
        privacyMode: 'everyone',
        appActive: true,
        bluetoothOn: false,
        permissionGranted: true,
      }),
    ).toBe(false);
    expect(
      shouldRunNearbyDiscovery({
        privacyMode: 'contacts',
        appActive: true,
        bluetoothOn: true,
        permissionGranted: false,
      }),
    ).toBe(false);
  });
});

describe('adversarial discovery', () => {
  it('dedupes duplicate peer advertisements by device id, keeping the freshest RSSI', () => {
    const now = 80_000;
    const peers = projectNearbyPeers({
      peers: [
        mockBlePeer({ deviceId: 'dev-1', displayName: 'k7m2p9qx', rssi: -90, lastSeenAt: now - 200 }),
        mockBlePeer({ deviceId: 'dev-1', displayName: 'k7m2p9qx', rssi: -42, lastSeenAt: now }),
        mockBlePeer({ deviceId: 'dev-1', displayName: 'k7m2p9qx', rssi: -70, lastSeenAt: now - 50 }),
      ],
      connectedId: null,
      privacyMode: 'everyone',
      selfUserId: 'me',
      contactIds: new Set(),
      identities: new Map(),
      now,
    });
    expect(peers).toHaveLength(1);
    expect(peers[0].proximity).toBe('very_close');
    expect(peers[0].displayName).toBe('HOP user');
  });

  it('maps rapidly changing RSSI to the latest proximity band', () => {
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => 10_000);
    service.setPrivacyMode('everyone');
    service.setSessionActive(true, 10_000);
    transport.setPeers([mockBlePeer({ deviceId: 'dev-1', rssi: -40, lastSeenAt: 10_000 })]);
    expect(service.listPeers()[0].proximity).toBe('very_close');
    transport.setPeers([mockBlePeer({ deviceId: 'dev-1', rssi: -72, lastSeenAt: 10_000 })]);
    expect(service.listPeers()[0].proximity).toBe('nearby');
    transport.setPeers([mockBlePeer({ deviceId: 'dev-1', rssi: -95, lastSeenAt: 10_000 })]);
    expect(service.listPeers()[0].proximity).toBe('farther');
    transport.setPeers([mockBlePeer({ deviceId: 'dev-1', rssi: Number.NaN, lastSeenAt: 10_000 })]);
    expect(service.listPeers()[0].proximity).toBe('farther');
  });

  it('does not crash on malformed advertisements', () => {
    const now = 20_000;
    const malformed = [
      mockBlePeer({
        deviceId: 'ok',
        displayName: `HOP:${'x'.repeat(5000)}\u0000<script>alert(1)</script>`,
        rssi: Number.POSITIVE_INFINITY,
        lastSeenAt: now,
      }),
      { displayName: 12, rssi: 'hot', lastSeenAt: 'now' } as never,
      mockBlePeer({ deviceId: '', displayName: 'ghost', lastSeenAt: now }),
      mockBlePeer({
        deviceId: 'AA:BB:CC:DD:EE:FF',
        displayName: 'AA:BB:CC:DD:EE:FF',
        lastSeenAt: now,
      }),
    ];
    expect(() =>
      projectNearbyPeers({
        peers: malformed,
        connectedId: null,
        privacyMode: 'everyone',
        selfUserId: 'me',
        contactIds: new Set(),
        identities: new Map(),
        now,
      }),
    ).not.toThrow();
    const peers = projectNearbyPeers({
      peers: malformed,
      connectedId: null,
      privacyMode: 'everyone',
      selfUserId: 'me',
      contactIds: new Set(),
      identities: new Map(),
      now,
    });
    expect(peers.every((peer) => peer.displayName === 'HOP user')).toBe(true);
    expect(peers.every((peer) => !peer.displayName.includes('<'))).toBe(true);
    expect(peers.every((peer) => peer.displayName.length <= 32)).toBe(true);
    expect(peers.some((peer) => peer.deviceId === 'AA:BB:CC:DD:EE:FF')).toBe(true);
    expect(peers.every((peer) => !peer.displayName.includes(':'))).toBe(true);
  });

  it('hides advertised names until handshake and does not restore identity from a replayed discovery id', () => {
    const identities = new Map([['blake-id', { username: 'blake' }]]);
    const advertised = toAroundUsPeer(
      mockBlePeer({
        deviceId: 'dev-1',
        displayName: 'blake',
        userId: 'blake-id',
        lastSeenAt: 10_000,
      }),
      null,
      identities,
    );
    expect(advertised.displayName).toBe('HOP user');
    expect(advertised.userId).toBeUndefined();
    expect(advertised.canMessage).toBe(false);

    const replayed = toAroundUsPeer(
      mockBlePeer({
        deviceId: 'other-radio',
        displayName: 'k7m2p9qx',
        userId: 'blake-id',
        lastSeenAt: 10_000,
      }),
      null,
      identities,
    );
    expect(replayed.displayName).toBe('HOP user');
    expect(replayed.userId).toBeUndefined();
  });

  it('shows a handshake name, then HOP user after the peer disappears and returns without a session', () => {
    let now = 50_000;
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => now);
    service.setPrivacyMode('everyone');
    service.setSessionActive(true, now);
    transport.setPeers([
      mockBlePeer({
        deviceId: 'dev-1',
        displayName: 'blake',
        userId: 'blake-id',
        sessionEstablished: true,
        rssi: -50,
        lastSeenAt: now,
      }),
    ]);
    expect(service.listPeers()[0].displayName).toBe('blake');

    now += 30_000;
    expect(service.listPeers()).toEqual([]);

    now += 1_000;
    transport.setPeers([
      mockBlePeer({
        deviceId: 'dev-1',
        displayName: 'k7m2p9qx',
        rssi: -50,
        lastSeenAt: now,
      }),
    ]);
    const returned = service.listPeers()[0];
    expect(returned.displayName).toBe('HOP user');
    expect(returned.userId).toBeUndefined();
    expect(returned.encrypted).toBe(false);
  });

  it('projects 100 mocked nearby peers without dropping uniqueness or sort order', () => {
    const now = 90_000;
    const crowd = Array.from({ length: 100 }, (_, i) =>
      mockBlePeer({
        deviceId: `dev-${i}`,
        displayName: `p${String(i).padStart(7, '0')}`.slice(0, 8),
        rssi: i < 10 ? -40 : i < 40 ? -70 : -95,
        lastSeenAt: now - i,
      }),
    );
    const peers = projectNearbyPeers({
      peers: crowd,
      connectedId: null,
      privacyMode: 'everyone',
      selfUserId: 'me',
      contactIds: new Set(),
      identities: new Map(),
      now,
    });
    expect(peers).toHaveLength(100);
    expect(new Set(peers.map((peer) => peer.token)).size).toBe(100);
    expect(peers.slice(0, 10).every((peer) => peer.proximity === 'very_close')).toBe(true);
    expect(peers[0].lastSeenAt).toBeGreaterThanOrEqual(peers[9].lastSeenAt);
    expect(peers[99].proximity).toBe('farther');
  });

  it('does not reset the searching grace window on repeated projections', () => {
    const transport = new MockNearbyTransport();
    let now = 10_000;
    const service = new NearbyService(transport, () => now);
    service.setPrivacyMode('everyone');
    service.setSessionActive(true);
    transport.currentStatus = { ...transport.currentStatus, scanning: false, advertising: true };
    expect(service.scanState()).toBe('searching');
    now = 10_000 + SEARCHING_GRACE_MS + 1;
    service.setSessionActive(true);
    expect(service.scanState()).toBe('nobody_nearby');
  });
});

describe('BLE lifecycle with mocked transport', () => {
  it('stops advertising and scanning when Invisible is selected while a session is running', async () => {
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => 20_000);
    service.setPrivacyMode('everyone');
    await transport.startSession(SESSION);
    transport.setPeers([mockBlePeer({ deviceId: 'dev-1', lastSeenAt: 20_000 })]);
    expect(transport.currentStatus.scanning).toBe(true);
    expect(transport.currentStatus.advertising).toBe(true);
    expect(service.listPeers()).toHaveLength(1);

    service.setPrivacyMode('invisible');
    await transport.stopSession();
    expect(service.listPeers()).toEqual([]);
    expect(service.scanState()).toBe('invisible');
    expect(transport.currentStatus.scanning).toBe(false);
    expect(transport.currentStatus.advertising).toBe(false);
    expect(transport.started).toBeNull();
  });

  it('stops scanning when Bluetooth turns off or permission is revoked', async () => {
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => 20_000);
    service.setPrivacyMode('everyone');
    service.setSessionActive(true, 20_000);
    await transport.startSession(SESSION);

    transport.setBluetoothOn(false);
    expect(transport.currentStatus.scanning).toBe(false);
    expect(transport.currentStatus.advertising).toBe(false);
    expect(service.scanState()).toBe('bluetooth_off');
    await expect(transport.startSession(SESSION)).rejects.toThrow(/Bluetooth is off/);

    transport.setBluetoothOn(true);
    await transport.startSession(SESSION);
    transport.setPermissionGranted(false);
    expect(transport.currentStatus.scanning).toBe(false);
    expect(service.scanState()).toBe('permission_needed');
    await expect(transport.startSession(SESSION)).rejects.toThrow(/permission/);
  });

  it('clears listeners and leaves scanning off after repeated start/stop cycles', async () => {
    const transport = new MockNearbyTransport();
    let fires = 0;
    const off = transport.onPeersChanged(() => {
      fires += 1;
    });
    for (let i = 0; i < 25; i += 1) {
      await transport.startSession({ ...SESSION, discoveryId: `id${i}abcd`.slice(0, 8) });
      transport.setPeers([mockBlePeer({ deviceId: `dev-${i}`, lastSeenAt: 1 })]);
      await transport.stopSession();
    }
    expect(transport.startCount).toBe(25);
    expect(transport.stopCount).toBe(25);
    expect(transport.currentStatus.scanning).toBe(false);
    expect(transport.currentStatus.advertising).toBe(false);
    expect(transport.started).toBeNull();
    expect(transport.listPeers()).toEqual([]);

    const before = fires;
    off();
    transport.setPeers([mockBlePeer({ deviceId: 'late', lastSeenAt: 1 })]);
    expect(fires).toBe(before);
  });

  it('never puts a user UUID into the mocked advertisement discovery id', async () => {
    const transport = new MockNearbyTransport();
    await transport.startSession(SESSION);
    expect(transport.started?.discoveryId).toBe('k7m2p9qx');
    expect(transport.started?.discoveryId).not.toBe(SESSION.userId);
    expect(transport.started?.discoveryId).not.toMatch(/-/);
  });
});
