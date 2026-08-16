/**
 * BluetoothTransport — native iOS / Android implementation.
 *
 * Implements the Transport interface from transportManager.ts using the HOP
 * BLE GATT profile defined in constants.ts.
 *
 * CURRENT STATUS (PoC milestone):
 *   ✅ isAvailable() — returns true when ≥1 verified HOP BLE peer is known
 *   🚧 send()        — NOT YET IMPLEMENTED; BLE message delivery is the next
 *                      milestone after peer discovery is confirmed on hardware.
 *
 * isAvailable() does NOT initiate scanning — that is handled by the
 * useBluetoothDiscovery hook, which owns the BleManager lifecycle and feeds
 * discovered peer IDs into this transport via setVerifiedPeers().
 *
 * Why separate scanning from the transport?
 *   The TransportManager is a synchronous protocol primitive that does not own
 *   async lifecycle (timers, event subscriptions).  Keeping scanning in a React
 *   hook lets us tie it to the component tree lifecycle cleanly and avoids
 *   double-scanning bugs.
 */

import type { Transport, EncryptedEnvelope, SendResult, TransportId } from '../transportManager';

export class BluetoothTransport implements Transport {
  readonly id: TransportId = 'bluetooth';

  /**
   * The set of profile IDs for verified HOP peers that were seen over BLE
   * recently (within HOP_PEER_TTL_MS).  Updated by useBluetoothDiscovery.
   */
  private verifiedPeerIds = new Set<string>();

  /** Called by useBluetoothDiscovery whenever the discovered peer set changes. */
  setVerifiedPeers(peers: ReadonlySet<string>): void {
    this.verifiedPeerIds = new Set(peers);
  }

  /**
   * Returns true when at least one verified HOP BLE peer is currently reachable.
   *
   * NOTE: This does not check whether the *specific recipient* is reachable via
   * BLE.  Per-peer routing is the next milestone.  For now the contract is:
   *   "if any HOP peer is nearby over BLE, prefer BLE for all nearby messages."
   * useTransportState narrows this further by checking the specific peerId.
   */
  async isAvailable(): Promise<boolean> {
    return this.verifiedPeerIds.size > 0;
  }

  isVerifiedPeer(profileId: string): boolean {
    return this.verifiedPeerIds.has(profileId);
  }

  /**
   * Send an encrypted envelope over BLE.
   *
   * NOT IMPLEMENTED in this PoC.  BLE message delivery requires:
   *   1. Maintaining a persistent GATT connection to the target peer
   *   2. Writing to HOP_MESSAGE_CHAR with framing for payloads > MTU
   *   3. Waiting for an acknowledgement notification
   *   4. Handling reconnection on link loss
   *
   * This is intentionally deferred to keep the discovery milestone focused.
   * The TransportManager will fall through to the internet transport when this
   * returns ok:false.
   */
  async send(_envelope: EncryptedEnvelope): Promise<SendResult> {
    return {
      ok: false,
      transport: 'bluetooth',
      error: 'BLE message send not yet implemented — discovery PoC only',
    };
  }
}

/** Singleton — one BleManager per process is required by react-native-ble-plx. */
export const bluetoothTransport = new BluetoothTransport();
