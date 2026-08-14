import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';

export default function NearbyScreen() {
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
    sessionActive,
    startNearby,
    stopNearby,
    connectPeer,
    disconnectPeer,
    sendTestPayload,
  } = useBle();

  useFocusEffect(
    useCallback(() => {
      startNearby().catch(() => undefined);
      return () => {
        stopNearby().catch(() => undefined);
      };
    }, [startNearby, stopNearby]),
  );

  const scanLabel = !sessionActive
    ? 'Idle'
    : status.scanning
      ? 'Scanning (balanced)'
      : 'Scan pause (battery)';
  const advertiseLabel = status.advertising
    ? `Visible as ${user?.username ?? 'you'}`
    : status.advertisingSupported
      ? 'Not advertising'
      : 'Advertising unsupported on this OS/hardware';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <StatusBanner />
      <Text style={styles.title}>Nearby</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Direct Bluetooth between two phones. Chat picks internet or BLE automatically — there is no
        transport switch. BLE messages use libsodium crypto_box. Mesh relay is not implemented.
        Physical-device BLE has not been verified in this environment.
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={styles.cardTitle}>This phone</Text>
        <Text style={{ color: colors.muted }}>{advertiseLabel}</Text>
        <Text style={{ color: colors.muted }}>{scanLabel}</Text>
        <Text style={{ color: colors.muted }}>{status.detail}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          onPress={() => (sessionActive ? stopNearby() : startNearby())}
          disabled={busy}
          style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
          <Text style={styles.buttonLabel}>{sessionActive ? 'Stop Nearby' : 'Start Nearby'}</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Discovered HOP users</Text>
      {peers.length === 0 ? (
        <Text style={{ color: colors.muted, marginBottom: 16 }}>
          No peers yet. Keep this screen open on both phones, a few meters apart, with Bluetooth on.
        </Text>
      ) : (
        peers.map((peer) => {
          const connected = connectedId === peer.deviceId;
          return (
            <View key={peer.deviceId} style={[styles.card, { backgroundColor: colors.card }]}>
              <Text style={styles.peerName}>{peer.displayName}</Text>
              <Text style={{ color: colors.muted }}>
                {connected
                  ? peer.sessionEstablished
                    ? 'Secure session'
                    : 'Connected'
                  : 'Not connected'}
                {typeof peer.rssi === 'number' ? ` · ${peer.rssi} dBm` : ''}
              </Text>
              <View style={styles.row}>
                {connected ? (
                  <>
                    <Pressable
                      onPress={() => sendTestPayload(peer.deviceId)}
                      disabled={busy}
                      style={[styles.smallButton, { backgroundColor: colors.tint }]}>
                      <Text style={styles.buttonLabel}>Send encrypted message</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => disconnectPeer()}
                      disabled={busy}
                      style={[styles.smallButton, { borderColor: colors.tint, borderWidth: 1.5 }]}>
                      <Text style={{ color: colors.tint, fontWeight: '700' }}>Disconnect</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    onPress={() => connectPeer(peer.deviceId)}
                    disabled={busy}
                    style={[styles.smallButton, { backgroundColor: colors.tint }]}>
                    <Text style={styles.buttonLabel}>Connect</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })
      )}

      {log.length > 0 ? (
        <>
          <Text style={styles.section}>Activity</Text>
          {log.map((item, index) => (
            <Text key={`${item.at}-${index}`} style={{ color: colors.muted, marginBottom: 6 }}>
              {item.at} · {item.text}
            </Text>
          ))}
        </>
      ) : null}

      <Text style={styles.section}>Limits</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        iOS and Android only advertise a local name plus the HOP service UUID — never a MAC in this UI. Reliable
        Nearby requires the app in the foreground. Expo Go cannot run this. BLE payloads are
        libsodium crypto_box, not Signal Protocol. Internet chat is still `alg: none`. See
        docs/PLATFORM_LIMITATIONS.md and docs/BLE_TESTING.md.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  lead: { fontSize: 15, lineHeight: 21, marginBottom: 16 },
  card: { borderRadius: 16, padding: 14, marginBottom: 12, gap: 6, backgroundColor: 'transparent' },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  section: { fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  peerName: { fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  button: { marginTop: 10, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  smallButton: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  buttonLabel: { color: '#042f2e', fontWeight: '700' },
  error: { color: '#DC2626' },
});
