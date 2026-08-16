/**
 * Transport decision logic — zero dependencies.
 *
 * Extracted into its own module so it can be unit-tested without React,
 * React Native, or any native module mocks.
 *
 * Priority: bluetooth > internet > queued
 * (matches TransportManager PRIORITY array in transportManager.ts)
 */

export type TransportKind = 'bluetooth' | 'internet' | 'queued';

/**
 * Resolves the active transport kind from observable state.
 *
 * @param peerId            The userId of the conversation partner (undefined = no peer).
 * @param verifiedBlePeers  Profile IDs of confirmed HOP BLE peers.
 *                          On web/Expo Go this is always an empty Set.
 *                          On a physical device with a dev build it reflects
 *                          actual BLE peer discovery via useBluetoothDiscovery.
 * @param isOnline          True when the device has internet connectivity.
 */
export function resolveTransport(
  peerId: string | undefined,
  verifiedBlePeers: ReadonlySet<string>,
  isOnline: boolean,
): TransportKind {
  // BLE takes priority: only report bluetooth when the specific peer has been
  // verified over real BLE — not from the simulated nearbyUsers radar.
  if (peerId && verifiedBlePeers.has(peerId)) return 'bluetooth';
  if (isOnline) return 'internet';
  return 'queued';
}
