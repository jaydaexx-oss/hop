/**
 * useBluetoothDiscovery — real BLE scanning hook for iOS and Android.
 *
 * ─── What this hook does ──────────────────────────────────────────────────────
 *
 *  1. Requests BLE permissions (Android runtime; iOS automatic via CBManager).
 *  2. Monitors the BLE radio state (on/off/unauthorized).
 *  3. Scans for peripherals advertising HOP_SERVICE_UUID.
 *  4. For each discovered device:
 *     a. Connects to it.
 *     b. Reads HOP_PEER_ID_CHAR  → peer's profile.id.
 *     c. Reads HOP_VERSION_CHAR  → peer's protocol version.
 *     d. Verifies version == HOP_BLE_PROTOCOL_VERSION.
 *     e. Disconnects immediately (no persistent connection in PoC).
 *     f. Adds the profile.id to verifiedBlePeers with a TTL timestamp.
 *  5. Re-scans on HOP_RESCAN_INTERVAL_MS timer.
 *  6. Expires stale peers after HOP_PEER_TTL_MS.
 *  7. Updates bluetoothTransport.setVerifiedPeers() on every change so the
 *     TransportManager's isAvailable() stays in sync.
 *
 * ─── DOES NOT ─────────────────────────────────────────────────────────────────
 *
 *  ✗ Track arbitrary Bluetooth devices.
 *  ✗ Connect to devices that do not advertise HOP_SERVICE_UUID.
 *  ✗ Store or log device MAC addresses.
 *  ✗ Send messages (discovery PoC only — see BluetoothTransport.native.ts).
 *
 * ─── Platform notes ───────────────────────────────────────────────────────────
 *
 *  iOS:   Requires a DEVELOPMENT BUILD (not Expo Go).
 *         Peripheral mode requires the app to be in the foreground or have
 *         the bluetooth-central background mode entitlement.
 *         The system randomises MAC addresses; use the CBPeripheral UUID instead.
 *
 *  Android: Requires BLUETOOTH_SCAN + BLUETOOTH_CONNECT (API 31+) or
 *           ACCESS_FINE_LOCATION (API ≤ 30).  See permissions.native.ts.
 *           Background scanning is limited after Android 8 (Oreo).
 *
 *  See docs/BLE_IMPLEMENTATION.md for the full testing procedure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BleManager, State as BleState } from 'react-native-ble-plx';
import {
  HOP_SERVICE_UUID,
  HOP_PEER_ID_CHAR,
  HOP_VERSION_CHAR,
  HOP_BLE_PROTOCOL_VERSION,
  HOP_SCAN_TIMEOUT_MS,
  HOP_RESCAN_INTERVAL_MS,
  HOP_PEER_TTL_MS,
  HOP_CONNECT_TIMEOUT_MS,
} from '@/protocol/ble/constants';
import { requestBlePermissions } from '@/protocol/ble/permissions';
import { bluetoothTransport } from '@/protocol/ble/BluetoothTransport';

import type { BleDiscoveryState, BleDiscoveryStatus } from './useBluetoothDiscovery';
export type { BleDiscoveryState, BleDiscoveryStatus };

// ─── Module-level BleManager singleton ───────────────────────────────────────
// react-native-ble-plx requires exactly one BleManager per process.
let _manager: BleManager | null = null;
function getManager(): BleManager {
  if (!_manager) _manager = new BleManager();
  return _manager;
}

// ─── Peer TTL tracking ────────────────────────────────────────────────────────
interface PeerEntry {
  profileId: string;
  lastSeenAt: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBluetoothDiscovery(): BleDiscoveryState {
  const [status, setStatus] = useState<BleDiscoveryStatus>('idle');
  const [verifiedBlePeers, setVerifiedBlePeers] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );

  // Internal TTL map: deviceId → PeerEntry
  const peerMap = useRef(new Map<string, PeerEntry>());
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rescanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttlTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const manager = getManager();

  // ── Publish peer set ──────────────────────────────────────────────────────
  const publishPeers = useCallback(() => {
    const ids = new Set(
      Array.from(peerMap.current.values()).map(e => e.profileId),
    );
    setVerifiedBlePeers(ids);
    bluetoothTransport.setVerifiedPeers(ids);
  }, []);

  // ── Expire stale peers ────────────────────────────────────────────────────
  const expireStale = useCallback(() => {
    const now = Date.now();
    let changed = false;
    for (const [deviceId, entry] of peerMap.current) {
      if (now - entry.lastSeenAt > HOP_PEER_TTL_MS) {
        peerMap.current.delete(deviceId);
        changed = true;
      }
    }
    if (changed) publishPeers();
  }, [publishPeers]);

  // ── Verify a discovered device ────────────────────────────────────────────
  const verifyDevice = useCallback(async (deviceId: string) => {
    const timeoutId = setTimeout(() => {
      manager.cancelDeviceConnection(deviceId).catch(() => {});
    }, HOP_CONNECT_TIMEOUT_MS);

    try {
      const device = await manager.connectToDevice(deviceId, {
        autoConnect: false,
      });
      await device.discoverAllServicesAndCharacteristics();

      // Read protocol version first — reject mismatches early.
      const versionChar = await device.readCharacteristicForService(
        HOP_SERVICE_UUID,
        HOP_VERSION_CHAR,
      );
      if (versionChar.value) {
        const versionBytes = Buffer.from(versionChar.value, 'base64');
        const version = versionBytes[0];
        if (version !== HOP_BLE_PROTOCOL_VERSION) {
          console.log(
            `[HOP BLE] Device ${deviceId} speaks protocol v${version}, we need v${HOP_BLE_PROTOCOL_VERSION}. Skipping.`,
          );
          await device.cancelConnection();
          return;
        }
      }

      // Read the peer's profile ID.
      const idChar = await device.readCharacteristicForService(
        HOP_SERVICE_UUID,
        HOP_PEER_ID_CHAR,
      );
      if (!idChar.value) {
        await device.cancelConnection();
        return;
      }

      const profileId = Buffer.from(idChar.value, 'base64').toString('utf-8').trim();
      if (!profileId || profileId.length < 8) {
        // Reject malformed IDs.
        await device.cancelConnection();
        return;
      }

      // Verified HOP peer.
      peerMap.current.set(deviceId, { profileId, lastSeenAt: Date.now() });
      publishPeers();

      await device.cancelConnection();
    } catch (err) {
      // Connection failed — not necessarily an error; the device may have moved away.
      // Silently ignore; the device won't be added to verifiedBlePeers.
    } finally {
      clearTimeout(timeoutId);
    }
  }, [manager, publishPeers]);

  // ── Start a scan window ───────────────────────────────────────────────────
  const startScan = useCallback(() => {
    setStatus('scanning');

    manager.startDeviceScan(
      [HOP_SERVICE_UUID], // Only scan for HOP peripherals — requirement #8.
      { allowDuplicates: true },
      (error, device) => {
        if (error) {
          console.warn('[HOP BLE] Scan error:', error.message);
          setStatus('unavailable');
          return;
        }
        if (!device) return;

        // Refresh TTL for already-verified devices without reconnecting.
        const existing = peerMap.current.get(device.id);
        if (existing) {
          peerMap.current.set(device.id, { ...existing, lastSeenAt: Date.now() });
          publishPeers();
          return;
        }

        // New device — verify it out-of-band to avoid blocking the scan callback.
        verifyDevice(device.id);
      },
    );

    // Auto-stop after timeout to save battery.
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => {
      manager.stopDeviceScan();
      setStatus('idle');
    }, HOP_SCAN_TIMEOUT_MS);
  }, [manager, publishPeers, verifyDevice]);

  // ── Stop everything ───────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    manager.stopDeviceScan();
    if (scanTimer.current) clearTimeout(scanTimer.current);
    if (rescanTimer.current) clearInterval(rescanTimer.current);
    if (ttlTimer.current) clearInterval(ttlTimer.current);
    setStatus('idle');
  }, [manager]);

  // ── Main effect: monitor radio state, start scanning ─────────────────────
  useEffect(() => {
    let stateSubscription: ReturnType<typeof manager.onStateChange> | null = null;
    let initialised = false;

    const init = async () => {
      const permissionStatus = await requestBlePermissions();
      if (permissionStatus === 'denied') {
        setStatus('unauthorized');
        return;
      }
      if (permissionStatus === 'unsupported') {
        setStatus('unsupported');
        return;
      }

      stateSubscription = manager.onStateChange((state: BleState) => {
        if (state === BleState.PoweredOn) {
          if (!initialised) {
            initialised = true;
            startScan();
            // Periodic re-scan.
            rescanTimer.current = setInterval(startScan, HOP_SCAN_TIMEOUT_MS + HOP_RESCAN_INTERVAL_MS);
            // Periodic TTL sweep.
            ttlTimer.current = setInterval(expireStale, HOP_PEER_TTL_MS / 3);
          }
        } else if (state === BleState.PoweredOff) {
          stopAll();
          setStatus('off');
          initialised = false;
        } else if (state === BleState.Unauthorized) {
          stopAll();
          setStatus('unauthorized');
        } else {
          stopAll();
          setStatus('unavailable');
        }
      }, true /* emit current state immediately */);
    };

    init();

    return () => {
      stopAll();
      stateSubscription?.remove();
    };
  }, [manager, startScan, expireStale, stopAll]);

  return { status, verifiedBlePeers };
}
