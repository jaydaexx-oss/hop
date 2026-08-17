import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  conversationPreviewLine,
  requestCardActions,
  requestCardCopy,
  type PeerSafetyRecord,
} from '@hop/protocol';

import { Avatar } from '@/components/Avatar';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { chatRoute, openPeerThread } from '@/src/chat/openPeerThread';
import { useOffline } from '@/src/offline/OfflineProvider';
import { defaultLocalAvatarColor } from '@/src/profile/avatarAppearance';

export default function MessageRequestsScreen() {
  const { token, user } = useAuth();
  const { safety, store, cacheConversation, listCachedConversations } = useOffline();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [rows, setRows] = useState<PeerSafetyRecord[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!safety) return;
    const next = await safety.listRequests();
    setRows(next);
    const cached = await listCachedConversations();
    const map: Record<string, string> = {};
    for (const convo of cached) {
      if (convo.peer.id) map[convo.peer.id] = convo.peer.username;
    }
    setNames(map);
    const intro: Record<string, string> = {};
    if (store) {
      for (const row of next) {
        if (!row.introMessageId) continue;
        const message = await store.getMessage(row.introMessageId);
        if (message) intro[row.peerId] = conversationPreviewLine(message);
      }
    }
    setPreviews(intro);
  }, [listCachedConversations, safety, store]);

  useEffect(() => {
    load().catch(() => undefined);
    if (!safety) return;
    return safety.onChange(() => {
      load().catch(() => undefined);
    });
  }, [load, safety]);

  async function openAccepted(row: PeerSafetyRecord) {
    if (!user) return;
    const thread = await openPeerThread({
      token,
      myId: user.id,
      peerUserId: row.peerId,
      peerUsername: names[row.peerId] || 'HOP user',
      cache: { listCached: listCachedConversations, cache: cacheConversation },
      safety,
    });
    router.push(chatRoute(thread.conversation));
  }

  async function run(row: PeerSafetyRecord, action: 'accept' | 'decline' | 'block') {
    if (!safety) return;
    setBusyId(row.peerId);
    try {
      if (action === 'accept') {
        await safety.markAccepted(row.peerId);
        await openAccepted(row);
      } else if (action === 'decline') {
        await safety.decline(row.peerId);
      } else {
        await safety.block(row.peerId);
        const name = names[row.peerId];
        if (token && name && name !== 'HOP user') {
          await api.blockUser(token, name).catch(() => undefined);
        }
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const incomingCount = rows.filter((row) => row.relationship === 'incoming_request').length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>Message requests</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Unknown nearby people and HOP codes land here until you accept. They cannot send more than
        one introduction.
      </Text>
      {incomingCount > 0 ? (
        <Text style={[styles.count, { color: colors.tint }]}>
          {incomingCount} pending
        </Text>
      ) : null}
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>All clear</Text>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>No pending message requests.</Text>
        </View>
      ) : (
        rows.map((row) => {
          const name = names[row.peerId] || 'HOP user';
          const copy = requestCardCopy({
            relationship: row.relationship,
            displayName: name,
            introPreview: previews[row.peerId],
          });
          const actions = requestCardActions(row.relationship);
          const busy = busyId === row.peerId;
          return (
            <View key={row.peerId} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.senderRow}>
                <Avatar username={name} color={defaultLocalAvatarColor(row.peerId)} size={46} />
                <View style={styles.senderInfo}>
                  <Text style={styles.name}>{copy.title}</Text>
                  <Text style={{ color: colors.muted }}>{copy.subtitle}</Text>
                </View>
              </View>
              <View style={[styles.preview, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={{ color: colors.text }}>{copy.preview}</Text>
              </View>
              <View style={styles.btnRow}>
                {actions.includes('accept') ? (
                  <Pressable
                    onPress={() => void run(row, 'accept')}
                    disabled={busy}
                    style={[styles.acceptBtn, { backgroundColor: colors.tint, opacity: busy ? 0.5 : 1 }]}>
                    <Text style={styles.acceptText}>Accept</Text>
                  </Pressable>
                ) : null}
                {actions.includes('decline') ? (
                  <Pressable
                    onPress={() => void run(row, 'decline')}
                    disabled={busy}
                    style={[styles.declineBtn, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Decline</Text>
                  </Pressable>
                ) : null}
                {actions.includes('block') ? (
                  <Pressable
                    onPress={() => void run(row, 'block')}
                    disabled={busy}
                    style={[styles.blockBtn, { borderColor: colors.destructive }]}>
                    <Text style={{ color: colors.destructive, fontWeight: '700' }}>Block</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 12, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '700' },
  lead: { fontSize: 15, lineHeight: 21, marginBottom: 4 },
  count: { fontSize: 13, fontWeight: '700' },
  card: { borderRadius: 16, padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'transparent' },
  senderInfo: { flex: 1, backgroundColor: 'transparent' },
  name: { fontSize: 16, fontWeight: '700' },
  preview: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10 },
  btnRow: { flexDirection: 'row', gap: 8, backgroundColor: 'transparent' },
  acceptBtn: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  acceptText: { color: '#042f2e', fontWeight: '800' },
  declineBtn: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1 },
  blockBtn: { paddingHorizontal: 16, borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1 },
  empty: { alignItems: 'center', paddingTop: 48, gap: 8, backgroundColor: 'transparent' },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
});
