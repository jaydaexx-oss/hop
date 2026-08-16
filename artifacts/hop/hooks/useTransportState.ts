/**
 * useTransportState — single transport decision point for chat screens.
 *
 * Priority (mirrors transportManager.ts PRIORITY array):
 *   1. Bluetooth  — peer has been verified over BLE via useBluetoothDiscovery
 *   2. Internet   — no BLE peer but device is online
 *   3. Queued     — neither; messages sit in the TransportManager retry queue
 *
 * ─── Simulation boundary ──────────────────────────────────────────────────────
 *
 * The Radar screen's nearbyUsers state is a SIMULATION for demo purposes.
 * It is intentionally NOT used here.  Transport decisions are based solely on:
 *   • verifiedBlePeers — profile IDs confirmed via real BLE GATT reads
 *   • isOnline         — browser/OS network connectivity
 *
 * On physical devices running a development build, verifiedBlePeers will be
 * populated by useBluetoothDiscovery.native.ts when actual HOP peripherals are
 * detected.  In the web preview and Expo Go, it is always empty and transport
 * falls through to internet or queued.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useHop } from '@/context/HopContext';
import { resolveTransport } from '@/protocol/transport-decision';

// ─── Re-export for consumers that import from this module ─────────────────────
export { resolveTransport } from '@/protocol/transport-decision';
export type { TransportKind } from '@/protocol/transport-decision';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransportState {
  kind: import('@/protocol/transport-decision').TransportKind;
  /** Human-readable label shown in the chat header */
  label: string;
  /** True when messages are queued waiting for connectivity */
  hasQueue: boolean;
  /** RSSI-derived signal strength 0–100 (meaningful only for bluetooth) */
  signal: number;
}

// ─── Internet detection ───────────────────────────────────────────────────────

function getIsOnlineNow(): boolean {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    return navigator.onLine;
  }
  // On native, assume connected until NetInfo is wired.
  // The BLE path is the interesting one on device; internet fallback is safe-default.
  return true;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTransportState(peerId: string | undefined): TransportState {
  // verifiedBlePeers comes from useBluetoothDiscovery (via HopContext).
  // On web/Expo Go it is always an empty Set.
  // On a real device with a dev build it reflects actual BLE peer discovery.
  const { verifiedBlePeers, nearbyUsers } = useHop();
  const [isOnline, setIsOnline] = useState(getIsOnlineNow);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const up   = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online',  up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online',  up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const kind = resolveTransport(peerId, verifiedBlePeers, isOnline);

  // For bluetooth, surface the signal strength from the BLE peer if available.
  // Falls back to the simulated nearbyUsers signal for demo mode.
  const bleSignal =
    kind === 'bluetooth'
      ? (nearbyUsers.find(u => u.id === peerId)?.signal ?? 80)
      : 0;

  return {
    kind,
    label: kind === 'bluetooth' ? 'Bluetooth' : kind === 'internet' ? 'Internet' : 'No connection',
    hasQueue: kind === 'queued',
    signal: bleSignal,
  };
}
