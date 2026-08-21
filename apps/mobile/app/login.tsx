import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '@/components/Avatar';
import { ApiEnvironmentBanner } from '@/components/ApiEnvironmentBanner';
import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { HOP_USERNAME_RE, LOCAL_AVATAR_COLORS, normalizeHopUsername } from '@hop/protocol';
import {
  HANDLE_IS_NOT_AUTH_MESSAGE,
  HANDLE_TAKEN_RECOVER_COPY,
  KEYS_MISSING_MESSAGE,
  NO_RECOVERY_METHODS_MESSAGE,
  RECOVER_MY_HOP_LABEL,
  USE_DIFFERENT_HANDLE_LABEL,
  formatPreviousHopLabel,
} from '@hop/protocol';
import { api, type RecoveryOptions } from '@/src/api/hop';
import { LOOPBACK_API_DEVICE_HINT, apiUrlUsesLoopback } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthProvider';
import {
  ERASE_IDENTITY_CONFIRM,
  ERASE_IDENTITY_CONTINUE,
  ERASE_IDENTITY_MESSAGE,
  ERASE_IDENTITY_MESSAGE_2,
  ERASE_IDENTITY_TITLE,
  ERASE_IDENTITY_TITLE_2,
} from '@/src/auth/deviceOnboarding';
import { forgetPersistedHandleHint, loadPersistedHandleHint } from '@/src/auth/handleHintStorage';
import { PASSKEY_NATIVE_REQUIRED_MESSAGE, platformPasskeysAvailable } from '@/src/auth/passkeys';
import { loadToken } from '@/src/auth/storage';
import { POST_LOGIN_HREF } from '@/src/navigation/tabOrder';
import { createPersistentKv } from '@/src/nearby/kvStore';
import { defaultLocalAvatarColor, saveLocalAvatarColor } from '@/src/profile/avatarAppearance';
import { pickPreparedProfilePhoto } from '@/src/profile/pickProfilePhoto';
import { uploadProfilePhotoFile } from '@/src/profile/profilePhotoCache';

const kv = createPersistentKv();

export default function LoginScreen() {
  const {
    user,
    startHopping,
    recoverHop,
    continueOnDevice,
    eraseThisDeviceIdentity,
    refreshUser,
    skipOnboarding,
    error,
  } = useAuth();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(skipOnboarding);
  const [localError, setLocalError] = useState<string | null>(null);
  const [handleStatus, setHandleStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [avatarColor, setAvatarColor] = useState(() => defaultLocalAvatarColor('hop'));
  const [recovering, setRecovering] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryOptions, setRecoveryOptions] = useState<RecoveryOptions | null>(null);
  const [rememberedHandle, setRememberedHandle] = useState<string | null>(null);

  useEffect(() => {
    if (user || !skipOnboarding) return;
    let cancelled = false;
    setBusy(true);
    setLocalError(null);
    continueOnDevice()
      .catch((err) => {
        if (!cancelled) setLocalError(err instanceof Error ? err.message : 'Could not restore this device');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, skipOnboarding]);

  useEffect(() => {
    if (user || skipOnboarding) return;
    let cancelled = false;
    void loadPersistedHandleHint().then((handle) => {
      if (cancelled || !handle) return;
      setRememberedHandle(handle);
      setUsername(handle);
      // Do not call recoverHop — a handle hint is not authentication.
    });
    return () => {
      cancelled = true;
    };
  }, [user, skipOnboarding]);

  useEffect(() => {
    const handle = normalizeHopUsername(username);
    if (!handle) {
      setHandleStatus('idle');
      return;
    }
    if (!HOP_USERNAME_RE.test(handle)) {
      setHandleStatus('invalid');
      return;
    }
    let cancelled = false;
    setHandleStatus('checking');
    const timer = setTimeout(() => {
      api
        .handleAvailable(handle)
        .then((result) => {
          if (!cancelled) {
            setHandleStatus(result.available ? 'ok' : 'taken');
            if (result.available) {
              setRecovering(false);
              setRecoveryPassword('');
              setRecoveryOptions(null);
            } else {
              api
                .recoveryOptions(handle)
                .then((options) => {
                  if (!cancelled) setRecoveryOptions(options);
                })
                .catch(() => {
                  if (!cancelled) setRecoveryOptions(null);
                });
            }
          }
        })
        .catch(() => {
          if (!cancelled) setHandleStatus('idle');
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  if (user) return <Redirect href={POST_LOGIN_HREF} />;

  async function submitStart() {
    const handle = normalizeHopUsername(username);
    setBusy(true);
    setLocalError(null);
    try {
      const created = await startHopping(handle);
      await saveLocalAvatarColor(kv, created.id, avatarColor);
      const authToken = await loadToken();
      if (photoUri && authToken) {
        await uploadProfilePhotoFile(authToken, photoUri);
        await refreshUser();
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function submitRecover(proof: { method: 'legacy_password_once'; password: string } | { method: 'passkey' }) {
    const handle = normalizeHopUsername(username);
    setBusy(true);
    setLocalError(null);
    try {
      await recoverHop(handle, proof);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : KEYS_MISSING_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function choosePhoto(source: 'library' | 'camera') {
    try {
      const prepared = await pickPreparedProfilePhoto(source);
      if (prepared) setPhotoUri(prepared);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not add photo');
    }
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
                setBusy(true);
                setLocalError(null);
                eraseThisDeviceIdentity()
                  .catch((err) =>
                    setLocalError(err instanceof Error ? err.message : 'Could not erase identity'),
                  )
                  .finally(() => setBusy(false));
              },
            },
          ]);
        },
      },
    ]);
  }

  function useDifferentHandle() {
    void forgetPersistedHandleHint();
    setRememberedHandle(null);
    setUsername('');
    setRecovering(false);
    setRecoveryPassword('');
    setRecoveryOptions(null);
    setHandleStatus('idle');
    setLocalError(null);
  }

  const hopDisabled = busy || handleStatus !== 'ok';
  const passkeysReady = platformPasskeysAvailable();
  const showPasskey = Boolean(recoveryOptions?.passkey_enrolled && passkeysReady);
  const showPasskeyNeedsNative = Boolean(recoveryOptions?.passkey_enrolled && !passkeysReady);
  const showPassword = recoveryOptions == null || Boolean(recoveryOptions.legacy_password);
  const showNoMethods = Boolean(
    recoveryOptions && !recoveryOptions.passkey_enrolled && !recoveryOptions.legacy_password,
  );
  const rememberedPrefill = Boolean(
    rememberedHandle && normalizeHopUsername(username) === rememberedHandle,
  );
  const showingRememberedRecover = rememberedPrefill && !recovering;
  const showRecoverCta = (handleStatus === 'taken' || rememberedPrefill) && !recovering;
  const showRecoveryForm = (handleStatus === 'taken' || rememberedPrefill) && recovering;

  if (skipOnboarding) {
    return (
      <KeyboardAvoidingView
        style={[styles.wrap, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <ApiEnvironmentBanner compact />
          <Text style={styles.brand}>HOP</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>
            {busy ? 'Restoring this device…' : 'Could not restore HOP on this device.'}
          </Text>
          {(localError || error) && <Text style={styles.error}>{localError || error}</Text>}
          {__DEV__ && apiUrlUsesLoopback() ? <Text style={styles.error}>{LOOPBACK_API_DEVICE_HINT}</Text> : null}
          <Pressable
            onPress={() => {
              setBusy(true);
              setLocalError(null);
              continueOnDevice()
                .catch((err) => setLocalError(err instanceof Error ? err.message : 'Could not restore this device'))
                .finally(() => setBusy(false));
            }}
            disabled={busy}
            style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
            <Text style={styles.buttonLabel}>{busy ? 'Restoring…' : 'Try again'}</Text>
          </Pressable>
          <Pressable onPress={confirmEraseIdentity} disabled={busy}>
            <Text style={[styles.switch, { color: '#DC2626' }]}>Erase HOP identity from this device</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.wrap, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
        <ApiEnvironmentBanner compact />
        <Text style={styles.brand}>HOP</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>Choose a handle and hop in. No password.</Text>
        {rememberedHandle ? (
          <Text style={[styles.sub, { color: colors.muted }]}>{formatPreviousHopLabel(rememberedHandle)}</Text>
        ) : null}
        <View style={styles.hero}>
          <Avatar username={username || 'HOP'} color={avatarColor} uri={photoUri} size={96} borderColor={colors.tint} borderWidth={2} />
          <View style={styles.photoRow}>
            <Pressable onPress={() => void choosePhoto('library')}>
              <Text style={[styles.switch, { color: colors.tint, marginTop: 0 }]}>Add photo</Text>
            </Pressable>
            <Pressable onPress={() => void choosePhoto('camera')}>
              <Text style={[styles.switch, { color: colors.tint, marginTop: 0 }]}>Camera</Text>
            </Pressable>
            {photoUri ? (
              <Pressable onPress={() => setPhotoUri(null)}>
                <Text style={[styles.switch, { color: colors.muted, marginTop: 0 }]}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.colorGrid}>
          {LOCAL_AVATAR_COLORS.map((swatch) => (
            <Pressable
              key={swatch}
              onPress={() => setAvatarColor(swatch)}
              style={[
                styles.dot,
                { backgroundColor: swatch },
                avatarColor === swatch && { borderWidth: 3, borderColor: colors.tint, transform: [{ scale: 1.12 }] },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.hint, { color: colors.muted }]}>
          {photoUri ? 'Photo is your avatar.' : 'No photo? Initials on your color.'}
        </Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Handle"
          placeholderTextColor={colors.muted}
          value={username}
          onChangeText={setUsername}
          style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.tabIconDefault }]}
        />
        {handleStatus === 'taken' && !rememberedPrefill ? (
          <Text style={styles.error}>{HANDLE_TAKEN_RECOVER_COPY}</Text>
        ) : null}
        {handleStatus === 'invalid' && username.trim() ? (
          <Text style={styles.error}>3–20 characters, start with a letter, letters/numbers/_</Text>
        ) : null}
        {(localError || error) && <Text style={styles.error}>{localError || error}</Text>}
        {__DEV__ && apiUrlUsesLoopback() ? <Text style={styles.error}>{LOOPBACK_API_DEVICE_HINT}</Text> : null}
        {showRecoverCta ? (
          <Pressable
            onPress={() => {
              setLocalError(null);
              setRecovering(true);
            }}
            disabled={busy}
            style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
            <Text style={styles.buttonLabel}>{RECOVER_MY_HOP_LABEL}</Text>
          </Pressable>
        ) : null}
        {showingRememberedRecover ? (
          <Pressable onPress={useDifferentHandle} disabled={busy}>
            <Text style={[styles.switch, { color: colors.muted }]}>{USE_DIFFERENT_HANDLE_LABEL}</Text>
          </Pressable>
        ) : null}
        {showRecoveryForm ? (
          <>
            <Text style={[styles.hint, { color: colors.muted }]}>{HANDLE_IS_NOT_AUTH_MESSAGE}</Text>
            <Text style={[styles.hint, { color: colors.muted }]}>
              Recovery restores this identity only if the original keys are already on this iPhone, either because
              HOP ran here before or because this iPhone was set up from an encrypted backup of the old one. It never
              creates a second account or a replacement keypair.
            </Text>
            {showNoMethods ? <Text style={styles.error}>{NO_RECOVERY_METHODS_MESSAGE}</Text> : null}
            {showPasskeyNeedsNative ? <Text style={styles.error}>{PASSKEY_NATIVE_REQUIRED_MESSAGE}</Text> : null}
            {showPasskey ? (
              <Pressable
                onPress={() => void submitRecover({ method: 'passkey' })}
                disabled={busy}
                style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
                <Text style={styles.buttonLabel}>{busy ? 'Recovering…' : 'Continue with passkey'}</Text>
              </Pressable>
            ) : null}
            {showPassword && !showNoMethods ? (
              <>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  placeholder="One-time recovery password"
                  placeholderTextColor={colors.muted}
                  value={recoveryPassword}
                  onChangeText={setRecoveryPassword}
                  style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.tabIconDefault }]}
                />
                <Pressable
                  onPress={() => void submitRecover({ method: 'legacy_password_once', password: recoveryPassword })}
                  disabled={busy || recoveryPassword.length < 8}
                  style={[
                    styles.button,
                    { backgroundColor: colors.tint, opacity: busy || recoveryPassword.length < 8 ? 0.6 : 1 },
                  ]}>
                  <Text style={styles.buttonLabel}>{busy ? 'Recovering…' : RECOVER_MY_HOP_LABEL}</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              onPress={() => {
                setRecovering(false);
                setRecoveryPassword('');
                setLocalError(null);
              }}
              disabled={busy}>
              <Text style={[styles.switch, { color: colors.muted }]}>Choose a different handle</Text>
            </Pressable>
          </>
        ) : null}
        {handleStatus !== 'taken' && !rememberedPrefill ? (
          <Pressable
            onPress={() => void submitStart()}
            disabled={hopDisabled}
            style={[styles.button, { backgroundColor: colors.tint, opacity: hopDisabled ? 0.6 : 1 }]}>
            <Text style={styles.buttonLabel}>{busy ? 'Hopping…' : 'Start Hopping'}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center' },
  card: { gap: 12, padding: 24, flexGrow: 1, justifyContent: 'center' },
  brand: { fontSize: 40, fontWeight: '800', letterSpacing: 2 },
  sub: { fontSize: 16, marginBottom: 8 },
  hero: { alignItems: 'center', gap: 10, marginTop: 8 },
  photoRow: { flexDirection: 'row', gap: 16 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  dot: { width: 32, height: 32, borderRadius: 16 },
  hint: { textAlign: 'center', fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonLabel: { color: '#042f2e', fontWeight: '700', fontSize: 16 },
  switch: { textAlign: 'center', marginTop: 8, fontWeight: '600' },
  error: { color: '#DC2626' },
});
