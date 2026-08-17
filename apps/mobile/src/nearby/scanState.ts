import type { BleLinkStatus } from '@hop/protocol';

import type { AroundUsScanState, NearbyPrivacyMode } from './types';
import { SEARCHING_GRACE_MS } from './types';

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
  if (!input.status.implemented || !input.status.bluetoothOn) return 'bluetooth_off';
  if (!input.status.permissionGranted) return 'permission_needed';
  if (input.peerCount > 0) return 'peers_found';
  if (!input.sessionActive) return 'nobody_nearby';
  const started = input.sessionStartedAt ?? input.now;
  if (input.status.scanning || input.now - started < SEARCHING_GRACE_MS) return 'searching';
  return 'nobody_nearby';
}

export const SCAN_STATE_COPY: Record<AroundUsScanState, string> = {
  invisible: 'You’re invisible. Discovery stays off until you choose Contacts only or Everyone nearby.',
  bluetooth_off: 'Bluetooth is off. Turn it on to find people around you. Internet chat and the offline queue still work.',
  permission_needed: 'HOP needs Bluetooth permission to find people around you.',
  searching: 'Searching for HOP users around you…',
  nobody_nearby: 'Nobody nearby right now. Keep Around Us open with Bluetooth on.',
  peers_found: '',
  connection_failure: 'Couldn’t connect. Try again — internet chat still works if you’re online.',
};
