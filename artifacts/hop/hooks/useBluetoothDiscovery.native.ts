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
 * See docs/BLE_IMPLEMENTATION.md for platform limitations and test procedure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BleManager, State as BleState } from 'react-native-ble-plx';
import {
  HOP_SERVICE_UUID,
  HOP_BLE_PROTOCOL_VERSION,
  HOP_COMPANY_ID,
  HOP_SCAN_TIMEOUT_MS,
  HOP_RESCAN_INTERVAL_MS,
  HOP_PEER_TTL_MS,
  MFR_OFFSET_COMPANY_ID,
  MFR_OFFSET_VERSION,
  MFR_OFFSET_TEMP_ID,
  MFR_TEMP_ID_LENGTH,
} from '@/protocol/ble/constants';
import { requestBlePermissions } from '@/protocol/ble/permissions';
import { bluetoothTransport } from '@/protocol/ble/BluetoothTransport';
import { bytesToHex } from '@/protocol/ble/tempId';

import type {
  BleDiscoveryState,
  BleDiscoveryStatus,
  DiscoveredHopPeer,
} from './useBluetoothDiscovery';
export type { BleDiscoveryState, BleDiscoveryStatus, DiscoveredHopPeer };

// ─── BleManager singleton ─────────────────────────────────────────────────────
let _manager: BleManager | null = null;
function getManager(): BleManager {
  if (!_manager) _manager = new BleManager();
  return _manager;
}

// ─── Advertisement data parser ────────────────────────────────────────────────

interface ParsedHopAdvertisement {
  tempIdHex: string;
  protocolVersion: number;
}

/**
 * Parses a base64-encoded manufacturer data string from react-native-ble-plx.
 *
 * Expected buffer layout (from BLE spec + HOP_COMPANY_ID convention):
 *   bytes[0..1]  = company ID, uint16 little-endian (must be HOP_COMPANY_ID)
 *   bytes[2]     = HOP protocol version
 *   bytes[3..18] = tempId (16 bytes)
 *
 * Returns null if the data is absent, too short, or not from a HOP device.
 */
function parseHopAdvertisement(
  manufacturerDataBase64: string | null | undefined,
): ParsedHopAdvertisement | null {
  if (!manufacturerDataBase64) return null;

  let buf: Buffer;
  try {
    buf = Buffer.from(manufacturerDataBase64, 'base64');
  } catch {
    return null;
  }

  const minLen = MFR_OFFSET_TEMP_ID + MFR_TEMP_ID_LENGTH;
  if (buf.length < minLen) return null;

  // Validate company ID (little-endian uint16).
  const companyId = buf.readUInt16LE(MFR_OFFSET_COMPANY_ID);
  if (companyId !== HOP_COMPANY_ID) return null;

  // Validate protocol version.
  const protocolVersion = buf[MFR_OFFSET_VERSION];
  if (protocolVersion !== HOP_BLE_PROTOCOL_VERSION) return null;

  // Extract tempId bytes.
  const tempIdBytes = new Uint8Array(
    buf.buffer,
    buf.byteOffset + MFR_OFFSET_TEMP_ID,
    MFR_TEMP_ID_LENGTH,
  );

  return {
    tempIdHex: bytesToHex(tempIdBytes),
    protocolVersion,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBluetoothDiscovery(): BleDiscoveryState {
  const [status, setStatus] = useState<BleDiscoveryStatus>('idle');
  const [verifiedBlePeers] = useState<ReadonlySet<string>>(new Set<string>());
  const [discoveredHopPeers, setDiscoveredHopPeers] = useState<
    ReadonlyMap<string, DiscoveredHopPeer>
  >(new Map());

  const peerMap = useRef(new Map<string, DiscoveredHopPeer>());
  const scanTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rescanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttlTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const manager = getManager();

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
    setStatus('scanning');

    manager.startDeviceScan(
      [HOP_SERVICE_UUID],      // requirement 8: filter to HOP only
      { allowDuplicates: true },
      (error, device) => {
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
    manager.stopDeviceScan();
    if (scanTimer.current)   clearTimeout(scanTimer.current);
    if (rescanTimer.current) clearInterval(rescanTimer.current);
    if (ttlTimer.current)    clearInterval(ttlTimer.current);
    setStatus('idle');
  }, [manager]);

  // ── Main effect ───────────────────────────────────────────────────────────
  useEffect(() => {
    let stateSubscription: ReturnType<typeof manager.onStateChange> | null = null;
    let initialised = false;

    const init = async () => {
      const perm = await requestBlePermissions();
      if (perm === 'denied')      { setStatus('unauthorized'); return; }
      if (perm === 'unsupported') { setStatus('unsupported');  return; }

      stateSubscription = manager.onStateChange((state: BleState) => {
        if (state === BleState.PoweredOn) {
          if (!initialised) {
            initialised = true;
            startScan();
            rescanTimer.current = setInterval(
              startScan,
              HOP_SCAN_TIMEOUT_MS + HOP_RESCAN_INTERVAL_MS,
            );
            ttlTimer.current = setInterval(expireStale, HOP_PEER_TTL_MS / 3);
          }
        } else if (state === BleState.PoweredOff) {
          stopAll(); setStatus('off'); initialised = false;
        } else if (state === BleState.Unauthorized) {
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
