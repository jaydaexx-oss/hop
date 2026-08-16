/**
 * useBluetoothDiscovery — real BLE scanning hook for iOS and Android.
 *
 * ─── What changed from the previous PoC version ──────────────────────────────
 *
 * The previous version attempted a GATT connect → read characteristics flow.
 * That worked only if the discovered device was serving the HOP GATT server,
 * which was not yet implemented.
 *
 * This version uses advertisement-data parsing instead:
 *   • No GATT connection is made during discovery.
 *   • The peer's tempId and protocol version are extracted from manufacturer
 *     data in the advertisement packet — no connect required.
 *   • This is faster (no round-trip), uses less power, and correctly matches
 *     the advertising format emitted by useBluetoothAdvertising.native.ts.
 *
 * ─── What this hook does ──────────────────────────────────────────────────────
 *
 *  1. Requests BLE permissions (Android runtime; iOS automatic via CBManager).
 *  2. Monitors the BLE radio state (on / off / unauthorized).
 *  3. Scans ONLY for devices advertising HOP_SERVICE_UUID (requirement 8).
 *  4. For each advertisement packet:
 *     a. Parses manufacturerData (base64 from react-native-ble-plx).
 *     b. Validates company ID (must be HOP_COMPANY_ID = 0x4850).
 *     c. Validates protocol version (must be HOP_BLE_PROTOCOL_VERSION).
 *     d. Extracts 16-byte tempId.
 *     e. Adds device to discoveredHopPeers (state = 'discovered').
 *  5. Maintains a TTL — removes stale peers after HOP_PEER_TTL_MS.
 *  6. Re-scans on a timer.
 *
 * ─── DOES NOT ─────────────────────────────────────────────────────────────────
 *
 *  ✗ Connect to discovered devices (GATT connect is the auth milestone).
 *  ✗ Add peers to verifiedBlePeers (requires profileId from GATT read).
 *  ✗ Track non-HOP Bluetooth devices.
 *  ✗ Store device MAC addresses.
 *  ✗ Treat discovery as authentication (requirement 11).
 *
 * ─── Discovery vs Authentication (requirement 10) ─────────────────────────────
 *
 *  discovered    = advertisement seen + valid HOP manufacturer data
 *  connected     = GATT link established (not in this PoC)
 *  authenticated = GATT + profile.id exchange verified (not in this PoC)
 *
 * ─── Expo Go compatibility ────────────────────────────────────────────────────
 *
 *  react-native-ble-plx is a third-party native module not bundled in Expo Go.
 *  We guard its import with a try/require so the hook can return 'unsupported'
 *  instead of crashing the app when run in Expo Go or any environment that
 *  lacks the native binding.  A development build is required for actual BLE.
 *
 * See docs/BLE_IMPLEMENTATION.md for platform limitations and test procedure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBleManager, BleState } from '@/protocol/ble/bleManager';
import {
  HOP_SERVICE_UUID,
  HOP_SCAN_TIMEOUT_MS,
  HOP_RESCAN_INTERVAL_MS,
  HOP_PEER_TTL_MS,
} from '@/protocol/ble/constants';
import { requestBlePermissions } from '@/protocol/ble/permissions';
import { bluetoothTransport } from '@/protocol/ble/BluetoothTransport';
import { parseHopAdvertisement } from '@/protocol/ble/parseHopAdvertisement';

import type {
  BleDiscoveryState,
  BleDiscoveryStatus,
  DiscoveredHopPeer,
} from './useBluetoothDiscovery';
export type { BleDiscoveryState, BleDiscoveryStatus, DiscoveredHopPeer };

// BleManager singleton lives in protocol/ble/bleManager.ts (shared with auth
// hook). Returns null in Expo Go / Jest (Expo Go guard is in that module).

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBluetoothDiscovery(): BleDiscoveryState {
  // manager is null when the native module is unavailable OR when BleManager
  // construction failed (Expo Go: JS package present, native binding absent).
  // MUST be called before any useState so that _managerInitFailed is set
  // before the initial status value is evaluated (Babel hoists `var manager`
  // to the function scope, so referencing it before this line yields
  // `undefined` rather than `null`, breaking the 'unsupported' guard).
  const manager = getBleManager();

  const [status, setStatus] = useState<BleDiscoveryStatus>(
    // 'unsupported' when the native module is absent OR when BleManager
    // construction failed (Expo Go path: JS package present, binding absent).
    // manager === null is the definitive signal after getBleManager() runs.
    manager !== null ? 'idle' : 'unsupported',
  );
  const [verifiedBlePeers] = useState<ReadonlySet<string>>(new Set<string>());
  const [discoveredHopPeers, setDiscoveredHopPeers] = useState<
    ReadonlyMap<string, DiscoveredHopPeer>
  >(new Map());

  const peerMap = useRef(new Map<string, DiscoveredHopPeer>());
  const scanTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rescanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttlTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Publish peer map ──────────────────────────────────────────────────────
  const publishPeers = useCallback(() => {
    setDiscoveredHopPeers(new Map(peerMap.current));
    // verifiedBlePeers stays empty until GATT auth milestone.
    bluetoothTransport.setVerifiedPeers(new Set<string>());
  }, []);

  // ── TTL sweep ─────────────────────────────────────────────────────────────
  const expireStale = useCallback(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of peerMap.current) {
      if (now - peer.lastSeenAt > HOP_PEER_TTL_MS) {
        peerMap.current.delete(id);
        changed = true;
      }
    }
    if (changed) publishPeers();
  }, [publishPeers]);

  // ── Start scan window ─────────────────────────────────────────────────────
  const startScan = useCallback(() => {
    if (!manager) return;
    setStatus('scanning');

    manager.startDeviceScan(
      [HOP_SERVICE_UUID],      // requirement 8: filter to HOP only
      { allowDuplicates: true },
      (error: any, device: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (error) {
          console.warn('[HOP BLE Discovery] Scan error:', error.message);
          setStatus('unavailable');
          return;
        }
        if (!device) return;

        const parsed = parseHopAdvertisement(device.manufacturerData);
        if (!parsed) {
          // Device advertises HOP_SERVICE_UUID but no valid manufacturer data.
          // Could be an older HOP version or a misconfigured device — skip.
          return;
        }

        const now = Date.now();
        const existing = peerMap.current.get(device.id);

        peerMap.current.set(device.id, {
          deviceId: device.id,
          tempIdHex: parsed.tempIdHex,
          rssi: device.rssi ?? -100,
          protocolVersion: parsed.protocolVersion,
          firstSeenAt: existing?.firstSeenAt ?? now,
          lastSeenAt: now,
          authState: 'discovered',
        });

        publishPeers();
      },
    );

    // Auto-stop after scan window.
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => {
      manager.stopDeviceScan();
      setStatus('idle');
    }, HOP_SCAN_TIMEOUT_MS);
  }, [manager, publishPeers]);

  // ── Stop everything ───────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    if (!manager) return;
    manager.stopDeviceScan();
    if (scanTimer.current)   clearTimeout(scanTimer.current);
    if (rescanTimer.current) clearInterval(rescanTimer.current);
    if (ttlTimer.current)    clearInterval(ttlTimer.current);
    setStatus('idle');
  }, [manager]);

  // ── Main effect ───────────────────────────────────────────────────────────
  useEffect(() => {
    // Skip entirely when the native BLE module is unavailable (Expo Go, Jest).
    if (!manager) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stateSubscription: any = null;
    let initialised = false;

    const init = async () => {
      const perm = await requestBlePermissions();
      if (perm === 'denied')      { setStatus('unauthorized'); return; }
      if (perm === 'unsupported') { setStatus('unsupported');  return; }

      stateSubscription = manager.onStateChange((state: string) => {
        const S = BleState;
        if (state === S.PoweredOn) {
          if (!initialised) {
            initialised = true;
            startScan();
            rescanTimer.current = setInterval(
              startScan,
              HOP_SCAN_TIMEOUT_MS + HOP_RESCAN_INTERVAL_MS,
            );
            ttlTimer.current = setInterval(expireStale, HOP_PEER_TTL_MS / 3);
          }
        } else if (state === S.PoweredOff) {
          stopAll(); setStatus('off'); initialised = false;
        } else if (state === S.Unauthorized) {
          stopAll(); setStatus('unauthorized');
        } else {
          stopAll(); setStatus('unavailable');
        }
      }, true);
    };

    init();
    return () => {
      stopAll();
      stateSubscription?.remove();
    };
  }, [manager, startScan, expireStale, stopAll]);

  return { status, verifiedBlePeers, discoveredHopPeers };
}
