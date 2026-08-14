import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { useOffline } from '@/src/offline/OfflineProvider';

export default function ContactsScreen() {
  const { token } = useAuth();
  const { cacheConversation } = useOffline();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startChat() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const convo = await api.createConversation(token, username.trim());
      await cacheConversation(convo);
      router.push(`/chat/${convo.id}?peer=${convo.peer.username}&peerId=${convo.peer.id}`);
      setUsername('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start chat');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <StatusBanner />
      <Text style={styles.title}>Start a chat</Text>
      <Text style={{ color: colors.muted, marginBottom: 12 }}>
        Enter a HOP username. Contacts are never uploaded from your address book.
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="username"
        placeholderTextColor={colors.muted}
        value={username}
        onChangeText={setUsername}
        style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.tabIconDefault }]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={startChat}
        disabled={busy || username.trim().length < 3}
        style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
        <Text style={styles.buttonLabel}>Message</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { marginTop: 12, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { color: '#042f2e', fontWeight: '700', fontSize: 16 },
  error: { color: '#DC2626', marginTop: 8 },
});
