import { useMemo } from 'react';
import { Pressable, Share, StyleSheet } from 'react-native';

import { encodeHopQrPayload, hopQrUri } from '@hop/protocol';

import { HopQrGrid } from '@/components/HopQrGrid';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';

export default function MyHopQrScreen() {
  const { user } = useAuth();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const payload = useMemo(() => {
    if (!user?.username) return null;
    return encodeHopQrPayload({ username: user.username });
  }, [user?.username]);
  const uri = payload ? hopQrUri(payload) : '';

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>My HOP QR Code</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Share this code so someone can send you a message request. It contains your HOP username
        and a short invite — never keys, MACs, or device IDs.
      </Text>
      {payload ? (
        <>
          <HopQrGrid value={uri} color={colors.text} />
          <Text style={styles.username}>{payload.username}</Text>
          <Text selectable style={[styles.uri, { color: colors.muted }]}>
            {uri}
          </Text>
          <Pressable
            onPress={() => Share.share({ message: uri, title: 'My HOP code' }).catch(() => undefined)}
            style={[styles.button, { backgroundColor: colors.tint }]}>
            <Text style={styles.buttonLabel}>Share HOP code</Text>
          </Pressable>
        </>
      ) : (
        <Text style={{ color: colors.muted }}>Sign in to show your HOP code.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  lead: { fontSize: 15, lineHeight: 21 },
  username: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  uri: { fontSize: 13, textAlign: 'center' },
  button: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { color: '#042f2e', fontWeight: '700' },
});
