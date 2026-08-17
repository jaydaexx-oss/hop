import { Alert, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { bluetoothStatusLabel, LOCAL_AVATAR_COLORS } from '@hop/protocol';

import { Avatar } from '@/components/Avatar';
import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { replaceIdentityExplicit } from '@/src/crypto/identity';
import { useNearbyPeers } from '@/src/nearby/useNearbyPeers';
import { AUDIENCE_LABELS, OPERATING_MODE_LABELS } from '@/src/nearby/types';
import { INVISIBLE_RADAR_COPY } from '@/src/nearby/nearbyPolicy';
import { useOffline } from '@/src/offline/OfflineProvider';
import { useLocalAvatarColor } from '@/src/profile/useLocalAvatarColor';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { relayConsent, setRelayConsent } = useBle();
  const { operatingMode, audience, eventMode, eventRemainingLabel, scanState } = useNearbyPeers();
  const { identityError } = useOffline();
  const { color, select } = useLocalAvatarColor(user?.id);
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
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <StatusBanner />
      <View style={styles.hero}>
        <Avatar username={user?.username ?? 'HOP'} color={color} size={96} borderColor={colors.tint} borderWidth={2} />
        <Text style={styles.username}>{user?.username}</Text>
        <Text style={{ color: colors.muted, textAlign: 'center' }}>
          Initials and a local color — not identity, never in your HOP QR.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>AVATAR COLOR</Text>
        <View style={styles.colorGrid}>
          {LOCAL_AVATAR_COLORS.map((swatch) => (
            <Pressable
              key={swatch}
              onPress={() => void select(swatch)}
              style={[
                styles.dot,
                { backgroundColor: swatch },
                color === swatch && { borderWidth: 3, borderColor: colors.tint, transform: [{ scale: 1.12 }] },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={styles.cardTitle}>Nearby</Text>
        <Text style={{ color: colors.text, fontWeight: '700' }}>
          {OPERATING_MODE_LABELS[operatingMode]}
          {operatingMode !== 'invisible' ? ` · ${AUDIENCE_LABELS[audience]}` : ''}
        </Text>
        {operatingMode === 'event' ? (
          <Text style={{ color: colors.event, fontWeight: '700' }}>
            Active · {eventMode.enabled ? eventRemainingLabel : 'ending'} left
          </Text>
        ) : null}
        <Text style={{ color: colors.muted, marginTop: 4 }}>
          {operatingMode === 'invisible'
            ? INVISIBLE_RADAR_COPY
            : 'Change Around Us, Event Mode, or Invisible on the Nearby tab. Discoverable off is still Invisible underneath.'}
        </Text>
        <Pressable
          onPress={() => router.push('/(tabs)/nearby')}
          style={[styles.button, { borderColor: colors.tint, marginTop: 12 }]}>
          <Text style={[styles.buttonLabel, { color: colors.tint }]}>Open Nearby to change</Text>
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={styles.cardTitle}>Bluetooth</Text>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{bluetoothStatusLabel(scanState)}</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>
          Live status from this phone’s scan state — not a hardcoded Active label.
        </Text>
      </View>

      <Pressable onPress={() => router.push('/qr')} style={[styles.rowBtn, { backgroundColor: colors.card }]}>
        <Text style={styles.rowBtnTitle}>My HOP QR Code</Text>
        <Text style={{ color: colors.muted }}>Username + invite only</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/scan')} style={[styles.rowBtn, { backgroundColor: colors.card }]}>
        <Text style={styles.rowBtnTitle}>Scan Code</Text>
        <Text style={{ color: colors.muted }}>Opens a message request, not a skip-to-DM</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/requests')} style={[styles.rowBtn, { backgroundColor: colors.card }]}>
        <Text style={styles.rowBtnTitle}>Message requests</Text>
      </Pressable>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
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

      <Text style={{ color: colors.muted, marginTop: 8 }}>
        Messages over the internet are sealed with libsodium crypto_box. The API stores ciphertext
        only. Chat chooses internet or Nearby BLE automatically.
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
      <Pressable onPress={logout} style={[styles.button, { borderColor: colors.tint }]}>
        <Text style={[styles.buttonLabel, { color: colors.tint }]}>Log out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40, gap: 12 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 8, backgroundColor: 'transparent' },
  username: { fontSize: 26, fontWeight: '800' },
  card: { borderRadius: 16, padding: 16, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10, backgroundColor: 'transparent' },
  dot: { width: 32, height: 32, borderRadius: 16 },
  button: { marginTop: 12, borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { fontWeight: '700', fontSize: 16 },
  rowBtn: { borderRadius: 16, padding: 16, gap: 2 },
  rowBtnTitle: { fontSize: 16, fontWeight: '700' },
});
