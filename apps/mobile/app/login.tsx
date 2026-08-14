import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';

export default function LoginScreen() {
  const { user, login, register, error } = useAuth();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (user) return <Redirect href="/" />;

  async function submit() {
    setBusy(true);
    setLocalError(null);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.wrap, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.brand}>HOP</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>Messages find a way.</Text>
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
        <Pressable
          onPress={submit}
          disabled={busy || !username || password.length < 8}
          style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
          <Text style={styles.buttonLabel}>{mode === 'login' ? 'Log in' : 'Create account'}</Text>
        </Pressable>
        <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
          <Text style={[styles.switch, { color: colors.tint }]}>
            {mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { gap: 12 },
  brand: { fontSize: 40, fontWeight: '800', letterSpacing: 2 },
  sub: { fontSize: 16, marginBottom: 12 },
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
