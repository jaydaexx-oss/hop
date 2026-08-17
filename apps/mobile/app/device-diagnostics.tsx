import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import type { BleLinkStatus, NetworkStatus, PeerTrustRecord, PeerTrustState } from '@hop/protocol';
import { formatPersistedFingerprint } from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import {
  API_URL,
  LOOPBACK_API_DEVICE_HINT,
  apiUrlUsesLoopback,
  getHealth,
} from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { useOffline } from '@/src/offline/OfflineProvider';
import {
  describeTransportSelection,
  isSafeDiagnosticsText,
  type BleDiagnosticsSnapshot,
  type BleHandshakePhase,
} from '@hop/protocol';

type RowStatus = 'ok' | 'warn' | 'error';

type Probe = {
  api: 'Connected' | 'Disconnected';
  identity: 'Loaded' | 'Error';
  identityDetail: string;
  secureStore: 'Available' | 'Error';
  internet: 'Online' | 'Offline';
  bluetooth: 'Available' | 'Permission Required' | 'Ready';
  bluetoothDetail: string;
  ble: 'Scanning' | 'Connected' | 'Not Connected';
  peerTrust: PeerTrustState;
  peerTrustLines: string[];
  transport: 'Internet' | 'BLE' | 'Offline Queue';
  encryption: 'Active' | 'Error';
  bleTech: BleDiagnosticsSnapshot;
  transportSelected: string;
  fallbackReason: string;
};

function apiOriginLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '(invalid API URL)';
  }
}

function transportLabel(status: NetworkStatus): Probe['transport'] {
  if (status === 'Online' || status === 'Synchronizing') return 'Internet';
  if (status === 'Nearby' || status === 'Relaying') return 'BLE';
  return 'Offline Queue';
}

function bluetoothLabel(status: BleLinkStatus): Probe['bluetooth'] {
  if (status.permissionGranted && status.bluetoothOn) return 'Ready';
  if (status.implemented && !status.permissionGranted) return 'Permission Required';
  return 'Available';
}

function aggregateTrust(records: PeerTrustRecord[]): PeerTrustState {
  if (records.length === 0) return 'UNKNOWN';
  if (records.some((row) => row.state === 'KEY_CHANGED')) return 'KEY_CHANGED';
  if (records.some((row) => row.state === 'VERIFIED')) return 'VERIFIED';
  return 'TOFU_TRUSTED';
}

function truncateId(value: string): string {
  if (value.length <= 10) return value;
  return `${value.slice(0, 8)}…`;
}

function fingerprintHint(publicKey: string): string {
  return formatPersistedFingerprint(publicKey);
}

function handshakeLabel(state: BleHandshakePhase): string {
  switch (state) {
    case 'idle':
      return 'Idle';
    case 'announced':
      return 'GATT announced';
    case 'authenticating':
      return 'Authenticating';
    case 'authenticated':
      return 'Authenticated';
    case 'failed':
      return 'Failed';
    default:
      return 'Unknown';
  }
}

function safeDetail(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return isSafeDiagnosticsText(value) ? value : fallback;
}

const PROBE_KEY = 'hop.diag.probe';

async function probeSecureStore(): Promise<'Available' | 'Error'> {
  try {
    const SecureStore = await import('expo-secure-store');
    if (typeof SecureStore.setItemAsync !== 'function') return 'Error';
    const token = `ok-${Date.now()}`;
    await SecureStore.setItemAsync(PROBE_KEY, token);
    const roundtrip = await SecureStore.getItemAsync(PROBE_KEY);
    await SecureStore.deleteItemAsync(PROBE_KEY);
    return roundtrip === token ? 'Available' : 'Error';
  } catch {
    return 'Error';
  }
}

function Row({
  label,
  value,
  tone,
  detail,
  muted,
}: {
  label: string;
  value: string;
  tone: RowStatus;
  detail?: string;
  muted: string;
}) {
  const color = tone === 'ok' ? '#15803D' : tone === 'warn' ? '#B45309' : '#DC2626';
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color }]}>{value}</Text>
      {detail ? (
        <Text style={[styles.rowDetail, { color: muted }]}>{detail}</Text>
      ) : null}
    </View>
  );
}

export default function DeviceDiagnosticsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { user } = useAuth();
  const { engine, connectedId } = useBle();
  const { status: networkStatus, identityError, tofu, service } = useOffline();
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);

  const runProbe = useCallback(async () => {
    setBusy(true);
    try {
      await engine.requestPermission().catch(() => false);
      const bleStatus = engine.status();
      let api: Probe['api'] = 'Disconnected';
      try {
        const health = await getHealth();
        if (health.status) api = 'Connected';
      } catch {
        api = 'Disconnected';
      }
      const secureStore = await probeSecureStore();
      const records = tofu?.snapshot() ?? [];
      const identityLoaded = Boolean(user && service && !identityError);
      const bleTech = engine.diagnosticsSnapshot();
      const selection = describeTransportSelection({
        networkStatus,
        bleImplemented: bleTech.nativeImplemented,
        bleBlockedReason: bleTech.blockedReason,
      });
      const probeResult: Probe = {
        api,
        identity: identityLoaded ? 'Loaded' : 'Error',
        identityDetail: identityError
          ? safeDetail(identityError, 'Identity error (details omitted).')
          : user
            ? identityLoaded
              ? 'Local identity keys are present. Secret key is not shown.'
              : 'Identity is not ready yet.'
            : 'Sign in to load identity.',
        secureStore,
        internet: networkStatus === 'Online' || networkStatus === 'Synchronizing' ? 'Online' : 'Offline',
        bluetooth: bluetoothLabel(bleStatus),
        bluetoothDetail: safeDetail(bleStatus.detail, 'Bluetooth status available.'),
        ble: connectedId ? 'Connected' : bleStatus.scanning ? 'Scanning' : 'Not Connected',
        peerTrust: aggregateTrust(records),
        peerTrustLines: records.map(
          (row) => `${truncateId(row.userId)} · ${row.state} · ${fingerprintHint(row.publicKey)}`,
        ),
        transport: transportLabel(networkStatus),
        encryption: identityLoaded ? 'Active' : 'Error',
        bleTech,
        transportSelected: selection.selected,
        fallbackReason: safeDetail(selection.reason, 'Transport reason omitted.'),
      };
      setProbe(probeResult);
    } finally {
      setBusy(false);
    }
  }, [connectedId, engine, identityError, networkStatus, service, tofu, user]);

  useEffect(() => {
    if (!__DEV__) return;
    void runProbe();
    // Probe on open and when the user taps Refresh — not on every network-status tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!__DEV__) {
    return (
      <View style={styles.wrap}>
        <Text style={{ color: colors.muted }}>Diagnostics are not available in this build.</Text>
      </View>
    );
  }

  const loopback = apiUrlUsesLoopback();

  return (
    <ScrollView
      style={[styles.wrap, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}>
      <Text style={styles.title}>Device diagnostics</Text>
      <Text style={[styles.lede, { color: colors.muted }]}>
        Development-device validation only — not a product feature. One-phone technical state is
        not two-phone BLE proof. No private keys, plaintext, voice, or crypto_box are shown.
      </Text>
      {loopback ? (
        <Text style={styles.warn}>{LOOPBACK_API_DEVICE_HINT}</Text>
      ) : (
        <Text style={[styles.lede, { color: colors.muted }]}>
          API host is not loopback. Confirm it is your Mac LAN IP or an HTTPS API domain.
        </Text>
      )}
      {probe ? (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Row
            label="API"
            value={probe.api}
            tone={probe.api === 'Connected' ? 'ok' : 'error'}
            detail={apiOriginLabel(API_URL)}
            muted={colors.muted}
          />
          <Row
            label="Identity"
            value={probe.identity}
            tone={probe.identity === 'Loaded' ? 'ok' : 'error'}
            detail={probe.identityDetail}
            muted={colors.muted}
          />
          <Row
            label="SecureStore"
            value={probe.secureStore}
            tone={probe.secureStore === 'Available' ? 'ok' : 'error'}
            muted={colors.muted}
          />
          <Row
            label="Internet"
            value={probe.internet}
            tone={probe.internet === 'Online' ? 'ok' : 'warn'}
            muted={colors.muted}
          />
          <Row
            label="Bluetooth"
            value={probe.bluetooth}
            tone={probe.bluetooth === 'Ready' ? 'ok' : 'warn'}
            detail={probe.bluetoothDetail}
            muted={colors.muted}
          />
          <Row
            label="BLE"
            value={probe.ble}
            tone={probe.ble === 'Connected' ? 'ok' : probe.ble === 'Scanning' ? 'warn' : 'error'}
            muted={colors.muted}
          />
          <Row
            label="Peer Trust"
            value={probe.peerTrust}
            tone={probe.peerTrust === 'KEY_CHANGED' ? 'error' : probe.peerTrust === 'UNKNOWN' ? 'warn' : 'ok'}
            detail={
              probe.peerTrustLines.length > 0
                ? probe.peerTrustLines.join('\n')
                : 'No bound peers on this device yet.'
            }
            muted={colors.muted}
          />
          <Row label="Transport" value={probe.transport} tone="ok" muted={colors.muted} />
          <Row
            label="Encryption"
            value={probe.encryption}
            tone={probe.encryption === 'Active' ? 'ok' : 'error'}
            muted={colors.muted}
          />
        </View>
      ) : (
        <Text style={{ color: colors.muted }}>Probing…</Text>
      )}
      {probe ? (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={styles.sectionTitle}>One-phone BLE technical state</Text>
          <Text style={[styles.lede, { color: colors.muted }]}>
            Not two-phone proof. Adapter on this device only.
          </Text>
          <Row
            label="BT permission"
            value={probe.bleTech.permissionGranted ? 'Granted' : 'Not granted'}
            tone={probe.bleTech.permissionGranted ? 'ok' : 'warn'}
            muted={colors.muted}
          />
          <Row
            label="Adapter"
            value={probe.bleTech.adapterOn ? 'On' : 'Off'}
            tone={probe.bleTech.adapterOn ? 'ok' : 'warn'}
            muted={colors.muted}
          />
          <Row
            label="Advertising"
            value={probe.bleTech.advertising ? 'Yes' : 'No'}
            tone={probe.bleTech.advertising ? 'ok' : 'warn'}
            muted={colors.muted}
          />
          <Row
            label="Scanning"
            value={probe.bleTech.scanning ? 'Yes' : 'No'}
            tone={probe.bleTech.scanning ? 'ok' : 'warn'}
            muted={colors.muted}
          />
          <Row
            label="GATT registration"
            value={probe.bleTech.gattRegistered ? 'Registered' : 'Not registered'}
            tone={probe.bleTech.gattRegistered ? 'ok' : 'warn'}
            muted={colors.muted}
          />
          <Row
            label="Connection"
            value={
              probe.bleTech.connected
                ? `${probe.bleTech.connectedPeerCount} peer(s)`
                : 'None'
            }
            tone={probe.bleTech.connected ? 'ok' : 'warn'}
            muted={colors.muted}
          />
          <Row
            label="MTU"
            value={
              probe.bleTech.mtu != null
                ? String(probe.bleTech.mtu)
                : 'Unavailable (iOS negotiates internally)'
            }
            tone="ok"
            muted={colors.muted}
          />
          <Row
            label="Handshake"
            value={handshakeLabel(probe.bleTech.handshakeState)}
            tone={
              probe.bleTech.handshakeState === 'authenticated'
                ? 'ok'
                : probe.bleTech.handshakeState === 'failed'
                  ? 'error'
                  : 'warn'
            }
            muted={colors.muted}
          />
          <Row
            label="Transport selected"
            value={probe.transportSelected}
            tone="ok"
            detail={probe.fallbackReason}
            muted={colors.muted}
          />
          <Row
            label="Native BLE"
            value={probe.bleTech.nativeImplemented ? 'Loaded' : 'Unavailable'}
            tone={probe.bleTech.nativeImplemented ? 'ok' : 'warn'}
            detail={
              probe.bleTech.blockedReason && isSafeDiagnosticsText(probe.bleTech.blockedReason)
                ? probe.bleTech.blockedReason
                : undefined
            }
            muted={colors.muted}
          />
          <Row
            label="Permissions note"
            value="BT / mic / local network"
            tone="ok"
            detail="Bluetooth is probed here. Microphone is requested at PTT. Local Network is requested by iOS for LAN HTTP. This screen does not grant extra entitlements."
            muted={colors.muted}
          />
        </View>
      ) : null}
      <Pressable
        onPress={() => void runProbe()}
        disabled={busy}
        style={[styles.button, { borderColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
        <Text style={[styles.buttonLabel, { color: colors.tint }]}>
          {busy ? 'Checking…' : 'Refresh'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  lede: { fontSize: 14, lineHeight: 20 },
  warn: { color: '#B45309', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  card: { borderRadius: 16, padding: 16, gap: 14 },
  row: { gap: 2 },
  rowLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  rowValue: { fontSize: 18, fontWeight: '700' },
  rowDetail: { fontSize: 13, lineHeight: 18 },
  button: { marginTop: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { fontWeight: '700', fontSize: 16 },
});
