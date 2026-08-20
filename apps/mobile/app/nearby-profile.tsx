import { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { REPORT_CATEGORIES, type ReportCategory } from '@hop/protocol';

import { ActionSheet } from '@/components/ActionSheet';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { chatRoute, openPeerThread } from '@/src/chat/openPeerThread';
import { useOffline } from '@/src/offline/OfflineProvider';
import { defaultLocalAvatarColor } from '@/src/profile/avatarAppearance';

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
  const [reportOpen, setReportOpen] = useState(false);
  const displayName = name && name !== 'HOP user' ? name : 'HOP user';
  const title = useMemo(() => displayName, [displayName]);
  const avatarColor = defaultLocalAvatarColor(userId || displayName);

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
    } catch {
      setBusy(false);
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    if (!userId || !safety) return;
    await safety.block(userId);
    if (token) {
      await api.blockUser(token, displayName === 'HOP user' ? '' : displayName, userId).catch(() => undefined);
    }
    router.back();
  }

  async function mute() {
    if (!userId || !safety) return;
    const muted = await safety.isMuted(userId);
    await safety.setMuted(userId, !muted);
  }

  async function submitReport(category: ReportCategory) {
    if (!userId || !safety) return;
    await safety.report(userId, category);
    if (token && displayName !== 'HOP user') {
      await api.reportUser(token, displayName, category).catch(() => undefined);
    }
  }

  return (
    <View style={styles.wrap}>
      <ProfileAvatar
        userId={userId}
        username={title}
        color={avatarColor}
        size={88}
        borderColor={colors.tint}
        borderWidth={2}
      />
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
      <Pressable onPress={() => void mute()} style={[styles.outline, { borderColor: colors.tint }]}>
        <Text style={{ color: colors.tint, fontWeight: '700' }}>Mute / Unmute</Text>
      </Pressable>
      <Pressable onPress={() => setReportOpen(true)} style={[styles.outline, { borderColor: colors.tint }]}>
        <Text style={{ color: colors.tint, fontWeight: '700' }}>Report</Text>
      </Pressable>
      <Pressable onPress={() => void block()} style={[styles.outline, { borderColor: colors.destructive }]}>
        <Text style={{ color: colors.destructive, fontWeight: '700' }}>Block</Text>
      </Pressable>
      <ActionSheet
        visible={reportOpen}
        onDismiss={() => setReportOpen(false)}
        title="Report"
        subtitle="HOP does not attach the conversation transcript."
        actions={REPORT_CATEGORIES.map((category) => ({
          label: category,
          onPress: () => void submitReport(category),
        }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, alignItems: 'center', gap: 10 },
  name: { fontSize: 28, fontWeight: '700' },
  privacy: { fontSize: 13, textAlign: 'center', marginVertical: 8 },
  button: { width: '100%', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primary: { color: '#042f2e', fontWeight: '700' },
  outline: { width: '100%', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5 },
});
