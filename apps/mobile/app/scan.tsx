import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { decodeHopQrPayload, hopQrContainsSecrets, SafetyError } from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { chatRoute, openPeerThread } from '@/src/chat/openPeerThread';
import { useOffline } from '@/src/offline/OfflineProvider';

export default function ScanHopCodeScreen() {
  const { token, user } = useAuth();
  const { cacheConversation, listCachedConversations, safety } = useOffline();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function openCode(value = raw) {
    setError(null);
    if (hopQrContainsSecrets(value)) {
      setError('That code is not a HOP username.');
      return;
    }
    const payload = decodeHopQrPayload(value);
    if (!payload) {
      setError('Enter a HOP username or hop:// code.');
      return;
    }
    if (!user) return;
    setBusy(true);
    try {
      let peerUserId = '';
      let peerUsername = payload.username;
      let peerPublicKey: string | undefined;
      if (token) {
        const found = await api.userByUsername(token, payload.username);
        peerUserId = found.id;
        peerUsername = found.username;
        peerPublicKey = found.identity_public_key || undefined;
      }
      if (!peerUserId) {
        setError('Could not find that HOP user yet.');
        return;
      }
      const thread = await openPeerThread({
        token,
        myId: user.id,
        peerUserId,
        peerUsername,
        peerPublicKey,
        cache: { listCached: listCachedConversations, cache: cacheConversation },
        safety,
      });
      router.replace(chatRoute(thread.conversation));
    } catch (err) {
      if (err instanceof SafetyError) setError(err.message);
      else setError(err instanceof Error ? err.message : 'Could not open that HOP code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Scan HOP Code</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Aim at a HOP QR, or paste a hop:// code / username. Unknown people open as a message
        request — not a normal chat.
      </Text>

      <View style={[styles.viewfinder, { borderColor: colors.tint }]}>
        {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => (
          <View
            key={pos}
            style={[
              styles.corner,
              { borderColor: colors.tint },
              pos === 'tl' && { top: -2, left: -2 },
              pos === 'tr' && { top: -2, right: -2, transform: [{ scaleX: -1 }] },
              pos === 'bl' && { bottom: -2, left: -2, transform: [{ scaleY: -1 }] },
              pos === 'br' && { bottom: -2, right: -2, transform: [{ scaleX: -1 }, { scaleY: -1 }] },
            ]}
          />
        ))}
        <Text style={[styles.cameraNote, { color: colors.muted }]}>
          Camera scanning needs a later Xcode native build. expo-camera is not in this app yet —
          paste a code below.
        </Text>
      </View>

      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="hop://u/username or username"
        placeholderTextColor={colors.muted}
        value={raw}
        onChangeText={setRaw}
        style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.tabIconDefault }]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={() => void openCode()}
        disabled={busy || raw.trim().length < 3}
        style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
        <Text style={styles.buttonLabel}>{busy ? 'Opening…' : 'Open as message request'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 10 },
  title: { fontSize: 28, fontWeight: '700' },
  lead: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  viewfinder: {
    alignSelf: 'center',
    width: 240,
    height: 240,
    borderRadius: 20,
    borderWidth: 1,
    marginVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#070B12',
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 6,
  },
  cameraNote: { textAlign: 'center', fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { color: '#042f2e', fontWeight: '700' },
  error: { color: '#DC2626' },
});
