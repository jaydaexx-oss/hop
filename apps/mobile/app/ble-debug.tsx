import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { describeProofRoute, isDeveloperScreenEnabled, isSafeDiagnosticsText } from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { getHealth } from '@/src/api/client';
import { useBle } from '@/src/ble/BleProvider';
import { useEffect, useState } from 'react';

function routeLabel(selected: string): string {
  if (selected === 'internet') return 'Internet';
  if (selected === 'bluetooth') return 'BLE';
  if (selected === 'local') return 'Queue';
  return 'None';
}

export default function BleDebugScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { engine, status, sessionActive, peers } = useBle();
  const diag = engine.diagnosticsSnapshot();
  const [healthOk, setHealthOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((health) => {
        if (!cancelled) setHealthOk(Boolean(health.status));
      })
      .catch(() => {
        if (!cancelled) setHealthOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [diag.lastSendResult, diag.handshakeState, status.advertising, status.scanning]);

  if (!isDeveloperScreenEnabled(__DEV__)) {
    return <Redirect href="/(tabs)/settings" />;
  }

  const bleRadioReady = Boolean(
    diag.nativeImplemented && diag.permissionGranted && diag.adapterOn && sessionActive,
  );
  const route = describeProofRoute({
    internetHealthOk: healthOk,
    bleRadioReady,
    authenticatedPeerMapped: diag.authenticatedPeerCount > 0,
    bleBlockedReason: diag.blockedReason,
  });

  const lines = [
    `CBManager.authorization: ${diag.authorization}`,
    `CBCentralManager.state: ${diag.adapterState}`,
    `Central manager initialized: ${diag.centralManagerInitialized ? 'yes' : 'no'}`,
    `Native probed: ${diag.nativeProbed ? 'yes' : 'no'}`,
    `Bluetooth powered: ${diag.adapterState === 'poweredOn' ? 'yes' : 'no'} (${diag.adapterState})`,
    `Permission granted: ${diag.permissionGranted ? 'yes' : 'no'}`,
    `Scan state: ${status.scanning ? 'scanning' : 'not scanning'}`,
    `Peripheral/advertising: ${status.advertising ? 'advertising' : 'not advertising'}`,
    `GATT registered: ${diag.gattRegistered ? 'yes' : 'no'}`,
    `Session: ${sessionActive ? 'active' : 'idle'} / handshake ${diag.handshakeState}`,
    `Discovered peers (count only): ${diag.discoveredPeerCount}`,
    `Authenticated sessions (count only): ${diag.authenticatedPeerCount}`,
    `Internet /health: ${healthOk ? 'reachable' : 'unreachable'}`,
    `Selected transport: ${routeLabel(route.selected)}`,
    `Send result: ${diag.lastSendResult}`,
    `Link ACK result: ${diag.lastAckResult}`,
    `Inbound result: ${diag.lastInboundResult}`,
    `Nearby peers (count only): ${peers.length}`,
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>BLE debug</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Developer-only. One-phone adapter and session state — not two-phone proof. Hardware IDs, MACs,
        UUIDs, keys, and plaintext are never shown. Internet availability is API /health, not NetInfo.
      </Text>
      {isSafeDiagnosticsText(route.reason) ? (
        <Text style={[styles.lead, { color: colors.muted }]}>{route.reason}</Text>
      ) : null}
      {lines.map((line) => (
        <View key={line} style={[styles.card, { backgroundColor: colors.card }]}>
          <Text>{isSafeDiagnosticsText(line) ? line : 'Redacted'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  lead: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  card: { borderRadius: 12, padding: 12 },
});
