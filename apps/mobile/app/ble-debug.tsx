import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Stack, router } from 'expo-router';
import { HOP_BLE_SERVICE_UUID } from '@hop/protocol';

import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';

function StatusDot({ ok }: { ok: boolean | null }) {
  const color = ok === true ? '#22C55E' : ok === false ? '#DC2626' : '#94A3B8';
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function Row({
  label,
  value,
  ok,
  muted,
}: {
  label: string;
  value: string;
  ok?: boolean | null;
  muted: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: muted }]}>{label}</Text>
      <View style={styles.rowRight}>
        {ok !== undefined ? <StatusDot ok={ok ?? null} /> : null}
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

function formatIso(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function BleDebugScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { user } = useAuth();
  const {
    status,
    peers,
    connectedId,
    busy,
    error,
    log,
    stats,
    sessionActive,
    startNearby,
    stopNearby,
    startScan,
    stopScan,
    startAdvertising,
    stopAdvertising,
    connectPeer,
    disconnectPeer,
    sendTestPayload,
    clearLogs,
  } = useBle();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (connectedId) {
      setSelectedId(connectedId);
    }
  }, [connectedId]);

  const selectedPeer = peers.find((peer) => peer.deviceId === selectedId) ?? null;
  const adapterLabel = !status.implemented
    ? 'Unavailable (Expo Go / web / simulator)'
    : !status.permissionGranted
      ? 'Permission denied'
      : !status.bluetoothOn
        ? 'Bluetooth off'
        : 'Ready';

  const handleStartSession = useCallback(async () => {
    await startNearby();
  }, [startNearby]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'BLE Debug',
          headerBackTitle: 'Back',
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
        <StatusBanner />
        <Text style={styles.title}>BLE Hardware Validation</Text>
        <Text style={[styles.lead, { color: colors.muted }]}>
          Development-only screen for two-phone BLE testing. Requires a development build with
          munim-bluetooth. Internet can be disabled after login.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={styles.cardTitle}>Adapter & session</Text>
          <Row label="Bluetooth adapter" value={adapterLabel} ok={status.bluetoothOn && status.permissionGranted} muted={colors.muted} />
          <Row label="Native BLE" value={status.implemented ? 'Implemented' : 'Blocked'} ok={status.implemented} muted={colors.muted} />
          <Row label="Nearby session" value={sessionActive ? 'Active' : 'Stopped'} ok={sessionActive} muted={colors.muted} />
          <Row label="HOP advertising" value={status.advertising ? 'ON' : 'OFF'} ok={status.advertising} muted={colors.muted} />
          <Row label="HOP scanning" value={status.scanning ? 'ON' : 'OFF'} ok={status.scanning} muted={colors.muted} />
          <Row label="Active transport" value="bluetooth" muted={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 13 }}>{status.detail}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={styles.cardTitle}>Counters</Text>
          <Row label="Packets sent" value={String(stats.packetsSent)} muted={colors.muted} />
          <Row label="Packets received" value={String(stats.packetsReceived)} muted={colors.muted} />
          <Row label="ACKs received" value={String(stats.acksReceived)} muted={colors.muted} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={styles.cardTitle}>Protocol</Text>
          <Row label="Service UUID" value={HOP_BLE_SERVICE_UUID} muted={colors.muted} />
          <Row label="Signed in as" value={user?.username ?? '—'} muted={colors.muted} />
        </View>

        <Text style={styles.section}>Controls</Text>
        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => (sessionActive ? stopNearby() : handleStartSession())}
            disabled={busy}
            style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
            <Text style={styles.buttonLabel}>{sessionActive ? 'Stop session' : 'Start session'}</Text>
          </Pressable>
          <Pressable
            onPress={() => (status.scanning ? stopScan() : startScan())}
            disabled={busy || !sessionActive}
            style={[styles.button, styles.outlineButton, { borderColor: colors.tint, opacity: busy || !sessionActive ? 0.5 : 1 }]}>
            <Text style={[styles.outlineLabel, { color: colors.tint }]}>{status.scanning ? 'Stop scan' : 'Start scan'}</Text>
          </Pressable>
          <Pressable
            onPress={() => (status.advertising ? stopAdvertising() : startAdvertising())}
            disabled={busy || !sessionActive}
            style={[styles.button, styles.outlineButton, { borderColor: colors.tint, opacity: busy || !sessionActive ? 0.5 : 1 }]}>
            <Text style={[styles.outlineLabel, { color: colors.tint }]}>
              {status.advertising ? 'Stop advertise' : 'Start advertise'}
            </Text>
          </Pressable>
          <Pressable
            onPress={clearLogs}
            style={[styles.button, styles.outlineButton, { borderColor: colors.muted }]}>
            <Text style={[styles.outlineLabel, { color: colors.muted }]}>Clear logs</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Discovered HOP peers ({peers.length})</Text>
        {peers.length === 0 ? (
          <Text style={{ color: colors.muted, marginBottom: 16 }}>
            No peers yet. Start session on both phones, enable scan/advertise, keep screens awake.
          </Text>
        ) : (
          peers.map((peer) => {
            const connected = connectedId === peer.deviceId;
            const selected = selectedId === peer.deviceId;
            const handshakeLabel = peer.publicKey
              ? peer.sessionEstablished
                ? 'Authenticated (handshake pk verified)'
                : 'Handshake pk present'
              : 'Not connected — pk unknown';
            const encryptionLabel =
              connected && peer.sessionEstablished ? 'crypto_box session active' : 'No encrypted session';
            return (
              <Pressable
                key={peer.deviceId}
                onPress={() => setSelectedId(peer.deviceId)}
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderWidth: selected ? 2 : 0, borderColor: colors.tint },
                ]}>
                <Text style={styles.peerName}>{peer.displayName}</Text>
                <Row
                  label="Peer identifier"
                  value={peer.userId ?? '(discovered via advertisement only)'}
                  muted={colors.muted}
                />
                <Row
                  label="RSSI"
                  value={typeof peer.rssi === 'number' ? `${peer.rssi} dBm` : '—'}
                  muted={colors.muted}
                />
                <Row label="Connection" value={connected ? 'Connected' : 'Not connected'} ok={connected} muted={colors.muted} />
                <Row label="Handshake / auth" value={handshakeLabel} ok={Boolean(peer.publicKey)} muted={colors.muted} />
                <Row label="Encryption" value={encryptionLabel} ok={connected && peer.sessionEstablished} muted={colors.muted} />
                <View style={styles.buttonRow}>
                  {connected ? (
                    <>
                      <Pressable
                        onPress={() => sendTestPayload(peer.deviceId)}
                        disabled={busy}
                        style={[styles.smallButton, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
                        <Text style={styles.buttonLabel}>Send encrypted test</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => disconnectPeer()}
                        disabled={busy}
                        style={[styles.smallButton, styles.outlineButton, { borderColor: colors.tint }]}>
                        <Text style={[styles.outlineLabel, { color: colors.tint }]}>Disconnect</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => connectPeer(peer.deviceId)}
                      disabled={busy}
                      style={[styles.smallButton, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
                      <Text style={styles.buttonLabel}>Connect</Text>
                    </Pressable>
                  )}
                </View>
              </Pressable>
            );
          })
        )}

        {selectedPeer && connectedId !== selectedPeer.deviceId ? (
          <Text style={{ color: colors.muted, marginBottom: 12 }}>
            Selected {selectedPeer.displayName}. Tap Connect to establish a secure session.
          </Text>
        ) : null}

        {stats.errors.length > 0 ? (
          <>
            <Text style={styles.section}>Errors</Text>
            {stats.errors.map((item, index) => (
              <Text key={`${item.at}-${index}`} style={{ color: '#DC2626', marginBottom: 6, fontSize: 13 }}>
                {formatIso(item.at)} · {item.message}
              </Text>
            ))}
          </>
        ) : null}

        {log.length > 0 ? (
          <>
            <Text style={styles.section}>Activity log</Text>
            {log.map((item, index) => (
              <Text key={`${item.at}-${index}`} style={{ color: colors.muted, marginBottom: 6, fontSize: 13 }}>
                {item.at} · {item.text}
              </Text>
            ))}
          </>
        ) : null}

        <Pressable onPress={() => router.back()} style={[styles.button, styles.outlineButton, { borderColor: colors.tint, marginTop: 8 }]}>
          <Text style={[styles.outlineLabel, { color: colors.tint }]}>Back</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  lead: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  card: { borderRadius: 16, padding: 14, marginBottom: 12, gap: 8, backgroundColor: 'transparent' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  section: { fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  peerName: { fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowLabel: { flex: 1, fontSize: 13 },
  rowRight: { flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  rowValue: { fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  button: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center' },
  smallButton: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  outlineButton: { borderWidth: 1.5, backgroundColor: 'transparent' },
  buttonLabel: { color: '#042f2e', fontWeight: '700', fontSize: 14 },
  outlineLabel: { fontWeight: '700', fontSize: 14 },
  error: { color: '#DC2626', fontSize: 13 },
});
