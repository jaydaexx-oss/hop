/**
 * BluetoothTransport — web / unsupported platform stub.
 *
 * On web, the Web Bluetooth API exists but is too restricted for GATT peripheral
 * mode and the scanning model HOP needs.  This stub keeps the Transport interface
 * satisfied while always reporting unavailable, so the TransportManager falls
 * through to the internet transport.
 *
 * The real implementation is in BluetoothTransport.native.ts.
 */

import type { Transport, EncryptedEnvelope, SendResult } from '../transportManager';

export class BluetoothTransport implements Transport {
  readonly id = 'bluetooth' as const;

  async isAvailable(): Promise<boolean> {
    return false; // BLE not supported on web
  }

  async send(_envelope: EncryptedEnvelope): Promise<SendResult> {
    return { ok: false, transport: 'bluetooth', error: 'BLE not supported on this platform' };
  }

  setVerifiedPeers(_peers: ReadonlySet<string>): void {
    // no-op on web
  }

  setDeviceMap(_map: ReadonlyMap<string, string>): void {
    // no-op on web
  }

  isVerifiedPeer(_profileId: string): boolean {
    return false;
  }
}

/** Singleton stub — web always reports no BLE peers. */
export const bluetoothTransport = new BluetoothTransport();
