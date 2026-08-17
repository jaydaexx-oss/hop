import { Alert, Pressable, StyleSheet, Switch } from 'react-native';
import { useRouter } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { replaceIdentityExplicit } from '@/src/crypto/identity';
import { useNearbyPeers } from '@/src/nearby/useNearbyPeers';
import { PRIVACY_LABELS, type NearbyPrivacyMode } from '@/src/nearby/types';
import { useOffline } from '@/src/offline/OfflineProvider';

const PRIVACY_ORDER: NearbyPrivacyMode[] = ['invisible', 'contacts', 'everyone'];

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { relayConsent, setRelayConsent } = useBle();
  const { privacyMode, setPrivacyMode, discoverable, setDiscoverable } = useNearbyPeers();
  const { identityError } = useOffline();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const router = useRouter();

  function confirmReplaceIdentity() {
    if (!user) return;
    Alert.alert(
      'Replace local identity keys?',
      'This creates a new key pair on this device only. Private keys are never backed up to the cloud. If this account already published a different public key, the server returns 409 SERVER_KEY_LOCKED and will not accept a second key. Recovery is a new account. There is no unauthenticated rotation and no QR safety-number UX yet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace keys',
          style: 'destructive',
          onPress: () => {
            replaceIdentityExplicit(user.id).catch((err) => {
              Alert.alert('Could not replace identity', err instanceof Error ? err.message : 'Unknown error');
            });
          },
        },
      ],
    );
  }

  return (
    <View style={styles.wrap}>
      <StatusBanner />
      <Text style={styles.title}>Profile</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.muted }}>Username</Text>
        <Text style={styles.username}>{user?.username}</Text>
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, marginTop: 12 }]}>
        <Text style={styles.cardTitle}>Around Us visibility</Text>
        <Text style={{ color: colors.muted, marginBottom: 10 }}>
          Discoverable off is Invisible (the default). Event Mode cannot override Invisible.
          Contacts only lists people you already chat with after a handshake. Everyone nearby can
          discover other HOP users around this phone.
        </Text>
        <View style={styles.discoverRow}>
          <Text style={{ fontWeight: '700' }}>Discoverable</Text>
          <Switch value={discoverable} onValueChange={(on) => void setDiscoverable(on)} />
        </View>
        {PRIVACY_ORDER.map((mode) => (
          <Pressable
            key={mode}
            onPress={() => setPrivacyMode(mode)}
            style={[
              styles.privacyRow,
              { borderColor: privacyMode === mode ? colors.tint : colors.tabIconDefault },
            ]}>
            <Text style={{ color: privacyMode === mode ? colors.tint : colors.text, fontWeight: '700' }}>
              {PRIVACY_LABELS[mode]}
              {privacyMode === mode ? ' · selected' : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, marginTop: 12 }]}>
        <Text style={styles.cardTitle}>Relay consent</Text>
        <Text style={{ color: colors.muted, marginBottom: 10 }}>
          When on, this phone may forward encrypted envelopes it cannot decrypt (A → B → C). Off by
          default. Relays never see plaintext. Physical multi-hop has not been verified.
        </Text>
        <Pressable
          onPress={() => setRelayConsent(!relayConsent)}
          style={[styles.button, { borderColor: colors.tint, marginTop: 0 }]}>
          <Text style={[styles.buttonLabel, { color: colors.tint }]}>
            {relayConsent ? 'Relay is on' : 'Relay is off'}
          </Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.muted, marginTop: 16 }}>
        Messages over the internet are sealed with libsodium crypto_box. The API stores ciphertext
        only. Identity public keys are published by each client and are not certificate-attested.
        Chat chooses internet or Nearby BLE automatically. Controlled peer-relay is simulated in
        protocol tests; real-world mesh is not complete.
      </Text>
      {identityError ? (
        <Text style={{ color: '#DC2626', marginTop: 16 }}>{identityError}</Text>
      ) : null}
      <Pressable onPress={confirmReplaceIdentity} style={[styles.button, { borderColor: '#DC2626' }]}>
        <Text style={[styles.buttonLabel, { color: '#DC2626' }]}>Replace local identity keys</Text>
      </Pressable>
      {__DEV__ ? (
        <Pressable
          onPress={() => router.push('/device-diagnostics')}
          style={[styles.button, { borderColor: colors.tint }]}>
          <Text style={[styles.buttonLabel, { color: colors.tint }]}>Device diagnostics</Text>
        </Pressable>
      ) : null}
      {__DEV__ ? (
        <Pressable
          onPress={() => router.push('/ble-debug')}
          style={[styles.button, { borderColor: colors.tint, marginTop: 12 }]}>
          <Text style={[styles.buttonLabel, { color: colors.tint }]}>BLE debug</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => router.push('/qr')} style={[styles.button, { borderColor: colors.tint }]}>
        <Text style={[styles.buttonLabel, { color: colors.tint }]}>My HOP QR Code</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/scan')} style={[styles.button, { borderColor: colors.tint, marginTop: 12 }]}>
        <Text style={[styles.buttonLabel, { color: colors.tint }]}>Scan someone’s HOP code</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/requests')} style={[styles.button, { borderColor: colors.tint, marginTop: 12 }]}>
        <Text style={[styles.buttonLabel, { color: colors.tint }]}>Message requests</Text>
      </Pressable>
      <Pressable onPress={logout} style={[styles.button, { borderColor: colors.tint }]}>
        <Text style={[styles.buttonLabel, { color: colors.tint }]}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 16 },
  card: { borderRadius: 16, padding: 16, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  username: { fontSize: 22, fontWeight: '700' },
  button: { marginTop: 28, borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { fontWeight: '700', fontSize: 16 },
  privacyRow: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8 },
  discoverRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
});
