/**
 * useBluetoothAuthentication — BLE peer authentication via GATT.
 *
 * ─── What this hook does ──────────────────────────────────────────────────────
 *
 * Watches the `discoveredHopPeers` map from `useBluetoothDiscovery` and, for
 * each newly-discovered peer, performs a GATT handshake:
 *
 *   1. Connect to the discovered device via BLE.
 *   2. Discover services and characteristics.
 *   3. Read HOP_VERSION_CHAR — reject peers with incompatible versions.
 *   4. Read HOP_PEER_ID_CHAR — extract the peer's profile.id.
 *   5. Disconnect.
 *   6. Add the peer to `verifiedBlePeers` (Set<profileId>) and
 *      `peerDeviceMap` (Map<profileId, deviceId>).
 *
 * Result:
 *   - `verifiedBlePeers` → fed into the transport decision (BLE vs internet).
 *   - `peerDeviceMap`   → used by BluetoothTransport.send() to connect to the
 *     correct device when sending a message.
 *
 * ─── DOES NOT ─────────────────────────────────────────────────────────────────
 *
 *   ✗ Keep GATT connections open (connect-read-disconnect only).
 *   ✗ Validate cryptographic signatures (that is the next milestone after this).
 *   ✗ Handle chunked reads (profile.id is 36 bytes — well within default MTU).
 *
 * ─── Concurrency ──────────────────────────────────────────────────────────────
 *
 * At most MAX_CONCURRENT_AUTH peers are authenticated simultaneously to avoid
 * saturating the BLE hardware.  Additional peers are queued and processed when
 * a slot frees up.
 *
 * ─── Peer TTL ────────────────────────────────────────────────────────────────
 *
 * Verified peers are evicted from `verifiedBlePeers` when they disappear from
 * `discoveredHopPeers` (discovery TTL expired in the scan hook).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Device } from 'react-native-ble-plx';
import { getBleManager } from '@/protocol/ble/bleManager';
import {
  HOP_SERVICE_UUID,
  HOP_PEER_ID_CHAR,
  HOP_VERSION_CHAR,
  HOP_BLE_PROTOCOL_VERSION,
  HOP_CONNECT_TIMEOUT_MS,
} from '@/protocol/ble/constants';
import type { DiscoveredHopPeer } from './useBluetoothDiscovery';

import type { BleAuthState } from './useBluetoothAuthentication';
export type { BleAuthState };

const MAX_CONCURRENT_AUTH = 3;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBluetoothAuthentication(
  discoveredPeers: ReadonlyMap<string, DiscoveredHopPeer>,
): BleAuthState {
  const [verifiedBlePeers, setVerifiedBlePeers] = useState<ReadonlySet<string>>(new Set());
  const [peerDeviceMap, setPeerDeviceMap] = useState<ReadonlyMap<string, string>>(new Map());
  const [connectingCount, setConnectingCount] = useState(0);

  // Internal mutable maps — mutated in async callbacks, published via setState.
  const verifiedRef = useRef(new Map<string, string>()); // deviceId → profileId
  const connectingSet = useRef(new Set<string>());       // deviceIds currently being authed

  const manager = getBleManager();

  // ── Publish state ────────────────────────────────────────────────────────
  const publish = useCallback(() => {
    const profileIds = new Set(verifiedRef.current.values());
    const deviceMap = new Map<string, string>();
    for (const [deviceId, profileId] of verifiedRef.current) {
      deviceMap.set(profileId, deviceId);
    }
    setVerifiedBlePeers(profileIds);
    setPeerDeviceMap(deviceMap);
  }, []);

  // ── Authenticate a single peer ───────────────────────────────────────────
  const authenticatePeer = useCallback(
    async (peer: DiscoveredHopPeer): Promise<void> => {
      const { deviceId } = peer;
      let device: Device | null = null;

      try {
        setConnectingCount(c => c + 1);

        device = await manager.connectToDevice(deviceId, {
          timeout: HOP_CONNECT_TIMEOUT_MS,
          autoConnect: false,
        });

        await device.discoverAllServicesAndCharacteristics();

        // ── Version gate ──────────────────────────────────────────────────
        const versionChar = await device.readCharacteristicForService(
          HOP_SERVICE_UUID,
          HOP_VERSION_CHAR,
        );
        if (!versionChar.value) {
          console.warn(`[HOP Auth] ${deviceId}: no version char value — skip`);
          return;
        }
        const version = Buffer.from(versionChar.value, 'base64')[0];
        if (version !== HOP_BLE_PROTOCOL_VERSION) {
          console.warn(
            `[HOP Auth] ${deviceId}: protocol v${version} ≠ v${HOP_BLE_PROTOCOL_VERSION} — skip`,
          );
          return;
        }

        // ── Read profile.id ───────────────────────────────────────────────
        const peerIdChar = await device.readCharacteristicForService(
          HOP_SERVICE_UUID,
          HOP_PEER_ID_CHAR,
        );
        if (!peerIdChar.value) {
          console.warn(`[HOP Auth] ${deviceId}: no peer ID char value — skip`);
          return;
        }
        const profileId = Buffer.from(peerIdChar.value, 'base64').toString('utf8');
        if (!profileId || profileId.length < 8) {
          console.warn(`[HOP Auth] ${deviceId}: invalid profileId "${profileId}" — skip`);
          return;
        }

        // ── Mark as verified ──────────────────────────────────────────────
        verifiedRef.current.set(deviceId, profileId);
        publish();
        console.log(`[HOP Auth] ✅ Verified ${deviceId} → profileId ${profileId.slice(0, 8)}…`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[HOP Auth] ${deviceId}: handshake failed — ${msg}`);
      } finally {
        // Always disconnect and free the concurrency slot.
        try { await device?.cancelConnection(); } catch { /* already disconnected */ }
        connectingSet.current.delete(deviceId);
        setConnectingCount(c => Math.max(0, c - 1));
      }
    },
    [manager, publish],
  );

  // ── Watch discovered peers for new entrants ──────────────────────────────
  useEffect(() => {
    for (const peer of discoveredPeers.values()) {
      const { deviceId } = peer;

      // Skip: already verified.
      if (verifiedRef.current.has(deviceId)) continue;
      // Skip: auth in progress.
      if (connectingSet.current.has(deviceId)) continue;
      // Skip: too many concurrent auths.
      if (connectingSet.current.size >= MAX_CONCURRENT_AUTH) continue;

      connectingSet.current.add(deviceId);
      // Fire-and-forget — errors are handled inside authenticatePeer.
      authenticatePeer(peer);
    }
  }, [discoveredPeers, authenticatePeer]);

  // ── Evict peers that have left the scan window ───────────────────────────
  useEffect(() => {
    let changed = false;
    for (const [deviceId] of verifiedRef.current) {
      if (!discoveredPeers.has(deviceId)) {
        verifiedRef.current.delete(deviceId);
        changed = true;
      }
    }
    if (changed) publish();
  }, [discoveredPeers, publish]);

  return { verifiedBlePeers, peerDeviceMap, connectingCount };
}
