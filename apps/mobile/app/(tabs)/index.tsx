import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  conversationTransportStatus,
  internetStatusAvailable,
  sortInboxConversations,
  userFacingLoadError,
} from '@hop/protocol';

import { ConversationRow, inboxTimestamp } from '@/components/ConversationRow';
import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api, type Conversation } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { useOffline } from '@/src/offline/OfflineProvider';
import { useHopSocket } from '@/src/ws';

type InboxRow = {
  id: string;
  created_at: string;
  conversation: Conversation;
  preview: string;
  unread: number;
  lastActivityAt: string;
  lastStatus: string | null;
  lastSenderId: string | null;
  lastSendSeq: number | null;
  lastMessageId: string | null;
  last?: {
    message_id: string;
    sender_id: string;
    created_at: string;
    send_seq?: number | null;
  } | null;
};

function fromConversation(
  convo: Conversation,
  local?: {
    preview: string;
    unread: number;
    last: {
      message_id: string;
      sender_id: string;
      created_at: string;
      send_seq?: number | null;
      status?: string;
    } | null;
  },
): InboxRow {
  return {
    id: convo.id,
    created_at: convo.created_at,
    conversation: convo,
    preview: local?.preview ?? 'No messages yet',
    unread: local?.unread ?? 0,
    lastActivityAt: local?.last?.created_at ?? convo.created_at,
    lastStatus: local?.last?.status ?? null,
    lastSenderId: local?.last?.sender_id ?? null,
    lastSendSeq: local?.last?.send_seq ?? null,
    lastMessageId: local?.last?.message_id ?? null,
    last: local?.last
      ? {
          message_id: local.last.message_id,
          sender_id: local.last.sender_id,
          created_at: local.last.created_at,
          send_seq: local.last.send_seq,
        }
      : null,
  };
}

export default function ChatsScreen() {
  const { token, user } = useAuth();
  const { cacheConversation, listCachedConversations, syncNow, status, queuedCount, service } = useOffline();
  const { peers, connectedId } = useBle();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [items, setItems] = useState<InboxRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const nearbyPeers = useMemo(
    () =>
      peers.map((peer) => ({
        userId: peer.userId,
        sessionEstablished: peer.sessionEstablished,
        connected: connectedId === peer.deviceId,
      })),
    [peers, connectedId],
  );

  const loadLocal = useCallback(async (): Promise<InboxRow[]> => {
    if (service && user?.id) {
      const inbox = await service.listInbox(user.id);
      return inbox.map((row) =>
        fromConversation(
          {
            id: row.id,
            created_at: row.created_at,
            peer: {
              id: row.peer_id ?? '',
              username: row.peer_username ?? 'HOP user',
              identity_public_key: row.peer_public_key ?? '',
            },
          },
          { preview: row.preview, unread: row.unread, last: row.last },
        ),
      );
    }
    const cached = await listCachedConversations();
    return cached.map((convo) => fromConversation(convo));
  }, [service, user?.id, listCachedConversations]);

  const refresh = useCallback(async () => {
    const local = await loadLocal();
    if (local.length > 0) setItems(sortInboxConversations(local));
    if (!token) return;
    try {
      const remote = await api.conversations(token);
      for (const convo of remote) {
        await cacheConversation(convo);
      }
      await syncNow();
      const next = await loadLocal();
      const byId = new Map(next.map((row) => [row.id, row]));
      const merged = remote.map((convo) => byId.get(convo.id) ?? fromConversation(convo));
      for (const row of next) {
        if (!merged.some((item) => item.id === row.id)) merged.push(row);
      }
      setItems(sortInboxConversations(merged));
      setError(null);
    } catch (err) {
      if (local.length === 0) setError(userFacingLoadError(err));
      else setError(null);
    }
  }, [token, cacheConversation, syncNow, loadLocal]);

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
        initialNumToRender={16}
        windowSize={8}
        ListEmptyComponent={
          <Text style={{ color: colors.muted }}>No chats yet. Start one from Contacts.</Text>
        }
        renderItem={({ item }) => {
          const transport = conversationTransportStatus({
            recipientId: item.conversation.peer.id,
            peers: nearbyPeers,
            internetAvailable: internetStatusAvailable(status),
            conversationQueued: item.lastStatus === 'QUEUED' || item.lastStatus === 'RETRYING',
            networkQueued: queuedCount > 0,
            lastOutboundStatus: item.lastSenderId === user?.id ? item.lastStatus : null,
          });
          return (
            <ConversationRow
              name={item.conversation.peer.username || 'HOP user'}
              preview={item.preview}
              timestamp={inboxTimestamp(item.lastActivityAt)}
              unread={item.unread}
              route={transport.route}
              lastOutboundStatus={item.lastSenderId === user?.id ? item.lastStatus : null}
              lastFromSelf={item.lastSenderId === user?.id}
              tint={colors.tint}
              muted={colors.muted}
              card={colors.card}
              textColor={colors.text}
              onPress={() =>
                router.push(
                  `/chat/${item.conversation.id}?peer=${encodeURIComponent(item.conversation.peer.username)}&peerId=${item.conversation.peer.id}`,
                )
              }
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  emptyBox: { flexGrow: 1, justifyContent: 'center' },
  error: { color: '#DC2626', marginBottom: 8 },
});
