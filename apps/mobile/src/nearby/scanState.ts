import type { BleLinkStatus } from '@hop/protocol';

import type { AroundUsScanState, NearbyPrivacyMode } from './types';
import { SEARCHING_GRACE_MS } from './types';

function authorizationBlocked(status: BleLinkStatus): boolean {
  if (status.adapterState === 'unauthorized') return true;
  if (
    status.authorization === 'notDetermined' ||
    status.authorization === 'denied' ||
    status.authorization === 'restricted'
  ) {
    return true;
  }
  return !status.permissionGranted;
}

export function deriveScanState(input: {
  privacyMode: NearbyPrivacyMode;
  status: BleLinkStatus;
  sessionActive: boolean;
  peerCount: number;
  connectionError: string | null;
  now: number;
  sessionStartedAt: number | null;
}): AroundUsScanState {
  if (input.privacyMode === 'invisible') return 'invisible';
  if (input.connectionError) return 'connection_failure';

  const { status } = input;
  if (!status.implemented) {
    // Native not loaded yet — do not claim the radio is off.
    if (!status.nativeProbed) return 'permission_needed';
    return 'bluetooth_off';
  }

  // Authorization problems are never "Bluetooth off".
  if (authorizationBlocked(status)) return 'permission_needed';
  if (status.adapterState === 'unsupported') return 'connection_failure';
  if (status.adapterState === 'resetting') {
    if (input.peerCount > 0) return 'peers_found';
    return 'searching';
  }
  if (status.adapterState === 'poweredOff' || !status.bluetoothOn) return 'bluetooth_off';
  if (input.peerCount > 0) return 'peers_found';
  if (!input.sessionActive) return 'nobody_nearby';
  const started = input.sessionStartedAt ?? input.now;
  if (input.status.scanning || input.now - started < SEARCHING_GRACE_MS) return 'searching';
  return 'nobody_nearby';
}

export const SCAN_STATE_COPY: Record<AroundUsScanState, string> = {
  invisible: 'Chats still work. You won’t appear to new nearby people.',
  bluetooth_off: 'Bluetooth is off. Turn it on to find people around you. Internet chat and the offline queue still work.',
  permission_needed: 'HOP needs Bluetooth permission to find people around you.',
  searching: 'Searching for HOP users around you…',
  nobody_nearby: 'Nobody nearby right now. Keep Around Us open with Bluetooth on.',
  peers_found: '',
  connection_failure: 'Couldn’t connect. Try again — internet chat still works if you’re online.',
};

export function radarShouldAnimate(input: {
  scanning: boolean;
  reduceMotion: boolean;
  invisible: boolean;
}): boolean {
  if (input.reduceMotion || input.invisible) return false;
  return input.scanning;
}
