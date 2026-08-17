import {
  eventModeMayRun,
  isDiscoverableMode,
  privacyModeForDiscoverable,
  rememberDiscoverableMode,
} from '@hop/protocol';

import type { BleDiscoveryProfile, NearbyPrivacyMode } from './types';

export function isEventModeAllowed(privacyMode: NearbyPrivacyMode): boolean {
  return eventModeMayRun(privacyMode);
}

export function isDiscoverable(privacyMode: NearbyPrivacyMode): boolean {
  return isDiscoverableMode(privacyMode);
}

export function discoverablePrivacyMode(
  discoverable: boolean,
  lastOnMode: NearbyPrivacyMode | null | undefined,
): NearbyPrivacyMode {
  return privacyModeForDiscoverable(discoverable, lastOnMode);
}

export function persistLastDiscoverableMode(
  mode: NearbyPrivacyMode,
  previous: NearbyPrivacyMode | null | undefined,
): Exclude<NearbyPrivacyMode, 'invisible'> {
  return rememberDiscoverableMode(mode, previous);
}

/** Event Mode only accelerates scan duty cycle. It never changes who is visible. */
export function discoveryProfileFor(
  privacyMode: NearbyPrivacyMode,
  eventEnabled: boolean,
): BleDiscoveryProfile {
  return isEventModeAllowed(privacyMode) && eventEnabled ? 'event' : 'standard';
}

export function shouldRunNearbyDiscovery(input: {
  privacyMode: NearbyPrivacyMode;
  appActive: boolean;
  bluetoothOn: boolean;
  permissionGranted: boolean;
}): boolean {
  if (!isDiscoverable(input.privacyMode)) return false;
  if (!input.appActive) return false;
  if (!input.bluetoothOn || !input.permissionGranted) return false;
  return true;
}
