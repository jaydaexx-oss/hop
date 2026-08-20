import { describe, expect, it } from 'vitest';

import { EventModeService, formatEventRemaining } from './EventModeService';
import { MemoryKvStore } from './kvStore';
import { NearbyService } from './NearbyService';
import { MockNearbyTransport, mockBlePeer } from './MockNearbyTransport';
import { discoveryProfileFor, isEventModeAllowed } from './nearbyPolicy';
import { loadPrivacyMode, savePrivacyMode } from './privacyStore';
import { clampEventDurationMs, customEventDurationMs } from './eventDuration';
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
    expect(on.eventCode).toBeNull();
    expect(on.name).toBeNull();
    expect(formatEventRemaining(on.remainingMs)).toBe('2h');

    now += DEFAULT_EVENT_DURATION_MS + 1;
    const expired = await service.tick('user-1');
    expect(expired.enabled).toBe(false);
    expect(expired.remainingMs).toBe(0);

    const reloaded = await service.load('user-1');
    expect(reloaded.enabled).toBe(false);
  });

  it('expires while the app is backgrounded (clock advances without ticks, then a foreground tick)', async () => {
    const store = new MemoryKvStore();
    let now = 2_000_000;
    const service = new EventModeService(store, () => now);
    await service.enable('user-1', DEFAULT_EVENT_DURATION_MS);
    now += DEFAULT_EVENT_DURATION_MS + 5_000;
    const foreground = await service.tick('user-1');
    expect(foreground.enabled).toBe(false);
    expect(foreground.remainingMs).toBe(0);
    expect(foreground.sessionId).toBeNull();
  });

  it('cannot reactivate Event Mode after expiry across a simulated restart', async () => {
    const store = new MemoryKvStore();
    let now = 3_000_000;
    const first = new EventModeService(store, () => now);
    await first.enable('user-1', 1_000);
    now += 1_001;
    const restarted = new EventModeService(store, () => now);
    const loaded = await restarted.load('user-1');
    expect(loaded.enabled).toBe(false);
    expect(JSON.parse((await store.get('hop.eventMode.user-1')) ?? '{}').enabled).toBe(false);
    const stillOff = await restarted.load('user-1');
    expect(stillOff.enabled).toBe(false);
  });

  it('persists event name and a custom duration across restart', async () => {
    const store = new MemoryKvStore();
    let now = 4_000_000;
    const first = new EventModeService(store, () => now);
    const on = await first.enable('user-1', 90 * 60_000, null, 'Campus mixer');
    expect(on.name).toBe('Campus mixer');
    expect(on.eventId).toBeNull();
    expect(on.remainingMs).toBe(90 * 60_000);
    expect(on.eventCode).toBeNull();
    const persisted = JSON.parse((await store.get('hop.eventMode.user-1')) ?? '{}') as {
      name?: string;
      eventCode?: string | null;
      expiresAt?: number;
    };
    expect(persisted.name).toBe('Campus mixer');
    expect(persisted.eventCode).toBeNull();
    const restarted = new EventModeService(store, () => now);
    const loaded = await restarted.load('user-1');
    expect(loaded.enabled).toBe(true);
    expect(loaded.name).toBe('Campus mixer');
    expect(loaded.remainingMs).toBe(90 * 60_000);
  });

  it('persists a backend event id so Event Mode can restore after navigation or restart', async () => {
    const store = new MemoryKvStore();
    let now = 5_000_000;
    const first = new EventModeService(store, () => now);
    const on = await first.enable('user-1', 2 * 60 * 60 * 1000, null, 'Campus mixer', 'event-123');
    expect(on.eventId).toBe('event-123');
    const restarted = new EventModeService(store, () => now);
    const loaded = await restarted.load('user-1');
    expect(loaded.enabled).toBe(true);
    expect(loaded.eventId).toBe('event-123');
    expect(loaded.name).toBe('Campus mixer');
  });

  it('clamps custom duration to 24 hours and requires a trimmed name', async () => {
    const store = new MemoryKvStore();
    const service = new EventModeService(store, () => 8_000);
    const tooLong = await service.enable('user-1', 40 * 60 * 60 * 1000, null, '  Night market  ');
    expect(tooLong.remainingMs).toBe(24 * 60 * 60 * 1000);
    expect(tooLong.name).toBe('Night market');
    const blank = await service.enable('user-1', 60_000, null, '   ');
    expect(blank.name).toBeNull();
    expect(customEventDurationMs(0, 30)).toBe(30 * 60_000);
    expect(clampEventDurationMs(0)).toBe(60_000);
    expect(clampEventDurationMs(1_000)).toBe(1_000);
  });

  it('treats corrupt persisted Event Mode as off', async () => {
    const store = new MemoryKvStore();
    await store.set('hop.eventMode.user-1', '{not-json');
    const service = new EventModeService(store, () => 10);
    expect((await service.load('user-1')).enabled).toBe(false);
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

  it('does not let Event Mode show identified strangers in Contacts only', async () => {
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => 20_000);
    service.setSelfUserId('me');
    service.setPrivacyMode('contacts');
    service.setContactIds(['friend']);
    service.setSessionActive(true, 20_000);
    transport.setDiscoveryProfile('event');
    transport.setPeers([
      mockBlePeer({
        deviceId: 'friend-dev',
        displayName: 'sam',
        userId: 'friend',
        sessionEstablished: true,
        lastSeenAt: 20_000,
      }),
      mockBlePeer({
        deviceId: 'other-dev',
        displayName: 'rio',
        userId: 'stranger',
        sessionEstablished: true,
        lastSeenAt: 20_000,
      }),
    ]);
    expect(discoveryProfileFor('contacts', true)).toBe('event');
    expect(service.listPeers().map((p) => p.displayName)).toEqual(['sam']);
  });

  it('keeps Event Mode from advertising while Invisible', async () => {
    expect(isEventModeAllowed('invisible')).toBe(false);
    const store = new MemoryKvStore();
    const events = new EventModeService(store, () => 9_000);
    await events.enable('user-1');
    const transport = new MockNearbyTransport();
    const nearby = new NearbyService(transport, () => 9_000);
    nearby.setPrivacyMode('invisible');
    await transport.startSession({
      userId: 'user-1',
      username: 'jaydae',
      scanMode: 'lowLatency',
      identityPublicKey: 'pk',
      discoveryId: 'k7m2p9qx',
    });
    transport.setDiscoveryProfile('event');
    transport.setPeers([mockBlePeer({ deviceId: 'dev-1', lastSeenAt: 9_000 })]);
    expect(nearby.listPeers()).toEqual([]);
    expect(nearby.scanState()).toBe('invisible');
    await transport.stopSession();
    const disabled = await events.disable('user-1');
    expect(disabled.enabled).toBe(false);
    expect(transport.profile).toBe('standard');
    expect(transport.currentStatus.scanning).toBe(false);
  });
});
