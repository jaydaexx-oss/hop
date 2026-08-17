import { describe, expect, it } from 'vitest';
import {
  decodeHopQrPayload,
  encodeHopQrPayload,
  hopQrContainsSecrets,
  hopQrUri,
  isBleDebugEnabled,
  isDiscoverableMode,
  privacyModeForDiscoverable,
} from '@hop/protocol';

import { discoverablePrivacyMode, isDiscoverable, isEventModeAllowed } from '@/src/nearby/nearbyPolicy';
import { loadLastDiscoverableMode, loadPrivacyMode, savePrivacyMode } from '@/src/nearby/privacyStore';
import { MemoryKvStore } from '@/src/nearby/kvStore';
import { NearbyService } from '@/src/nearby/NearbyService';
import { MockNearbyTransport, mockBlePeer } from '@/src/nearby/MockNearbyTransport';

describe('discoverable maps onto existing nearby privacy', () => {
  it('persists Discoverable OFF as Invisible across restart', async () => {
    const store = new MemoryKvStore();
    expect(await loadPrivacyMode(store, 'user-1')).toBe('invisible');
    expect(isDiscoverableMode('invisible')).toBe(false);
    await savePrivacyMode(store, 'user-1', 'everyone');
    expect(await loadPrivacyMode(store, 'user-1')).toBe('everyone');
    expect(await loadLastDiscoverableMode(store, 'user-1')).toBe('everyone');
    await savePrivacyMode(store, 'user-1', 'invisible');
    expect(await loadPrivacyMode(store, 'user-1')).toBe('invisible');
    expect(await loadLastDiscoverableMode(store, 'user-1')).toBe('everyone');
    expect(privacyModeForDiscoverable(true, 'everyone')).toBe('everyone');
    expect(discoverablePrivacyMode(false, 'everyone')).toBe('invisible');
    expect(isDiscoverable('invisible')).toBe(false);
    expect(isEventModeAllowed('invisible')).toBe(false);
  });

  it('stops mocked advertising list while Invisible / Discoverable off', () => {
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => 20_000);
    service.setPrivacyMode('everyone');
    service.setSessionActive(true, 20_000);
    transport.setPeers([mockBlePeer({ deviceId: 'dev-1', lastSeenAt: 20_000 })]);
    expect(service.listPeers()).toHaveLength(1);
    service.setPrivacyMode('invisible');
    expect(service.listPeers()).toEqual([]);
  });

  it('filters blocked peers from Around Us', () => {
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => 20_000);
    service.setPrivacyMode('everyone');
    service.setBlockedIds(['blocked']);
    transport.setPeers([
      mockBlePeer({
        deviceId: 'b',
        userId: 'blocked',
        displayName: 'blocked-user',
        sessionEstablished: true,
        lastSeenAt: 20_000,
      }),
      mockBlePeer({
        deviceId: 'ok',
        userId: 'ok',
        displayName: 'ok-user',
        sessionEstablished: true,
        lastSeenAt: 20_000,
      }),
    ]);
    expect(service.listPeers().map((p) => p.displayName)).toEqual(['ok-user']);
  });
});

describe('HOP QR and BLE debug gates', () => {
  it('QR payload has username + invite and no secrets', () => {
    const payload = encodeHopQrPayload({ username: 'jaydae' });
    const uri = hopQrUri(payload);
    expect(decodeHopQrPayload(uri)?.username).toBe('jaydae');
    expect(hopQrContainsSecrets(uri)).toBe(false);
    expect(uri).not.toMatch(/crypto_box|secret|AA:BB:CC|identity_public_key/i);
  });

  it('BLE debug is __DEV__ only', () => {
    expect(isBleDebugEnabled(true)).toBe(true);
    expect(isBleDebugEnabled(false)).toBe(false);
  });
});
