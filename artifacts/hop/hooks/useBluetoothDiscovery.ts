/**
 * useBluetoothDiscovery — web / unsupported platform stub.
 * Real implementation is in useBluetoothDiscovery.native.ts.
 */

export type BleDiscoveryStatus =
  | 'unsupported'
  | 'unauthorized'
  | 'off'
  | 'scanning'
  | 'idle'
  | 'unavailable';

/**
 * A HOP device seen in a BLE scan.
 *
 * States (requirement 10):
 *   discovered   – advertisement seen, tempId extracted, NOT authenticated
 *   (future)     – connected, authenticated, etc.
 *
 * Discovery ≠ authentication (requirement 11).
 * We know a HOP device is nearby but do not yet know its profile.id.
 */
export interface DiscoveredHopPeer {
  /** BLE device ID (iOS: CBPeripheral UUID; Android: address-derived) */
  deviceId: string;
  /** 32-char lowercase hex — the rotating tempId extracted from manufacturer data */
  tempIdHex: string;
  /** RSSI in dBm (negative values; closer to 0 = stronger signal) */
  rssi: number;
  /** Protocol version byte from the advertisement (must be HOP_BLE_PROTOCOL_VERSION) */
  protocolVersion: number;
  /** Unix timestamp (ms) when this peer was first seen in the current scan session */
  firstSeenAt: number;
  /** Unix timestamp (ms) of the most recent advertisement from this device */
  lastSeenAt: number;
  /**
   * Peer relationship state — only 'discovered' in this PoC.
   * Future states: 'connecting' | 'connected' | 'authenticated'
   */
  authState: 'discovered';
}

export interface BleDiscoveryState {
  status: BleDiscoveryStatus;
  /** Verified peers by profile.id — always empty until GATT auth milestone */
  verifiedBlePeers: ReadonlySet<string>;
  /** HOP devices seen in scan, keyed by BLE device ID */
  discoveredHopPeers: ReadonlyMap<string, DiscoveredHopPeer>;
}

export function useBluetoothDiscovery(): BleDiscoveryState {
  return {
    status: 'unsupported',
    verifiedBlePeers: new Set<string>(),
    discoveredHopPeers: new Map<string, DiscoveredHopPeer>(),
  };
}
