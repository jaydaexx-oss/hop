import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api, type Conversation } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { useOffline } from '@/src/offline/OfflineProvider';
import { useHopSocket } from '@/src/ws';

export default function ChatsScreen() {
  const { token } = useAuth();
  const { cacheConversation, listCachedConversations, syncNow } = useOffline();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [items, setItems] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const cached = await listCachedConversations();
    if (cached.length > 0) setItems(cached);
    if (!token) return;
    try {
      const remote = await api.conversations(token);
      setItems(remote);
      setError(null);
      for (const convo of remote) {
        await cacheConversation(convo);
      }
      await syncNow();
    } catch (err) {
      if (cached.length === 0) {
        setError(err instanceof Error ? err.message : 'Could not load chats');
      } else {
        setError(null);
      }
    }
  }, [token, cacheConversation, listCachedConversations, syncNow]);

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
        renderItem={({ item }) => (
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
              <Text style={{ color: colors.muted }}>Tap to open</Text>
            </View>
          </Pressable>
        )}
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
  emptyBox: { flexGrow: 1, justifyContent: 'center' },
  error: { color: '#DC2626', marginBottom: 8 },
});
