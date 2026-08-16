import { Alert, Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { replaceIdentityExplicit } from '@/src/crypto/identity';
import { useOffline } from '@/src/offline/OfflineProvider';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { relayConsent, setRelayConsent } = useBle();
  const { identityError } = useOffline();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];

  function confirmReplaceIdentity() {
    if (!user) return;
    Alert.alert(
      'Replace local identity keys?',
      'This creates a new key pair on this device only. Private keys are never backed up to the cloud. The server will reject publishing a second key (409). You must re-verify with every contact. There is no QR safety-number UX yet.',
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
});
