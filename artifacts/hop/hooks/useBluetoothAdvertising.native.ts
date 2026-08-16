/**
 * useBluetoothAdvertising — iOS and Android real BLE advertising hook.
 *
 * Manages the advertising lifecycle:
 *   1. Generates a tempId for the current rotation epoch.
 *   2. Starts advertising via hopBleAdvertiser.start(tempId).
 *   3. Rotates the tempId at each epoch boundary (every 10 minutes).
 *   4. Exposes status, myTempIdHex, and a countdown to rotation.
 *   5. Stops advertising cleanly on unmount.
 *
 * Separation of concerns
 * ─────────────────────
 * This hook ONLY handles advertising.  Scanning is in useBluetoothDiscovery.
 * The two can run simultaneously — iOS CBCentralManager + CBPeripheralManager
 * and Android's scanner + advertiser are independent subsystems.
 *
 * Privacy
 * ───────
 * The advertised tempId rotates every 10 minutes.  It does NOT contain the
 * user's profile.id, name, or any permanent identifier.
 *
 * See docs/BLE_IMPLEMENTATION.md for full platform limitations.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createTempId,
  isExpiredTempId,
  msUntilRotation,
  bytesToHex,
} from '@/protocol/ble/tempId';
import { hopBleAdvertiser } from '@/protocol/ble/HopBleAdvertiser';
import type { TempId } from '@/protocol/ble/tempId';
import type { AdvertisingStatus } from '@/protocol/ble/HopBleAdvertiser';

export type { AdvertisingStatus };

export interface BluetoothAdvertisingState {
  status: AdvertisingStatus;
  myTempIdHex: string | null;
  nextRotationAt: number;
  secondsUntilRotation: number;
  startAdvertising: () => Promise<void>;
  stopAdvertising: () => Promise<void>;
}

export function useBluetoothAdvertising(): BluetoothAdvertisingState {
  const [status, setStatus] = useState<AdvertisingStatus>('stopped');
  const [currentTempId, setCurrentTempId] = useState<TempId | null>(null);
  const [secondsUntilRotation, setSecondsUntilRotation] = useState(0);

  const rotationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false); // true when advertising is desired

  // ── Countdown ticker ──────────────────────────────────────────────────────
  const startCountdown = useCallback((tempId: TempId) => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    const tick = () => {
      const remaining = Math.max(0, Math.ceil(msUntilRotation() / 1000));
      setSecondsUntilRotation(remaining);
    };
    tick();
    countdownTimer.current = setInterval(tick, 1_000);
  }, []);

  // ── Start one advertisement cycle ─────────────────────────────────────────
  const advertiseOnce = useCallback(async () => {
    const tempId = createTempId();
    setCurrentTempId(tempId);

    const result = await hopBleAdvertiser.start(tempId);
    setStatus(result);

    if (result !== 'advertising') {
      activeRef.current = false;
      return;
    }

    startCountdown(tempId);

    // Schedule rotation at epoch boundary + a small buffer.
    const delay = msUntilRotation() + 50;
    if (rotationTimer.current) clearTimeout(rotationTimer.current);
    rotationTimer.current = setTimeout(async () => {
      if (!activeRef.current) return;
      await hopBleAdvertiser.stop();
      await advertiseOnce(); // restart with fresh tempId
    }, delay);
  }, [startCountdown]);

  // ── Public controls ───────────────────────────────────────────────────────
  const startAdvertising = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    await advertiseOnce();
  }, [advertiseOnce]);

  const stopAdvertising = useCallback(async () => {
    activeRef.current = false;
    if (rotationTimer.current) clearTimeout(rotationTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    await hopBleAdvertiser.stop();
    setStatus('stopped');
    setCurrentTempId(null);
    setSecondsUntilRotation(0);
  }, []);

  // ── Auto-start on mount, clean up on unmount ──────────────────────────────
  useEffect(() => {
    startAdvertising();
    return () => {
      // Cleanup: stop advertising but don't await (effect cleanup is sync).
      activeRef.current = false;
      if (rotationTimer.current) clearTimeout(rotationTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      hopBleAdvertiser.stop().catch(() => {});
    };
  }, [startAdvertising]);

  return {
    status,
    myTempIdHex: currentTempId ? bytesToHex(currentTempId.bytes) : null,
    nextRotationAt: currentTempId?.expiresAt ?? 0,
    secondsUntilRotation,
    startAdvertising,
    stopAdvertising,
  };
}
