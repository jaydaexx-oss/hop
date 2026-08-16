import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useHop } from '@/context/HopContext';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransportKind = 'bluetooth' | 'internet' | 'queued';

export interface TransportState {
  kind: TransportKind;
  /** Human-readable label shown in the chat header */
  label: string;
  /** True when messages are queued waiting for connectivity */
  hasQueue: boolean;
  /** Signal strength 0-100 (meaningful only for bluetooth) */
  signal: number;
}

// ─── Internet detection ───────────────────────────────────────────────────────
//
// On web we can read navigator.onLine directly and listen to online/offline.
// On native, expo-modules / NetInfo isn't wired up yet so we default to true
// (the transport simulation via nearbyUsers is the interesting part anyway).

function getIsOnlineNow(): boolean {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    return navigator.onLine;
  }
  return true; // assume connected on native until NetInfo is wired
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Derives the active transport for a 1-to-1 conversation.
 *
 * Priority mirrors the protocol layer: BLE > Internet > Queued.
 *
 * @param peerId  The userId of the conversation partner.
 */
export function useTransportState(peerId: string | undefined): TransportState {
  const { nearbyUsers } = useHop();
  const [isOnline, setIsOnline] = useState(getIsOnlineNow);

  // Listen to browser online/offline events on web.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const nearPeer = peerId ? nearbyUsers.find(u => u.id === peerId) : undefined;
  const isNearby = !!nearPeer;

  if (isNearby) {
    return {
      kind: 'bluetooth',
      label: 'Bluetooth',
      hasQueue: false,
      signal: nearPeer?.signal ?? 80,
    };
  }

  if (isOnline) {
    return { kind: 'internet', label: 'Internet', hasQueue: false, signal: 0 };
  }

  return { kind: 'queued', label: 'No connection', hasQueue: true, signal: 0 };
}
