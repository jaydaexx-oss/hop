import { describe, expect, it } from 'vitest';

import { EventModeService, formatEventRemaining } from './EventModeService';
import { MemoryKvStore } from './kvStore';
import { NearbyService } from './NearbyService';
import { MockNearbyTransport, mockBlePeer } from './MockNearbyTransport';
import { loadPrivacyMode, savePrivacyMode } from './privacyStore';
import { DEFAULT_EVENT_DURATION_MS } from './types';

describe('Event Mode expiration', () => {
  it('defaults to off and expires after the stored timestamp', async () => {
    const store = new MemoryKvStore();
    let now = 1_000_000;
    const service = new EventModeService(store, () => now);

    const initial = await service.load('user-1');
    expect(initial.enabled).toBe(false);
    expect(initial.sessionId).toBeNull();

    const on = await service.enable('user-1', DEFAULT_EVENT_DURATION_MS);
    expect(on.enabled).toBe(true);
    expect(on.remainingMs).toBe(DEFAULT_EVENT_DURATION_MS);
    expect(on.sessionId?.startsWith('local:')).toBe(true);
    expect(formatEventRemaining(on.remainingMs)).toBe('2h');

    now += DEFAULT_EVENT_DURATION_MS + 1;
    const expired = await service.tick('user-1');
    expect(expired.enabled).toBe(false);
    expect(expired.remainingMs).toBe(0);

    const reloaded = await service.load('user-1');
    expect(reloaded.enabled).toBe(false);
  });

  it('can be turned off before expiry and stays off after restart', async () => {
    const store = new MemoryKvStore();
    const service = new EventModeService(store, () => 5_000);
    await service.enable('user-1', 10_000);
    const off = await service.disable('user-1');
    expect(off.enabled).toBe(false);
    expect(await service.load('user-1')).toMatchObject({ enabled: false });
  });
});

describe('privacy persistence and mocked NearbyService', () => {
  it('defaults to Invisible and persists an explicit choice', async () => {
    const store = new MemoryKvStore();
    expect(await loadPrivacyMode(store, 'user-1')).toBe('invisible');
    await savePrivacyMode(store, 'user-1', 'everyone');
    expect(await loadPrivacyMode(store, 'user-1')).toBe('everyone');
  });

  it('filters mocked discovery according to privacy mode', async () => {
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => 20_000);
    service.setSelfUserId('me');
    service.setPrivacyMode('everyone');
    service.setContactIds(['friend']);
    service.setSessionActive(true, 20_000);
    transport.setPeers([
      mockBlePeer({
        deviceId: 'AA:BB:CC:DD:EE:FF',
        displayName: 'AA:BB:CC:DD:EE:FF',
        rssi: -50,
        lastSeenAt: 20_000,
      }),
      mockBlePeer({
        deviceId: 'friend-dev',
        displayName: 'sam',
        userId: 'friend',
        sessionEstablished: true,
        rssi: -70,
        lastSeenAt: 19_500,
      }),
      mockBlePeer({
        deviceId: 'other-dev',
        displayName: 'rio',
        userId: 'stranger',
        sessionEstablished: true,
        rssi: -90,
        lastSeenAt: 19_000,
      }),
    ]);

    const everyone = service.listPeers();
    expect(everyone.map((p) => p.displayName).sort()).toEqual(['HOP user', 'rio', 'sam']);
    expect(everyone.every((p) => !p.displayName.includes(':'))).toBe(true);

    service.setPrivacyMode('contacts');
    expect(service.listPeers().map((p) => p.displayName).sort()).toEqual(['HOP user', 'sam']);

    service.setPrivacyMode('invisible');
    expect(service.listPeers()).toEqual([]);
    expect(service.scanState()).toBe('invisible');
  });

  it('starts a mocked session with an ephemeral discovery id, not a user UUID', async () => {
    const transport = new MockNearbyTransport();
    await transport.startSession({
      userId: '11111111-2222-3333-4444-555555555555',
      username: 'jaydae',
      scanMode: 'balanced',
      identityPublicKey: 'pk',
      discoveryId: 'k7m2p9qx',
    });
    expect(transport.started?.discoveryId).toBe('k7m2p9qx');
    expect(transport.started?.discoveryId).not.toBe(transport.started?.userId);
    transport.setDiscoveryProfile('event');
    expect(transport.profile).toBe('event');
    expect(transport.scanMode).toBe('lowLatency');
  });
});
