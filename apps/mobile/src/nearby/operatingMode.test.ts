import { describe, expect, it } from 'vitest';
import {
  deriveOperatingMode,
  eventModeMayRun,
  nearbyPeerSheetActions,
  nearbySheetSendsMessage,
  operatingModeAfterEventExpiry,
  privacyModeForDiscoverable,
} from '@hop/protocol';

import { EventModeService } from './EventModeService';
import { MemoryKvStore } from './kvStore';
import { NearbyService } from './NearbyService';
import { MockNearbyTransport, mockBlePeer } from './MockNearbyTransport';
import {
  EVENT_BLOCKED_COPY,
  EVENT_ENTRY_COPY,
  INVISIBLE_RADAR_COPY,
  OPERATING_MODE_HINTS,
  canCommitEventEnable,
  discoveryProfileFor,
  isEventModeAllowed,
  operatingModeFor,
  planNearbyOperatingMode,
  shouldRunNearbyDiscovery,
  survivingEventEnabled,
} from './nearbyPolicy';
import { isPeerVisible } from './proximity';
import { loadLastDiscoverableMode, loadPrivacyMode, savePrivacyMode } from './privacyStore';
import { SCAN_STATE_COPY, radarShouldAnimate } from './scanState';
import { DEFAULT_EVENT_DURATION_MS } from './types';

const USER = 'user-1';

describe('operatingMode derivation', () => {
  it('maps privacyMode + eventMode onto Invisible / Around Us / Event Mode', () => {
    expect(operatingModeFor('invisible', false)).toBe('invisible');
    expect(operatingModeFor('contacts', false)).toBe('around_us');
    expect(operatingModeFor('everyone', false)).toBe('around_us');
    expect(operatingModeFor('contacts', true)).toBe('event');
    expect(operatingModeFor('everyone', true)).toBe('event');
    expect(operatingModeFor('invisible', true)).toBe('invisible');
    expect(eventModeMayRun('invisible')).toBe(false);
  });

  it('kills Event when switching to Invisible and keeps last Discoverable audience', () => {
    const plan = planNearbyOperatingMode({
      target: 'invisible',
      privacyMode: 'everyone',
      lastDiscoverableMode: 'everyone',
      eventEnabled: true,
    });
    expect(plan.nextPrivacyMode).toBe('invisible');
    expect(plan.nextEventEnabled).toBe(false);
    expect(plan.lastDiscoverableMode).toBe('everyone');
    expect(survivingEventEnabled('invisible', true)).toBe(false);
    expect(shouldRunNearbyDiscovery({
      privacyMode: plan.nextPrivacyMode,
      appActive: true,
      bluetoothOn: true,
      permissionGranted: true,
    })).toBe(false);
  });

  it('cannot start Event Mode while Invisible without an explicit audience', () => {
    const blocked = planNearbyOperatingMode({
      target: 'event',
      privacyMode: 'invisible',
      lastDiscoverableMode: 'contacts',
      eventEnabled: false,
    });
    expect(blocked.blockedByInvisible).toBe(true);
    expect(blocked.nextPrivacyMode).toBe('invisible');
    expect(blocked.nextEventEnabled).toBe(false);
    expect(isEventModeAllowed('invisible')).toBe(false);
    expect(discoveryProfileFor('invisible', true)).toBe('standard');
  });

  it('returns Around Us — not Invisible — when Event expires', () => {
    expect(operatingModeAfterEventExpiry('everyone')).toBe('around_us');
    expect(operatingModeAfterEventExpiry('contacts')).toBe('around_us');
    const plan = planNearbyOperatingMode({
      target: 'around_us',
      privacyMode: 'everyone',
      lastDiscoverableMode: 'everyone',
      eventEnabled: true,
    });
    expect(plan.nextPrivacyMode).toBe('everyone');
    expect(plan.nextEventEnabled).toBe(false);
    expect(deriveOperatingMode(plan.nextPrivacyMode, plan.nextEventEnabled)).toBe('around_us');
  });

  it('keeps Discoverable OFF as Invisible across restart', async () => {
    const store = new MemoryKvStore();
    expect(await loadPrivacyMode(store, USER)).toBe('invisible');
    expect(privacyModeForDiscoverable(false, 'everyone')).toBe('invisible');
    await savePrivacyMode(store, USER, 'everyone');
    await savePrivacyMode(store, USER, 'invisible');
    expect(await loadPrivacyMode(store, USER)).toBe('invisible');
    expect(await loadLastDiscoverableMode(store, USER)).toBe('everyone');
    expect(operatingModeFor(await loadPrivacyMode(store, USER), false)).toBe('invisible');
  });
});

describe('operatingMode persistence with Event Mode', () => {
  it('restarts into Event Mode when Discoverable and the session is still live', async () => {
    const store = new MemoryKvStore();
    let now = 5_000;
    const events = new EventModeService(store, () => now);
    await savePrivacyMode(store, USER, 'everyone');
    await events.enable(USER, DEFAULT_EVENT_DURATION_MS);
    const restarted = new EventModeService(store, () => now);
    const loaded = await restarted.load(USER);
    expect(loaded.enabled).toBe(true);
    expect(operatingModeFor(await loadPrivacyMode(store, USER), loaded.enabled)).toBe('event');
  });

  it('expiry after restart returns Around Us, not Invisible', async () => {
    const store = new MemoryKvStore();
    let now = 10_000;
    const events = new EventModeService(store, () => now);
    await savePrivacyMode(store, USER, 'contacts');
    await events.enable(USER, 1_000);
    now += 1_001;
    const restarted = new EventModeService(store, () => now);
    const loaded = await restarted.load(USER);
    expect(loaded.enabled).toBe(false);
    expect(await loadPrivacyMode(store, USER)).toBe('contacts');
    expect(operatingModeFor('contacts', loaded.enabled)).toBe('around_us');
  });

  it('a delayed Event enable is rolled back when Invisible was requested later', async () => {
    const store = new MemoryKvStore();
    const events = new EventModeService(store, () => 50_000);
    await savePrivacyMode(store, USER, 'everyone');
    let latestRequestId = 0;
    let privacy = await loadPrivacyMode(store, USER);

    const staleEvent = (async () => {
      const requestId = ++latestRequestId;
      const plan = planNearbyOperatingMode({
        target: 'event',
        privacyMode: privacy,
        lastDiscoverableMode: 'everyone',
        eventEnabled: false,
        audience: 'everyone',
      });
      privacy = plan.nextPrivacyMode;
      await savePrivacyMode(store, USER, privacy);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const enabled = await events.enable(USER);
      if (!canCommitEventEnable(requestId, latestRequestId, privacy)) {
        await events.disable(USER);
        return;
      }
      expect(enabled.enabled).toBe(true);
    })();

    const laterInvisible = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      latestRequestId += 1;
      const plan = planNearbyOperatingMode({
        target: 'invisible',
        privacyMode: privacy,
        lastDiscoverableMode: 'everyone',
        eventEnabled: true,
      });
      privacy = plan.nextPrivacyMode;
      await savePrivacyMode(store, USER, privacy);
      await events.disable(USER);
    })();

    await Promise.all([staleEvent, laterInvisible]);
    expect(privacy).toBe('invisible');
    expect((await events.load(USER)).enabled).toBe(false);
    expect(operatingModeFor(privacy, (await events.load(USER)).enabled)).toBe('invisible');
    expect(
      shouldRunNearbyDiscovery({
        privacyMode: privacy,
        appActive: true,
        bluetoothOn: true,
        permissionGranted: true,
      }),
    ).toBe(false);
  });

  it('a stale Discoverable persist cannot overwrite a later Invisible write', async () => {
    const store = new MemoryKvStore();
    await savePrivacyMode(store, USER, 'everyone');
    let latestRequestId = 0;
    let privacy = await loadPrivacyMode(store, USER);

    const staleEveryone = (async () => {
      const requestId = ++latestRequestId;
      privacy = 'everyone';
      await new Promise((resolve) => setTimeout(resolve, 20));
      await savePrivacyMode(store, USER, 'everyone');
      if (requestId !== latestRequestId) {
        await savePrivacyMode(store, USER, privacy);
      }
    })();

    const laterInvisible = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      latestRequestId += 1;
      privacy = 'invisible';
      await savePrivacyMode(store, USER, 'invisible');
    })();

    await Promise.all([staleEveryone, laterInvisible]);
    expect(privacy).toBe('invisible');
    expect(await loadPrivacyMode(store, USER)).toBe('invisible');
    expect(operatingModeFor(await loadPrivacyMode(store, USER), false)).toBe('invisible');
  });

  it('Invisible on disk kills a leftover Event session on load', async () => {
    const store = new MemoryKvStore();
    const events = new EventModeService(store, () => 20_000);
    await events.enable(USER);
    await savePrivacyMode(store, USER, 'invisible');
    const privacy = await loadPrivacyMode(store, USER);
    let event = await events.load(USER);
    if (privacy === 'invisible' && event.enabled) {
      event = await events.disable(USER);
    }
    expect(privacy).toBe('invisible');
    expect(event.enabled).toBe(false);
    expect(operatingModeFor(privacy, event.enabled)).toBe('invisible');
  });
});

describe('audience still drives who is visible', () => {
  it('Contacts vs Everyone still uses isPeerVisible; Event does not change the set', () => {
    const friend = {
      token: 'p1',
      ephemeralId: 'abc12345',
      deviceId: 'hidden',
      displayName: 'sam',
      avatarInitials: 'SA',
      userId: 'friend',
      proximity: 'nearby' as const,
      rssi: -70,
      lastSeenAt: 1,
      discovered: true,
      encrypted: true,
      connected: false,
      canMessage: true,
    };
    const stranger = { ...friend, token: 'p2', userId: 'stranger', displayName: 'rio' };
    const contacts = new Set(['friend']);
    expect(isPeerVisible(friend, 'contacts', 'me', contacts)).toBe(true);
    expect(isPeerVisible(stranger, 'contacts', 'me', contacts)).toBe(false);
    expect(isPeerVisible(stranger, 'everyone', 'me', contacts)).toBe(true);
    expect(isPeerVisible(friend, 'invisible', 'me', contacts)).toBe(false);
    expect(discoveryProfileFor('contacts', true)).toBe('event');
    expect(discoveryProfileFor('everyone', true)).toBe('event');
  });

  it('Event Mode does not reveal identified strangers in Contacts only', () => {
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
    expect(service.listPeers().map((p) => p.displayName)).toEqual(['sam']);
  });

  it('does not invent radar peers and the sheet still does not auto-DM', () => {
    const transport = new MockNearbyTransport();
    const service = new NearbyService(transport, () => 20_000);
    service.setPrivacyMode('everyone');
    service.setSessionActive(true, 20_000);
    expect(service.listPeers()).toEqual([]);
    const actions = nearbyPeerSheetActions({ canMessage: true, connected: false, userId: 'peer' });
    expect(actions).toContain('message_request');
    expect(nearbySheetSendsMessage('message_request')).toBe(false);
  });
});

describe('Event entry copy and Invisible radar', () => {
  it('confirms 2h, battery, no GPS, and unchanged encryption/requests', () => {
    expect(EVENT_ENTRY_COPY.body).toMatch(/2 hours/);
    expect(EVENT_ENTRY_COPY.body).toMatch(/battery/i);
    expect(EVENT_ENTRY_COPY.body).toMatch(/No GPS/);
    expect(EVENT_ENTRY_COPY.body).toMatch(/Encryption and message requests stay the same/);
    expect(EVENT_ENTRY_COPY.body).toMatch(/Around Us/);
    expect(EVENT_ENTRY_COPY.body).not.toMatch(/auto-?DM|venue code|GPS tracking/i);
    expect(EVENT_BLOCKED_COPY.body).toMatch(/Invisible/);
  });

  it('dims Invisible radar copy and skips motion when reduced or Invisible', () => {
    expect(SCAN_STATE_COPY.invisible).toBe(INVISIBLE_RADAR_COPY);
    expect(radarShouldAnimate({ scanning: true, reduceMotion: true, invisible: false })).toBe(false);
    expect(radarShouldAnimate({ scanning: true, reduceMotion: false, invisible: true })).toBe(false);
    expect(radarShouldAnimate({ scanning: true, reduceMotion: false, invisible: false })).toBe(true);
    expect(radarShouldAnimate({ scanning: false, reduceMotion: false, invisible: false })).toBe(false);
    expect(OPERATING_MODE_HINTS.invisible).toMatch(/Existing chats still work/);
    expect(OPERATING_MODE_HINTS.event).toMatch(/who can find you/);
  });
});
