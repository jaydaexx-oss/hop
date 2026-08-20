import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { isBleDebugEnabled, isSafeDiagnosticsText } from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useBle } from '@/src/ble/BleProvider';

export default function BleDebugScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { engine, status, sessionActive, peers } = useBle();
  const diag = engine.diagnosticsSnapshot();

  if (!isBleDebugEnabled(__DEV__)) {
    return <Redirect href="/(tabs)/settings" />;
  }

  const lines = [
    `CBManager.authorization: ${diag.authorization}`,
    `CBCentralManager.state: ${diag.adapterState}`,
    `Central manager initialized: ${diag.centralManagerInitialized ? 'yes' : 'no'}`,
    `Native probed: ${diag.nativeProbed ? 'yes' : 'no'}`,
    `Bluetooth powered: ${diag.adapterState === 'poweredOn' ? 'yes' : 'no'} (${diag.adapterState})`,
    `Permission granted: ${diag.permissionGranted ? 'yes' : 'no'}`,
    `Scan state: ${status.scanning ? 'scanning' : 'not scanning'}`,
    `Peripheral/advertising: ${status.advertising ? 'advertising' : 'not advertising'}`,
    `Session: ${sessionActive ? 'active' : 'idle'}`,
    `Nearby peers (count only): ${peers.length}`,
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>BLE debug</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Developer-only. One-phone adapter state — not two-phone proof. Hardware IDs, MACs, and
        UUIDs are never shown.
      </Text>
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
