/**
 * useBluetoothDiscovery — web / unsupported platform stub.
 *
 * Returns a static "unsupported" state.  The real hook is in
 * useBluetoothDiscovery.native.ts and is loaded only on iOS / Android.
 */

export type BleDiscoveryStatus =
  | 'unsupported'   // platform does not support BLE (web, simulator)
  | 'unauthorized'  // user denied permission
  | 'off'           // BLE radio is off
  | 'scanning'      // actively scanning
  | 'idle'          // radio on, not currently scanning
  | 'unavailable';  // BLE API unavailable for another reason

export interface BleDiscoveryState {
  status: BleDiscoveryStatus;
  /** Profile IDs of verified HOP peers seen over BLE within HOP_PEER_TTL_MS */
  verifiedBlePeers: ReadonlySet<string>;
}

export function useBluetoothDiscovery(): BleDiscoveryState {
  return {
    status: 'unsupported',
    verifiedBlePeers: new Set<string>(),
  };
}
