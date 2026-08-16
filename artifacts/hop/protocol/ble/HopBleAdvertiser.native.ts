/**
 * HopBleAdvertiser — iOS and Android native BLE peripheral implementation.
 *
 * ─── What this class does ─────────────────────────────────────────────────────
 *
 *  Turns this device into a BLE peripheral that advertises the HOP service UUID
 *  so that nearby HOP scanners can discover it.
 *
 *  Advertisement packet format
 *  ───────────────────────────
 *  Service UUID:     HOP_SERVICE_UUID (484F5000-484F-5000-8000-000000000001)
 *  Company ID:       HOP_COMPANY_ID   (0x4850 — "HP" in ASCII, reserved for PoC)
 *  Manufacturer data payload (AFTER company ID bytes):
 *    byte[0]       = HOP_BLE_PROTOCOL_VERSION (0x01)
 *    bytes[1..16]  = tempId.bytes (16 random bytes, rotated every 10 min)
 *
 *  Device name:      NOT included (requirement 5 — no permanent identifiers)
 *  TX power:         NOT included
 *
 *  Parsed by scanner:
 *    manufacturerData buffer layout (from react-native-ble-plx):
 *      bytes[0..1]  = company ID (0x50, 0x48 = 0x4850 LE)
 *      bytes[2]     = protocol version
 *      bytes[3..18] = tempId (16 bytes)
 *
 * ─── iOS notes ────────────────────────────────────────────────────────────────
 *  Uses CBPeripheralManager via react-native-ble-advertiser.
 *  Foreground: Full advertisement including service UUID.
 *  Background: Only service UUID (Apple restricts manufacturer data in bg).
 *  Peripheral mode does NOT conflict with CBCentralManager (scanner).
 *
 * ─── Android notes ────────────────────────────────────────────────────────────
 *  Uses BluetoothLeAdvertiser.
 *  Requires BLUETOOTH_ADVERTISE permission (API 31+).
 *  Not all Android devices support peripheral mode — checked via supportPeripheral().
 *
 * ─── DOES NOT ────────────────────────────────────────────────────────────────
 *  ✗ Serve a GATT server (that is the next milestone).
 *  ✗ Include the user's name, phone, GPS, or permanent profile.id.
 *  ✗ Advertise arbitrary Bluetooth data.
 */

import { Platform } from 'react-native';
import BLEAdvertiser from 'react-native-ble-advertiser';
import {
  HOP_SERVICE_UUID,
  HOP_BLE_PROTOCOL_VERSION,
  HOP_COMPANY_ID,
} from './constants';
import type { TempId } from './tempId';

export type AdvertisingStatus =
  | 'advertising'
  | 'stopped'
  | 'unsupported'
  | 'unauthorized'
  | 'unavailable'
  | 'error';

export interface AdvertisingState {
  status: AdvertisingStatus;
  currentTempId: TempId | null;
  nextRotationAt: number;
}

export class HopBleAdvertiser {
  private _advertising = false;

  async isSupported(): Promise<boolean> {
    try {
      return await BLEAdvertiser.supportPeripheral();
    } catch {
      return false;
    }
  }

  /**
   * Start advertising the HOP service with the given tempId.
   *
   * Call again with a new tempId when the epoch rotates —
   * stop() + start() restarts the advertisement with fresh data.
   */
  async start(tempId: TempId): Promise<AdvertisingStatus> {
    try {
      // Build the manufacturer data payload.
      // react-native-ble-advertiser prepends the company ID (2 bytes) automatically.
      const payload = [
        HOP_BLE_PROTOCOL_VERSION,    // byte[0]: protocol version
        ...Array.from(tempId.bytes), // bytes[1..16]: rotating temp ID
      ];

      if (Platform.OS === 'android') {
        BLEAdvertiser.setCompanyId(HOP_COMPANY_ID);
        await BLEAdvertiser.broadcast(HOP_SERVICE_UUID, payload, {
          advertiseMode: BLEAdvertiser.ADVERTISE_MODE_BALANCED,
          txPowerLevel: BLEAdvertiser.ADVERTISE_TX_POWER_MEDIUM,
          connectable: false,          // discovery only — no GATT server yet
          includeDeviceName: false,    // requirement 5: no permanent identifiers
          includeTxPowerLevel: false,
        });
      } else {
        // iOS: CBPeripheralManager handles company ID differently.
        // The service UUID is the primary discovery signal on iOS.
        await BLEAdvertiser.broadcast(HOP_SERVICE_UUID, payload, {
          connectable: false,
          includeDeviceName: false,
        });
      }

      this._advertising = true;
      return 'advertising';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unauthori') || msg.includes('permission')) {
        return 'unauthorized';
      }
      if (msg.includes('disabled') || msg.includes('off') || msg.includes('unavail')) {
        return 'unavailable';
      }
      console.warn('[HOP BLE Advertiser] start() error:', msg);
      return 'error';
    }
  }

  async stop(): Promise<void> {
    if (!this._advertising) return;
    try {
      await BLEAdvertiser.stopBroadcast();
      this._advertising = false;
    } catch (err) {
      // Ignore stop errors — the radio state change will clean up.
    }
  }

  get isAdvertising(): boolean {
    return this._advertising;
  }
}

/** Singleton — one advertiser per process. */
export const hopBleAdvertiser = new HopBleAdvertiser();
