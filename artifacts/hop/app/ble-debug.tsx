/**
 * BLE Debug Screen
 *
 * Shows real-time state of the BLE scanning and advertising subsystems.
 * Intended for development / physical-device testing only.
 * Not linked from the main navigation in production builds.
 *
 * Sections:
 *   1. BLE Radio State  — Bluetooth available/off/unauthorized
 *   2. Advertising      — status, my current tempId, rotation countdown
 *   3. Scanning         — status, filter UUID, discovered peer count
 *   4. Discovered Peers — list of verified HOP advertisement senders
 *   5. Connected Peer   — placeholder (GATT connect is next milestone)
 *   6. Authentication   — placeholder (handshake is next milestone)
 *   7. HOP BLE Identity — service UUID, protocol version, company ID
 */

import React, { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useHop } from '@/context/HopContext';
import {
  HOP_SERVICE_UUID,
  HOP_BLE_PROTOCOL_VERSION,
  HOP_COMPANY_ID,
} from '@/protocol/ble/constants';
import { shortHex } from '@/protocol/ble/tempId';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s ago`;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function rssiBar(rssi: number): string {
  // -50 dBm = excellent, -100 dBm = none
  const pct = Math.max(0, Math.min(100, (rssi + 100) * 2));
  const bars = Math.round(pct / 25);
  return '▂▄▆█'.slice(0, bars).padEnd(4, '░');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, colors }: { title: string; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
      {title}
    </Text>
  );
}

function StatusRow({
  label,
  value,
  ok,
  colors,
}: {
  label: string;
  value: string;
  ok?: boolean | null;
  colors: ReturnType<typeof useColors>;
}) {
  const dotColor =
    ok === true ? '#22C55E' :
    ok === false ? colors.destructive :
    colors.mutedForeground;

  return (
    <View style={styles.statusRow}>
      <Text style={[styles.statusLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.statusRight}>
        {ok !== undefined && ok !== null && (
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        )}
        <Text style={[styles.statusValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BleDebugScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    bleState,
    advertisingState,
    myTempIdHex,
    secondsUntilRotation,
    discoveredHopPeers,
    startAdvertising,
    stopAdvertising,
  } = useHop();

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  const peers = Array.from(discoveredHopPeers.values()).sort(
    (a, b) => b.lastSeenAt - a.lastSeenAt,
  );

  const isScanning = bleState === 'scanning';
  const isAdvert   = advertisingState === 'advertising';

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>BLE Debug</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* ── 1. BLE Radio ──────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <SectionHeader title="BLE RADIO" colors={colors} />
          <StatusRow
            label="Platform"
            value={
              bleState === 'unsupported' ? 'Not supported (web/simulator)' :
              bleState === 'off'         ? 'Bluetooth off' :
              bleState === 'unauthorized'? 'Permission denied' :
              'Available'
            }
            ok={
              bleState === 'scanning' || bleState === 'idle' ? true :
              bleState === 'unsupported' || bleState === 'off' || bleState === 'unauthorized' ? false :
              null
            }
            colors={colors}
          />
          <StatusRow
            label="Radio state"
            value={bleState}
            colors={colors}
          />
        </View>

        {/* ── 2. Advertising ───────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <SectionHeader title="ADVERTISING" colors={colors} />
          <StatusRow
            label="Status"
            value={advertisingState}
            ok={isAdvert ? true : advertisingState === 'stopped' ? null : false}
            colors={colors}
          />
          {myTempIdHex ? (
            <>
              <StatusRow
                label="My Temp ID"
                value={myTempIdHex}
                colors={colors}
              />
              <StatusRow
                label="Rotates in"
                value={formatCountdown(secondsUntilRotation)}
                colors={colors}
              />
            </>
          ) : (
            <StatusRow label="My Temp ID" value="—" colors={colors} />
          )}

          <View style={styles.btnRow}>
            <Pressable
              style={[
                styles.btn,
                { backgroundColor: isAdvert ? colors.destructive : colors.primary },
              ]}
              onPress={() => isAdvert ? stopAdvertising() : startAdvertising()}
            >
              <Text style={[styles.btnText, { color: '#fff' }]}>
                {isAdvert ? 'Stop Advertising' : 'Start Advertising'}
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Advertising is only possible on physical devices with a development build.
            {'\n'}iOS: foreground only. Android: API 21+, some devices unsupported.
          </Text>
        </View>

        {/* ── 3. Scanning ──────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <SectionHeader title="SCANNING" colors={colors} />
          <StatusRow
            label="Status"
            value={isScanning ? 'Scanning…' : bleState}
            ok={isScanning ? true : null}
            colors={colors}
          />
          <StatusRow
            label="Filter"
            value="HOP service UUID only"
            colors={colors}
          />
          <StatusRow
            label="HOP peers discovered"
            value={String(peers.length)}
            colors={colors}
          />
        </View>

        {/* ── 4. Discovered Peers ──────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <SectionHeader title={`DISCOVERED HOP PEERS (${peers.length})`} colors={colors} />

          {peers.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {bleState === 'unsupported'
                ? 'BLE not available on this platform.\nTest on a physical device with a development build.'
                : isScanning
                ? 'Scanning for nearby HOP devices…\nBring another device running HOP close by.'
                : 'No HOP devices discovered yet.'}
            </Text>
          ) : (
            peers.map(peer => (
              <View
                key={peer.deviceId}
                style={[styles.peerCard, { borderColor: colors.border }]}
              >
                <View style={styles.peerRow}>
                  <View style={[styles.peerDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.peerTempId, { color: colors.foreground }]}>
                    {peer.tempIdHex}
                  </Text>
                </View>
                <View style={styles.peerMeta}>
                  <Text style={[styles.peerMetaText, { color: colors.mutedForeground }]}>
                    RSSI {peer.rssi} dBm  {rssiBar(peer.rssi)}
                  </Text>
                  <Text style={[styles.peerMetaText, { color: colors.mutedForeground }]}>
                    Protocol v{peer.protocolVersion}  ·  {ago(peer.lastSeenAt)}
                  </Text>
                  <View style={[styles.statePill, { backgroundColor: colors.primary + '22' }]}>
                    <Text style={[styles.statePillText, { color: colors.primary }]}>
                      {peer.authState.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        {/* ── 5. Connected Peer ────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <SectionHeader title="CONNECTED PEER" colors={colors} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            None — GATT connect is the next milestone.
          </Text>
        </View>

        {/* ── 6. Authentication ────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <SectionHeader title="AUTHENTICATION" colors={colors} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Not yet implemented.{'\n'}
            Next milestone: GATT connect → read profile.id → verify signature.{'\n'}
            Discovery ≠ authentication.
          </Text>
        </View>

        {/* ── 7. HOP BLE Identity ──────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <SectionHeader title="HOP BLE IDENTITY" colors={colors} />
          <StatusRow label="Service UUID"      value={shortHex(HOP_SERVICE_UUID.replace(/-/g, ''))} colors={colors} />
          <StatusRow label="Full UUID"         value={HOP_SERVICE_UUID} colors={colors} />
          <StatusRow label="Protocol version"  value={String(HOP_BLE_PROTOCOL_VERSION)} colors={colors} />
          <StatusRow label="Company ID"        value={`0x${HOP_COMPANY_ID.toString(16).toUpperCase()} (PoC — not registered)`} colors={colors} />
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            The company ID (0x4850) is not registered with Bluetooth SIG.
            Must be registered before public release.
          </Text>
        </View>

        {/* ── Disclaimer ───────────────────────────────────────────────── */}
        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          This screen is for development use only.{'\n'}
          BLE messaging is NOT yet implemented — discovery PoC only.{'\n'}
          Do not interpret discovered peers as authenticated HOP users.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1 },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  back:          { width: 40, padding: 4 },
  title:         { fontSize: 17, fontFamily: 'Inter_700Bold' },
  scroll:        { padding: 16, gap: 12 },
  card:          { borderRadius: 16, padding: 16, gap: 4 },
  sectionLabel:  { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 2, marginBottom: 10 },
  statusRow:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 6 },
  statusLabel:   { fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 },
  statusRight:   { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1.5, justifyContent: 'flex-end', flexWrap: 'wrap' },
  statusValue:   { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'right' },
  dot:           { width: 7, height: 7, borderRadius: 4 },
  btnRow:        { marginTop: 12 },
  btn:           { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnText:       { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  note:          { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 8, lineHeight: 16 },
  emptyText:     { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  peerCard:      { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginTop: 8 },
  peerRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  peerDot:       { width: 8, height: 8, borderRadius: 4 },
  peerTempId:    { fontSize: 12, fontFamily: 'Inter_400Regular', letterSpacing: 0.5, flex: 1 },
  peerMeta:      { gap: 4 },
  peerMetaText:  { fontSize: 12, fontFamily: 'Inter_400Regular' },
  statePill:     { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginTop: 4 },
  statePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  disclaimer:    { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18, marginTop: 8 },
});
