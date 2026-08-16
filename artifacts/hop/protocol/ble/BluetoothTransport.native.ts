/**
 * BluetoothTransport — native iOS / Android implementation.
 *
 * Implements the Transport interface using the HOP BLE GATT profile.
 *
 * ─── send() flow ─────────────────────────────────────────────────────────────
 *
 *  1. Look up the recipient's BLE device ID from `peerDeviceMap`
 *     (populated by useBluetoothAuthentication after the GATT handshake).
 *  2. Connect to that device via react-native-ble-plx.
 *  3. Discover services and characteristics.
 *  4. Serialize the EncryptedEnvelope to JSON → base64 (max 500 bytes).
 *  5. Write to HOP_MESSAGE_CHAR on the peer's GATT server.
 *  6. Disconnect.
 *
 * ─── Not implemented ─────────────────────────────────────────────────────────
 *
 *  ✗ Delivery acknowledgement (ACK notification from the peer).
 *  ✗ Message chunking (>500-byte messages are rejected with an error).
 *  ✗ Persistent connections (every send reconnects).
 *
 * These are the next steps after this milestone.
 */

import type { Device } from 'react-native-ble-plx';
import { getBleManager } from './bleManager';
import { envelopeToBase64 } from './bleMessage';
import {
  HOP_SERVICE_UUID,
  HOP_MESSAGE_CHAR,
  HOP_CONNECT_TIMEOUT_MS,
} from './constants';
import type {
  Transport,
  EncryptedEnvelope,
  SendResult,
  TransportId,
} from '../transportManager';

export class BluetoothTransport implements Transport {
  readonly id: TransportId = 'bluetooth';

  /** Profile IDs of BLE-authenticated peers — updated by useBluetoothAuthentication. */
  private verifiedPeerIds = new Set<string>();

  /**
   * Maps profileId → BLE deviceId for verified peers.
   * Set by useBluetoothAuthentication via setDeviceMap().
   */
  private deviceMap = new Map<string, string>();

  // ── Called by hooks ────────────────────────────────────────────────────────

  setVerifiedPeers(peers: ReadonlySet<string>): void {
    this.verifiedPeerIds = new Set(peers);
  }

  setDeviceMap(map: ReadonlyMap<string, string>): void {
    this.deviceMap = new Map(map);
  }

  isVerifiedPeer(profileId: string): boolean {
    return this.verifiedPeerIds.has(profileId);
  }

  // ── Transport interface ────────────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    return this.verifiedPeerIds.size > 0;
  }

  /**
   * Send an EncryptedEnvelope to a verified BLE peer via GATT write.
   *
   * Failures are not retried here — the TransportManager's retry queue
   * handles re-enqueuing if this returns ok:false.
   */
  async send(envelope: EncryptedEnvelope): Promise<SendResult> {
    const deviceId = this.deviceMap.get(envelope.recipient_id);
    if (!deviceId) {
      return {
        ok: false,
        transport: 'bluetooth',
        error: `Peer ${envelope.recipient_id.slice(0, 8)}… not in BLE device map — not reachable over BLE`,
      };
    }

    const base64Payload = envelopeToBase64(envelope);
    if (!base64Payload) {
      return {
        ok: false,
        transport: 'bluetooth',
        error: 'Message too large for BLE (>500 bytes) — chunking not yet implemented',
      };
    }

    let device: Device | null = null;
    try {
      const manager = getBleManager();

      device = await manager.connectToDevice(deviceId, {
        timeout: HOP_CONNECT_TIMEOUT_MS,
        autoConnect: false,
      });

      await device.discoverAllServicesAndCharacteristics();

      await device.writeCharacteristicWithResponseForService(
        HOP_SERVICE_UUID,
        HOP_MESSAGE_CHAR,
        base64Payload,
      );

      return { ok: true, transport: 'bluetooth' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[HOP BLE send] Failed to send to ${deviceId}: ${msg}`);
      return { ok: false, transport: 'bluetooth', error: msg };
    } finally {
      try {
        await device?.cancelConnection();
      } catch {
        /* already disconnected — harmless */
      }
    }
  }
}

/** Singleton — one BleManager per process is required by react-native-ble-plx. */
export const bluetoothTransport = new BluetoothTransport();
