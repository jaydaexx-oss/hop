import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { HOP_USERNAME_RE, LOCAL_AVATAR_COLORS, normalizeHopUsername } from '@hop/protocol';
import { api } from '@/src/api/hop';
import { LOOPBACK_API_DEVICE_HINT, apiUrlUsesLoopback } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthProvider';
import { loadToken } from '@/src/auth/storage';
import { POST_LOGIN_HREF } from '@/src/navigation/tabOrder';
import { createPersistentKv } from '@/src/nearby/kvStore';
import { defaultLocalAvatarColor, saveLocalAvatarColor } from '@/src/profile/avatarAppearance';
import { pickPreparedProfilePhoto } from '@/src/profile/pickProfilePhoto';
import { uploadProfilePhotoFile } from '@/src/profile/profilePhotoCache';

const kv = createPersistentKv();

export default function LoginScreen() {
  const { user, token, startHopping, continueOnDevice, login, refreshUser, skipOnboarding, error } = useAuth();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [mode, setMode] = useState<'hop' | 'password'>(skipOnboarding ? 'password' : 'hop');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [handleStatus, setHandleStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [avatarColor, setAvatarColor] = useState(() => defaultLocalAvatarColor('hop'));

  useEffect(() => {
    if (skipOnboarding) setMode('password');
  }, [skipOnboarding]);

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
          if (!cancelled) setHandleStatus(result.available ? 'ok' : 'taken');
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

  if (user && token) return <Redirect href={POST_LOGIN_HREF} />;
  if (user && skipOnboarding && !token && mode !== 'password') return <Redirect href={POST_LOGIN_HREF} />;

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

  async function submitPassword() {
    setBusy(true);
    setLocalError(null);
    try {
      await login(username, password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Something went wrong');
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

  const hopDisabled = busy || handleStatus !== 'ok';

  if (mode === 'password') {
    return (
      <KeyboardAvoidingView
        style={[styles.wrap, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Text style={styles.brand}>HOP</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>
            {skipOnboarding ? 'Welcome back.' : 'Existing username and password.'}
          </Text>
          {skipOnboarding ? (
            <Pressable
              onPress={() => {
                setBusy(true);
                setLocalError(null);
                continueOnDevice()
                  .catch((err) => setLocalError(err instanceof Error ? err.message : 'Could not continue'))
                  .finally(() => setBusy(false));
              }}
              disabled={busy}
              style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
              <Text style={styles.buttonLabel}>Continue on this device</Text>
            </Pressable>
          ) : null}
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Username"
            placeholderTextColor={colors.muted}
            value={username}
            onChangeText={setUsername}
            style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.tabIconDefault }]}
          />
          <TextInput
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={colors.muted}
            value={password}
            onChangeText={setPassword}
            style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.tabIconDefault }]}
          />
          {(localError || error) && <Text style={styles.error}>{localError || error}</Text>}
          {__DEV__ && apiUrlUsesLoopback() ? <Text style={styles.error}>{LOOPBACK_API_DEVICE_HINT}</Text> : null}
          <Pressable
            onPress={() => void submitPassword()}
            disabled={busy || !username || password.length < 8}
            style={[styles.button, { backgroundColor: colors.tint, opacity: busy || !username || password.length < 8 ? 0.6 : 1 }]}>
            <Text style={styles.buttonLabel}>Log in</Text>
          </Pressable>
          {!skipOnboarding ? (
            <Pressable onPress={() => setMode('hop')}>
              <Text style={[styles.switch, { color: colors.tint }]}>New here? Start hopping</Text>
            </Pressable>
          ) : null}
          {__DEV__ ? (
            <Pressable onPress={() => router.push('/device-diagnostics')}>
              <Text style={[styles.switch, { color: colors.tint }]}>Device diagnostics</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.wrap, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>HOP</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>Choose a handle and hop in. No password.</Text>
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
        {handleStatus === 'taken' ? <Text style={styles.error}>That handle is taken</Text> : null}
        {handleStatus === 'invalid' && username.trim() ? (
          <Text style={styles.error}>3–20 characters, start with a letter, letters/numbers/_</Text>
        ) : null}
        {(localError || error) && <Text style={styles.error}>{localError || error}</Text>}
        {__DEV__ && apiUrlUsesLoopback() ? <Text style={styles.error}>{LOOPBACK_API_DEVICE_HINT}</Text> : null}
        <Pressable
          onPress={() => void submitStart()}
          disabled={hopDisabled}
          style={[styles.button, { backgroundColor: colors.tint, opacity: hopDisabled ? 0.6 : 1 }]}>
          <Text style={styles.buttonLabel}>{busy ? 'Hopping…' : 'Start Hopping'}</Text>
        </Pressable>
        <Pressable onPress={() => setMode('password')}>
          <Text style={[styles.switch, { color: colors.muted }]}>I already have an account</Text>
        </Pressable>
        {__DEV__ ? (
          <Pressable onPress={() => router.push('/device-diagnostics')}>
            <Text style={[styles.switch, { color: colors.tint }]}>Device diagnostics</Text>
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
