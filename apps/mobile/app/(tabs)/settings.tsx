import { Alert, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useRef, useState } from 'react';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { bluetoothStatusLabel, LOCAL_AVATAR_COLORS } from '@hop/protocol';

import { ActionSheet } from '@/components/ActionSheet';
import { ApiEnvironmentBanner } from '@/components/ApiEnvironmentBanner';
import { Avatar } from '@/components/Avatar';
import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import {
  ERASE_IDENTITY_CONFIRM,
  ERASE_IDENTITY_CONTINUE,
  ERASE_IDENTITY_MESSAGE,
  ERASE_IDENTITY_MESSAGE_2,
  ERASE_IDENTITY_TITLE,
  ERASE_IDENTITY_TITLE_2,
  RESET_HOP_CONFIRM,
  RESET_HOP_MESSAGE,
  RESET_HOP_TITLE,
} from '@/src/auth/deviceOnboarding';
import { useBle } from '@/src/ble/BleProvider';
import { useNearbyPeers } from '@/src/nearby/useNearbyPeers';
import { AUDIENCE_LABELS, OPERATING_MODE_LABELS } from '@/src/nearby/types';
import { INVISIBLE_RADAR_COPY } from '@/src/nearby/nearbyPolicy';
import { useOffline } from '@/src/offline/OfflineProvider';
import { pickPreparedProfilePhoto } from '@/src/profile/pickProfilePhoto';
import { clearProfilePhotoCache, uploadProfilePhotoFile } from '@/src/profile/profilePhotoCache';
import { useLocalAvatarColor } from '@/src/profile/useLocalAvatarColor';
import { useProfilePhoto } from '@/src/profile/useProfilePhoto';

const DEV_VERSION_TAPS = 7;
const DEV_VERSION_TAP_WINDOW_MS = 2000;

export default function SettingsScreen() {
  const { user, token, resetThisDevice, eraseThisDeviceIdentity, refreshUser, changeHandle } = useAuth();
  const { relayConsent, setRelayConsent } = useBle();
  const { operatingMode, audience, eventMode, eventRemainingLabel, scanState } = useNearbyPeers();
  const { identityError } = useOffline();
  const { color, select } = useLocalAvatarColor(user?.id);
  const { uri: photoUri, status: photoStatus, error: photoLoadError, retry: retryPhoto } = useProfilePhoto(
    user?.id,
    user?.has_avatar,
  );
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const router = useRouter();
  const [photoSheet, setPhotoSheet] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [handleDraft, setHandleDraft] = useState(user?.username ?? '');
  const [handleBusy, setHandleBusy] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);
  const hasPhoto = Boolean(user?.has_avatar || photoUri);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hopVersion = Constants.expoConfig?.version ?? '0.1.0';

  async function applyPhoto(source: 'library' | 'camera') {
    if (!token || !user) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const prepared = await pickPreparedProfilePhoto(source);
      if (!prepared) return;
      await uploadProfilePhotoFile(token, prepared);
      await refreshUser();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not update photo');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (!token || !user) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await api.deleteAvatar(token);
      clearProfilePhotoCache(user.id);
      await refreshUser();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not remove photo');
    } finally {
      setPhotoBusy(false);
    }
  }

  function confirmResetHopApp() {
    Alert.alert(RESET_HOP_TITLE, RESET_HOP_MESSAGE, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: RESET_HOP_CONFIRM,
        onPress: () => {
          resetThisDevice().catch((err) => {
            Alert.alert('Could not reset HOP app', err instanceof Error ? err.message : 'Unknown error');
          });
        },
      },
    ]);
  }

  function confirmEraseIdentity() {
    Alert.alert(ERASE_IDENTITY_TITLE, ERASE_IDENTITY_MESSAGE, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: ERASE_IDENTITY_CONTINUE,
        style: 'destructive',
        onPress: () => {
          Alert.alert(ERASE_IDENTITY_TITLE_2, ERASE_IDENTITY_MESSAGE_2, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: ERASE_IDENTITY_CONFIRM,
              style: 'destructive',
              onPress: () => {
                eraseThisDeviceIdentity().catch((err) => {
                  Alert.alert(
                    'Could not erase identity',
                    err instanceof Error ? err.message : 'Unknown error',
                  );
                });
              },
            },
          ]);
        },
      },
    ]);
  }

  function onVersionPress() {
    if (!__DEV__) return;
    versionTapCount.current += 1;
    if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
    if (versionTapCount.current >= DEV_VERSION_TAPS) {
      versionTapCount.current = 0;
      router.push('/device-diagnostics');
      return;
    }
    versionTapTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
    }, DEV_VERSION_TAP_WINDOW_MS);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <ApiEnvironmentBanner compact />
      <StatusBanner />
      <View style={styles.hero}>
        <Pressable
          onPress={() => setPhotoSheet(true)}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          disabled={photoBusy}>
          <Avatar
            username={user?.username ?? 'HOP'}
            color={color}
            uri={photoUri}
            size={96}
            borderColor={colors.tint}
            borderWidth={2}
          />
        </Pressable>
        <Text style={styles.username}>{user?.username}</Text>
        <Text style={{ color: colors.muted, textAlign: 'center' }}>
          Display handle only — not your encryption identity. You can change it anytime.
        </Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          value={handleDraft}
          onChangeText={setHandleDraft}
          placeholder="Handle"
          placeholderTextColor={colors.muted}
          style={[styles.handleInput, { color: colors.text, backgroundColor: colors.card, borderColor: colors.tabIconDefault }]}
        />
        {handleError ? <Text style={{ color: '#DC2626', textAlign: 'center' }}>{handleError}</Text> : null}
        {handleDraft.trim().toLowerCase() !== (user?.username ?? '') ? (
          <Pressable
            onPress={() => {
              setHandleBusy(true);
              setHandleError(null);
              changeHandle(handleDraft)
                .catch((err) => setHandleError(err instanceof Error ? err.message : 'Could not change handle'))
                .finally(() => setHandleBusy(false));
            }}
            disabled={handleBusy}
            style={[styles.button, { borderColor: colors.tint, marginTop: 4 }]}>
            <Text style={[styles.buttonLabel, { color: colors.tint }]}>
              {handleBusy ? 'Saving…' : 'Save handle'}
            </Text>
          </Pressable>
        ) : null}
        <Text style={{ color: colors.muted, textAlign: 'center' }}>
          Photo, initials, and a local color — not identity, never in your HOP QR.
        </Text>
        {photoBusy || photoStatus === 'loading' ? (
          <Text style={{ color: colors.muted }}>Updating photo…</Text>
        ) : null}
        {photoError || photoLoadError ? (
          <Pressable onPress={() => (photoError ? void applyPhoto('library') : void retryPhoto())}>
            <Text style={{ color: '#DC2626', textAlign: 'center' }}>
              {photoError || photoLoadError} · Tap to retry
            </Text>
          </Pressable>
        ) : null}
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
          <>
            {eventMode.name ? (
              <Text style={{ color: colors.event, fontWeight: '800', fontSize: 18 }}>{eventMode.name}</Text>
            ) : null}
            <Text style={{ color: colors.event, fontWeight: '700' }}>
              Active · {eventMode.enabled ? eventRemainingLabel : 'ending'} left
            </Text>
          </>
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
      <Pressable onPress={confirmResetHopApp} style={[styles.button, { borderColor: colors.tint }]}>
        <Text style={[styles.buttonLabel, { color: colors.tint }]}>Reset HOP app</Text>
      </Pressable>
      <Text style={{ color: colors.muted, textAlign: 'center' }}>
        Clears session and cached data. Keeps this iPhone’s HOP identity so the same account can restore here.
      </Text>
      <Pressable onPress={confirmEraseIdentity} style={[styles.button, { borderColor: '#DC2626' }]}>
        <Text style={[styles.buttonLabel, { color: '#DC2626' }]}>Erase HOP identity from this device</Text>
      </Pressable>
      <Pressable onPress={onVersionPress} accessibilityRole="text" accessibilityLabel={`HOP ${hopVersion}`}>
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 8 }}>HOP {hopVersion}</Text>
      </Pressable>
      <ActionSheet
        visible={photoSheet}
        onDismiss={() => setPhotoSheet(false)}
        title="Profile photo"
        subtitle="Square crop, then a circle in HOP. Never in your QR."
        avatarUserId={user?.id}
        avatarHasAvatar={user?.has_avatar}
        avatarColor={color}
        actions={[
          { label: 'Choose Photo', onPress: () => void applyPhoto('library') },
          { label: 'Take Photo', onPress: () => void applyPhoto('camera') },
          ...(hasPhoto
            ? [{ label: 'Remove Photo', destructive: true as const, onPress: () => void removePhoto() }]
            : []),
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40, gap: 12 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 8, backgroundColor: 'transparent' },
  username: { fontSize: 26, fontWeight: '800' },
  handleInput: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    textAlign: 'center',
  },
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
