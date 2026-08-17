import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { PeerSafetyRecord } from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { chatRoute, openPeerThread } from '@/src/chat/openPeerThread';
import { useOffline } from '@/src/offline/OfflineProvider';

export default function MessageRequestsScreen() {
  const { token, user } = useAuth();
  const { safety, cacheConversation, listCachedConversations } = useOffline();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [rows, setRows] = useState<PeerSafetyRecord[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

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
  }, [listCachedConversations, safety]);

  useEffect(() => {
    load().catch(() => undefined);
    if (!safety) return;
    return safety.onChange(() => {
      load().catch(() => undefined);
    });
  }, [load, safety]);

  async function open(row: PeerSafetyRecord) {
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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>Message requests</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Unknown nearby people and HOP codes land here until you accept. They cannot send more than
        one introduction.
      </Text>
      {rows.length === 0 ? (
        <Text style={{ color: colors.muted }}>No pending requests.</Text>
      ) : (
        rows.map((row) => (
          <Pressable
            key={row.peerId}
            onPress={() => open(row)}
            style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={styles.name}>{names[row.peerId] || 'HOP user'}</Text>
            <Text style={{ color: colors.muted }}>
              {row.relationship === 'incoming_request' ? 'Wants to message you' : 'Waiting for them to accept'}
            </Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 10 },
  title: { fontSize: 28, fontWeight: '700' },
  lead: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  card: { borderRadius: 16, padding: 14, gap: 4 },
  name: { fontSize: 18, fontWeight: '700' },
});
