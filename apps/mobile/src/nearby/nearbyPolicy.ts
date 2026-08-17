import type { BleDiscoveryProfile, NearbyPrivacyMode } from './types';

export function isEventModeAllowed(privacyMode: NearbyPrivacyMode): boolean {
  return privacyMode !== 'invisible';
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
  if (input.privacyMode === 'invisible') return false;
  if (!input.appActive) return false;
  if (!input.bluetoothOn || !input.permissionGranted) return false;
  return true;
}
