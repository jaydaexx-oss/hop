import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { conversationTransportStatus, formatUnreadBadge, internetStatusAvailable } from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api, type Conversation } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { useOffline } from '@/src/offline/OfflineProvider';
import { useHopSocket } from '@/src/ws';

export default function ChatsScreen() {
  const { token, user } = useAuth();
  const { cacheConversation, listCachedConversations, syncNow, status, queuedCount, conversationPreview, service } =
    useOffline();
  const { peers, connectedId } = useBle();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [items, setItems] = useState<Conversation[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [unreads, setUnreads] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const cached = await listCachedConversations();
    if (cached.length > 0) {
      setItems(cached);
      const cachedPreviews: Record<string, string> = {};
      for (const convo of cached) {
        cachedPreviews[convo.id] = await conversationPreview(convo.id);
      }
      setPreviews(cachedPreviews);
      if (service && user?.id) setUnreads(await service.unreadCounts(user.id));
    }
    if (!token) return;
    try {
      const remote = await api.conversations(token);
      setItems(remote);
      setError(null);
      for (const convo of remote) {
        await cacheConversation(convo);
      }
      await syncNow();
      const nextPreviews: Record<string, string> = {};
      for (const convo of remote) {
        nextPreviews[convo.id] = await conversationPreview(convo.id);
      }
      setPreviews(nextPreviews);
      if (service && user?.id) setUnreads(await service.unreadCounts(user.id));
    } catch (err) {
      if (cached.length === 0) {
        setError(err instanceof Error ? err.message : 'Could not load chats');
      } else {
        setError(null);
      }
    }
  }, [token, user?.id, cacheConversation, listCachedConversations, syncNow, conversationPreview, service]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useHopSocket(token, (event) => {
    if (event.type === 'message') refresh();
  });

  return (
    <View style={styles.wrap}>
      <StatusBanner />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={items.length === 0 ? styles.emptyBox : undefined}
        ListEmptyComponent={
          <Text style={{ color: colors.muted }}>No chats yet. Start one from Contacts.</Text>
        }
        renderItem={({ item }) => {
          const transport = conversationTransportStatus({
            recipientId: item.peer.id,
            peers: peers.map((peer) => ({
              userId: peer.userId,
              sessionEstablished: peer.sessionEstablished,
              connected: connectedId === peer.deviceId,
            })),
            internetAvailable: internetStatusAvailable(status),
            conversationQueued: false,
            networkQueued: queuedCount > 0,
          });
          return (
            <Pressable
              onPress={() =>
                router.push(`/chat/${item.id}?peer=${item.peer.username}&peerId=${item.peer.id}`)
              }
              style={[styles.row, { backgroundColor: colors.card }]}>
              <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
                <Text style={styles.avatarLabel}>{item.peer.username.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.meta}>
                <Text style={styles.name}>{item.peer.username}</Text>
                <Text style={{ color: colors.muted }} numberOfLines={1}>
                  {previews[item.id] ?? 'No messages yet'}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{transport.line}</Text>
              </View>
              {formatUnreadBadge(unreads[item.id] ?? 0) ? (
                <View style={[styles.unread, { backgroundColor: colors.tint }]}>
                  <Text style={styles.unreadLabel}>{formatUnreadBadge(unreads[item.id] ?? 0)}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarLabel: { color: '#042f2e', fontWeight: '800', fontSize: 18 },
  meta: { flex: 1, backgroundColor: 'transparent' },
  name: { fontSize: 17, fontWeight: '700' },
  unread: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadLabel: { color: '#042f2e', fontWeight: '800', fontSize: 12 },
  emptyBox: { flexGrow: 1, justifyContent: 'center' },
  error: { color: '#DC2626', marginBottom: 8 },
});
