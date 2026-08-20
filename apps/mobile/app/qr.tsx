import { useMemo } from 'react';
import { Pressable, Share, StyleSheet } from 'react-native';

import { encodeHopQrPayload, hopQrUri } from '@hop/protocol';

import { Avatar } from '@/components/Avatar';
import { HopQrGrid } from '@/components/HopQrGrid';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { useLocalAvatarColor } from '@/src/profile/useLocalAvatarColor';

export default function MyHopQrScreen() {
  const { user } = useAuth();
  const { color } = useLocalAvatarColor(user?.id);
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const payload = useMemo(() => {
    if (!user?.username) return null;
    return encodeHopQrPayload({ username: user.username });
  }, [user?.username]);
  const uri = payload ? hopQrUri(payload) : '';

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>My HOP Code</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Share this code so someone can send you a message request. It contains your HOP username
        and a short invite — never keys, MACs, device IDs, avatar color, or profile photo.
      </Text>
      {payload ? (
        <>
          <View style={styles.identity}>
            <Avatar username={payload.username} color={color} size={56} borderColor={colors.tint} borderWidth={2} />
            <View style={styles.identityText}>
              <Text style={styles.username}>@{payload.username}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Username + invite only</Text>
            </View>
          </View>
          <View style={styles.qrWrap}>
            <HopQrGrid value={uri} color="#06080F" />
          </View>
          <Text selectable style={[styles.uri, { color: colors.muted }]}>
            {uri}
          </Text>
          <Pressable
            onPress={() =>
              Share.share({
                message: `Add me on HOP! @${payload.username}\n${uri}`,
                title: 'My HOP code',
              }).catch(() => undefined)
            }
            style={[styles.button, { backgroundColor: colors.tint }]}>
            <Text style={styles.buttonLabel}>Share my code</Text>
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
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'transparent' },
  identityText: { backgroundColor: 'transparent' },
  username: { fontSize: 22, fontWeight: '700' },
  qrWrap: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 280,
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  uri: { fontSize: 13, textAlign: 'center' },
  button: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { color: '#042f2e', fontWeight: '700' },
});
