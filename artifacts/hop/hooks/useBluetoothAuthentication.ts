/**
 * useBluetoothAuthentication — web / Expo Go stub.
 * Real implementation: useBluetoothAuthentication.native.ts
 */
import type { DiscoveredHopPeer } from './useBluetoothDiscovery';

export interface BleAuthState {
  /** Profile IDs of peers that have been authenticated via GATT. */
  verifiedBlePeers: ReadonlySet<string>;
  /** Map from profile.id → BLE device ID for verified peers. Used by BluetoothTransport.send(). */
  peerDeviceMap: ReadonlyMap<string, string>;
  /** Number of auth handshakes currently in progress. */
  connectingCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useBluetoothAuthentication(
  _discoveredPeers: ReadonlyMap<string, DiscoveredHopPeer>,
): BleAuthState {
  return {
    verifiedBlePeers: new Set<string>(),
    peerDeviceMap: new Map<string, string>(),
    connectingCount: 0,
  };
}
