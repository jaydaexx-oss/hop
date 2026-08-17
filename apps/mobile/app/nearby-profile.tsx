import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { REPORT_CATEGORIES, SafetyError, type ReportCategory } from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { chatRoute, openPeerThread } from '@/src/chat/openPeerThread';
import { useOffline } from '@/src/offline/OfflineProvider';

export default function NearbyPublicProfileScreen() {
  const { userId, name, proximity, publicKey } = useLocalSearchParams<{
    userId?: string;
    name?: string;
    proximity?: string;
    publicKey?: string;
  }>();
  const { token, user } = useAuth();
  const { safety, cacheConversation, listCachedConversations } = useOffline();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [busy, setBusy] = useState(false);
  const displayName = name && name !== 'HOP user' ? name : 'HOP user';
  const title = useMemo(() => displayName, [displayName]);

  async function message() {
    if (!user || !userId) return;
    setBusy(true);
    try {
      const thread = await openPeerThread({
        token,
        myId: user.id,
        peerUserId: userId,
        peerUsername: displayName,
        peerPublicKey: publicKey,
        cache: { listCached: listCachedConversations, cache: cacheConversation },
        safety,
      });
      router.push(chatRoute(thread.conversation));
    } catch (err) {
      Alert.alert('Could not message', err instanceof SafetyError ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    if (!userId || !safety) return;
    await safety.block(userId);
    if (token && displayName !== 'HOP user') {
      await api.blockUser(token, displayName).catch(() => undefined);
    }
    Alert.alert('Blocked', 'They will not appear around you or in requests.');
    router.back();
  }

  async function mute() {
    if (!userId || !safety) return;
    const muted = await safety.isMuted(userId);
    await safety.setMuted(userId, !muted);
    Alert.alert(muted ? 'Unmuted' : 'Muted', muted ? 'Notifications are on again.' : 'Messages still arrive. Notifications are off.');
  }

  function report() {
    if (!userId || !safety) return;
    Alert.alert('Report', 'Choose a category. HOP does not attach the conversation transcript.', [
      ...REPORT_CATEGORIES.map((category) => ({
        text: category,
        onPress: () => void submitReport(category),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function submitReport(category: ReportCategory) {
    if (!userId || !safety) return;
    await safety.report(userId, category);
    if (token && displayName !== 'HOP user') {
      await api.reportUser(token, displayName, category).catch(() => undefined);
    }
    Alert.alert('Reported', 'Thanks. Report is separate from Block.');
  }

  return (
    <View style={styles.wrap}>
      <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
        <Text style={styles.avatarText}>{title.slice(0, 2).toUpperCase()}</Text>
      </View>
      <Text style={styles.name}>{title}</Text>
      <Text style={{ color: colors.muted, textAlign: 'center' }}>
        {proximity ? `${proximity} · Nearby HOP user` : 'Nearby HOP user'}
      </Text>
      <Text style={[styles.privacy, { color: colors.muted }]}>
        Public profile shows a HOP name only. No MAC, GPS, phone number, or device ID.
      </Text>
      <Pressable
        onPress={message}
        disabled={busy || !userId}
        style={[styles.button, { backgroundColor: colors.tint, opacity: userId ? 1 : 0.45 }]}>
        <Text style={styles.primary}>{busy ? 'Opening…' : 'Message request'}</Text>
      </Pressable>
      <Pressable onPress={mute} style={[styles.outline, { borderColor: colors.tint }]}>
        <Text style={{ color: colors.tint, fontWeight: '700' }}>Mute / Unmute</Text>
      </Pressable>
      <Pressable onPress={report} style={[styles.outline, { borderColor: colors.tint }]}>
        <Text style={{ color: colors.tint, fontWeight: '700' }}>Report</Text>
      </Pressable>
      <Pressable onPress={block} style={[styles.outline, { borderColor: '#DC2626' }]}>
        <Text style={{ color: '#DC2626', fontWeight: '700' }}>Block</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, alignItems: 'center', gap: 10 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  avatarText: { color: '#042f2e', fontWeight: '800', fontSize: 22 },
  name: { fontSize: 28, fontWeight: '700' },
  privacy: { fontSize: 13, textAlign: 'center', marginVertical: 8 },
  button: { width: '100%', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primary: { color: '#042f2e', fontWeight: '700' },
  outline: { width: '100%', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5 },
});
