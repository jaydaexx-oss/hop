import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  REPORT_CATEGORIES,
  conversationHasUndeliveredOutbox,
  conversationTransportStatus,
  formatUnreadBadge,
  inboxThreadClearPolicy,
  internetStatusAvailable,
  sortInboxConversations,
  userFacingLoadError,
  type ReportCategory,
} from '@hop/protocol';

import { ActionSheet } from '@/components/ActionSheet';
import { ConversationRow, inboxTimestamp } from '@/components/ConversationRow';
import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api, type Conversation } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { CHATS_SECTION_TITLES } from '@/src/chat/chatsInboxSections';
import { hideInboxConversation, loadHiddenInboxIds, restoreInboxConversation } from '@/src/chat/inboxHide';
import { createPersistentKv } from '@/src/nearby/kvStore';
import { useOffline } from '@/src/offline/OfflineProvider';
import { defaultLocalAvatarColor } from '@/src/profile/avatarAppearance';
import { useHopSocket } from '@/src/ws';

const hideKv = createPersistentKv();

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
  muted: boolean;
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
    muted?: boolean;
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
    muted: Boolean(local?.muted),
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
  const { cacheConversation, listCachedConversations, syncNow, status, queuedCount, service, safety, store } =
    useOffline();
  const { peers, connectedId } = useBle();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [items, setItems] = useState<InboxRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const [sheetRow, setSheetRow] = useState<InboxRow | null>(null);
  const [reportRow, setReportRow] = useState<InboxRow | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [undoNote, setUndoNote] = useState<string | null>(null);

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
    const mutedIds = safety ? await safety.mutedPeerIds() : new Set<string>();
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
            kind: row.kind === 'event' ? 'event' : 'direct',
            title: row.title ?? null,
            event_id: row.event_id ?? null,
            archived: Boolean(row.archived),
          },
          {
            preview: row.preview,
            unread: row.unread,
            muted: Boolean(row.peer_id && mutedIds.has(row.peer_id)),
            last: row.last,
          },
        ),
      );
    }
    const cached = await listCachedConversations();
    return cached.map((convo) =>
      fromConversation(convo, {
        preview: 'No messages yet',
        unread: 0,
        muted: Boolean(convo.peer.id && mutedIds.has(convo.peer.id)),
        last: null,
      }),
    );
  }, [service, user?.id, listCachedConversations, safety]);

  const refresh = useCallback(async () => {
    const hidden = user ? new Set(await loadHiddenInboxIds(hideKv, user.id)) : new Set<string>();
    const local = (await loadLocal()).filter((row) => !hidden.has(row.id));
    if (local.length > 0) setItems(sortInboxConversations(local));
    if (safety) {
      const requests = await safety.listRequests();
      setRequestCount(requests.filter((row) => row.relationship === 'incoming_request').length);
    }
    if (!token) return;
    try {
      const remote = await api.conversations(token);
      for (const convo of remote) {
        await cacheConversation(convo);
      }
      await syncNow();
      const next = (await loadLocal()).filter((row) => !hidden.has(row.id));
      const byId = new Map(next.map((row) => [row.id, row]));
      const merged = remote.map((convo) => byId.get(convo.id) ?? fromConversation(convo));
      for (const row of next) {
        if (!merged.some((item) => item.id === row.id)) merged.push(row);
      }
      const visible: InboxRow[] = [];
      for (const row of sortInboxConversations(merged)) {
        if (hidden.has(row.id)) continue;
        if (safety && row.conversation.kind !== 'event' && row.conversation.peer.id) {
          const vis = await safety.inboxVisibility(row.conversation.peer.id);
          if (vis !== 'chat') continue;
        }
        visible.push(row);
      }
      setItems(visible);
      setError(null);
    } catch (err) {
      if (local.length === 0) setError(userFacingLoadError(err));
      else setError(null);
    }
  }, [token, cacheConversation, syncNow, loadLocal, safety, user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!safety) return;
    return safety.onChange(() => {
      refresh().catch(() => undefined);
    });
  }, [refresh, safety]);

  useHopSocket(token, (event) => {
    if (event.type === 'message') refresh();
  });

  async function hideRow(row: InboxRow) {
    if (!user) return;
    let hasOutbox = false;
    if (store) {
      const messages = await store.listMessages(row.id);
      hasOutbox = conversationHasUndeliveredOutbox(
        messages.map((item) => ({ senderId: item.sender_id, status: item.status })),
        user.id,
      );
    }
    const policy = inboxThreadClearPolicy({ hasUndeliveredOutbox: hasOutbox });
    await hideInboxConversation(hideKv, user.id, row.id);
    setUndoId(row.id);
    setUndoNote(
      policy.preservesOutbox && hasOutbox
        ? 'Chat hidden. Queued messages will still send.'
        : 'Chat hidden.',
    );
    await refresh();
  }

  async function undoHide() {
    if (!user || !undoId) return;
    await restoreInboxConversation(hideKv, user.id, undoId);
    setUndoId(null);
    setUndoNote(null);
    await refresh();
  }

  async function runInboxAction(row: InboxRow, action: 'mute' | 'unmute' | 'block' | 'report' | 'hide', category?: ReportCategory) {
    const peerId = row.conversation.peer.id;
    const name = row.conversation.peer.username;
    if (action === 'hide') {
      await hideRow(row);
      return;
    }
    if (!safety || !peerId) return;
    if (action === 'mute') await safety.setMuted(peerId, true);
    else if (action === 'unmute') await safety.setMuted(peerId, false);
    else if (action === 'block') {
      await safety.block(peerId);
      if (token && name) await api.blockUser(token, name, peerId).catch(() => undefined);
    } else if (action === 'report' && category) {
      await safety.report(peerId, category);
      if (token && name) await api.reportUser(token, name, category).catch(() => undefined);
    }
    await refresh();
  }

  const requestBadge = formatUnreadBadge(requestCount);
  const directItems = items.filter((item) => item.conversation.kind !== 'event');
  const eventItems = items.filter((item) => item.conversation.kind === 'event');

  function chatHref(item: InboxRow): string {
    const convo = item.conversation;
    if (convo.kind === 'event') {
      return `/chat/${convo.id}?peer=${encodeURIComponent(convo.title || convo.peer.username)}&peerId=${encodeURIComponent(convo.peer.id)}&kind=event&eventId=${encodeURIComponent(convo.event_id || '')}&archived=${convo.archived ? '1' : '0'}`;
    }
    return `/chat/${convo.id}?peer=${encodeURIComponent(convo.peer.username)}&peerId=${convo.peer.id}`;
  }

  return (
    <View style={styles.wrap}>
      <StatusBanner />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={directItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={directItems.length === 0 && eventItems.length === 0 ? styles.emptyBox : undefined}
        initialNumToRender={16}
        windowSize={8}
        ListHeaderComponent={
          <View>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>
              {CHATS_SECTION_TITLES.message_requests}
            </Text>
            <Pressable
              onPress={() => router.push('/requests')}
              accessibilityRole="button"
              accessibilityLabel={`${CHATS_SECTION_TITLES.message_requests}, ${requestCount} pending`}
              style={[styles.requestsBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.requestsText}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{CHATS_SECTION_TITLES.message_requests}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {requestCount === 0 ? 'No pending introductions' : 'Unknown people wait here until you accept'}
                </Text>
              </View>
              {requestBadge ? (
                <View style={[styles.reqBadge, { backgroundColor: colors.tint }]}>
                  <Text style={styles.reqBadgeLabel}>{requestBadge}</Text>
                </View>
              ) : null}
            </Pressable>
            <Text style={[styles.sectionTitle, styles.directTitle, { color: colors.muted }]}>
              {CHATS_SECTION_TITLES.direct}
            </Text>
          </View>
        }
        ListFooterComponent={
          <View>
            <Text style={[styles.sectionTitle, styles.directTitle, { color: colors.muted }]}>
              {CHATS_SECTION_TITLES.events}
            </Text>
            {eventItems.length === 0 ? (
              <Text style={{ color: colors.muted, marginBottom: 16 }}>No event chats yet.</Text>
            ) : (
              eventItems.map((item) => (
                <ConversationRow
                  key={item.id}
                  name={item.conversation.title || item.conversation.peer.username || 'Event'}
                  preview={item.preview}
                  timestamp={inboxTimestamp(item.lastActivityAt)}
                  unread={item.unread}
                  isMuted={item.muted}
                  route={
                    conversationTransportStatus({
                      recipientId: item.conversation.peer.id,
                      peers: nearbyPeers,
                      internetAvailable: internetStatusAvailable(status),
                      conversationQueued: item.lastStatus === 'QUEUED' || item.lastStatus === 'RETRYING',
                      networkQueued: queuedCount > 0,
                      lastOutboundStatus: item.lastSenderId === user?.id ? item.lastStatus : null,
                    }).route
                  }
                  lastOutboundStatus={item.lastSenderId === user?.id ? item.lastStatus : null}
                  lastFromSelf={item.lastSenderId === user?.id}
                  tint={colors.event}
                  muted={colors.muted}
                  card={colors.card}
                  textColor={colors.text}
                  peerId={item.conversation.peer.id}
                  hasAvatar={false}
                  onPress={() => router.push(chatHref(item) as `/chat/${string}`)}
                  onLongPress={() => setSheetRow(item)}
                />
              ))
            )}
          </View>
        }
        ListEmptyComponent={
          eventItems.length === 0 ? (
            <Text style={{ color: colors.muted }}>No chats yet. Start one from Contacts.</Text>
          ) : null
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
              isMuted={item.muted}
              route={transport.route}
              lastOutboundStatus={item.lastSenderId === user?.id ? item.lastStatus : null}
              lastFromSelf={item.lastSenderId === user?.id}
              tint={colors.tint}
              muted={colors.muted}
              card={colors.card}
              textColor={colors.text}
              peerId={item.conversation.peer.id}
              hasAvatar={item.conversation.peer.has_avatar}
              onPress={() => router.push(chatHref(item) as `/chat/${string}`)}
              onLongPress={() => setSheetRow(item)}
            />
          );
        }}
      />
      {undoNote ? (
        <Pressable onPress={() => void undoHide()} style={[styles.undo, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.text, flex: 1 }}>{undoNote}</Text>
          <Text style={{ color: colors.tint, fontWeight: '800' }}>Undo</Text>
        </Pressable>
      ) : null}
      <ActionSheet
        visible={sheetRow != null}
        onDismiss={() => setSheetRow(null)}
        title={sheetRow?.conversation.peer.username || 'Chat'}
        subtitle="Mute, block, or hide locally"
        avatarColor={defaultLocalAvatarColor(sheetRow?.conversation.peer.id || 'hop')}
        avatarUserId={sheetRow?.conversation.peer.id}
        actions={
          sheetRow
            ? [
                {
                  label: sheetRow.muted ? 'Unmute' : 'Mute',
                  onPress: () => void runInboxAction(sheetRow, sheetRow.muted ? 'unmute' : 'mute'),
                },
                {
                  label: 'Hide chat',
                  onPress: () => void runInboxAction(sheetRow, 'hide'),
                },
                {
                  label: 'Report',
                  onPress: () => setReportRow(sheetRow),
                },
                {
                  label: 'Block',
                  destructive: true,
                  onPress: () => void runInboxAction(sheetRow, 'block'),
                },
              ]
            : []
        }
      />
      <ActionSheet
        visible={reportRow != null}
        onDismiss={() => setReportRow(null)}
        title="Report"
        subtitle="HOP does not attach the conversation transcript."
        actions={REPORT_CATEGORIES.map((category) => ({
          label: category,
          onPress: () => {
            if (reportRow) void runInboxAction(reportRow, 'report', category);
          },
        }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  directTitle: { marginTop: 8 },
  requestsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  requestsText: { flex: 1, backgroundColor: 'transparent', gap: 2 },
  reqBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  reqBadgeLabel: { color: '#042f2e', fontWeight: '800', fontSize: 12 },
  emptyBox: { flexGrow: 1, justifyContent: 'center' },
  error: { color: '#DC2626', marginBottom: 8 },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
});
