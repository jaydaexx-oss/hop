import {
  deriveOperatingMode,
  eventEnabledAfterPrivacyChange,
  eventModeMayRun,
  isDiscoverableMode,
  mayCommitEventEnable,
  operatingModeAfterEventExpiry,
  planOperatingMode,
  privacyModeForDiscoverable,
  rememberDiscoverableMode,
  type NearbyAudience,
  type NearbyOperatingMode,
  type OperatingModePlan,
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

export function operatingModeFor(
  privacyMode: NearbyPrivacyMode,
  eventEnabled: boolean,
): NearbyOperatingMode {
  return deriveOperatingMode(privacyMode, eventEnabled);
}

export function survivingEventEnabled(
  privacyMode: NearbyPrivacyMode,
  eventEnabled: boolean,
): boolean {
  return eventEnabledAfterPrivacyChange(privacyMode, eventEnabled);
}

export function canCommitEventEnable(
  requestId: number,
  latestRequestId: number,
  privacyMode: NearbyPrivacyMode,
): boolean {
  return mayCommitEventEnable({ requestId, latestRequestId, privacyMode });
}

export function operatingModeAfterExpiry(privacyMode: NearbyPrivacyMode): NearbyOperatingMode {
  return operatingModeAfterEventExpiry(privacyMode);
}

export function planNearbyOperatingMode(input: {
  target: NearbyOperatingMode;
  privacyMode: NearbyPrivacyMode;
  lastDiscoverableMode: NearbyAudience;
  eventEnabled: boolean;
  audience?: NearbyAudience | null;
}): OperatingModePlan {
  return planOperatingMode(input);
}

export const OPERATING_MODE_ORDER: NearbyOperatingMode[] = ['around_us', 'event', 'invisible'];

export const EVENT_BLOCKED_COPY = {
  title: 'Choose who can find you',
  body: 'Event Mode cannot run while Invisible. Pick Contacts only or Everyone nearby first. You will not appear to new nearby people until you do.',
};

export const EVENT_ENTRY_COPY = {
  title: 'Event setup',
  body: 'Name this gathering and choose how long Event Mode runs. More active Bluetooth uses more battery. No GPS. Encryption and message requests stay the same. When time is up you return to Around Us — not Invisible. You can end Event Mode early.',
  confirm: 'Start Event Mode',
};

export const INVISIBLE_RADAR_COPY =
  'Chats still work. You won’t appear to new nearby people.';

export const OPERATING_MODE_HINTS: Record<NearbyOperatingMode, string> = {
  around_us: 'Find people nearby over Bluetooth. Existing chats stay available.',
  event: 'Gathering discovery for a chosen duration. Choose who can find you before it starts.',
  invisible: 'Stop appearing to new nearby people. Existing chats still work.',
};
