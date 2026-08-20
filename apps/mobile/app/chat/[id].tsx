import { useFocusEffect, useLocalSearchParams, useNavigation, Redirect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CHAT_PAGE_SIZE,
  DEFAULT_TTL_MS,
  MAX_APPLICATION_TEXT_CHARS,
  REPORT_CATEGORIES,
  applyOptimisticSendFailure,
  conversationTransportStatus,
  formatNetworkStatus,
  internetStatusAvailable,
  isComposerSendable,
  isFailedMessageStatus,
  isInFlightOutboundStatus,
  isPinnedToLatest,
  mergeChatWindow,
  shouldAutoScrollOnIncoming,
  shouldMarkConversationRead,
  userFacingLoadError,
  userFacingSendError,
  type PeerSafetyRecord,
  type ReportCategory,
  type StoredMessage,
} from '@hop/protocol';

import { MessageBubble } from '@/components/MessageBubble';
import { PTTButton, type VoiceClip } from '@/components/PTTButton';
import { ActionSheet } from '@/components/ActionSheet';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { type ChatMessage, api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { sendChatText, sendChatVoice, sendEventChatText } from '@/src/chat/sendChat';
import { storedToChat, useOffline } from '@/src/offline/OfflineProvider';
import { clearVoicePlaybackTemps } from '@/src/voice/cache';
import { useHopSocket } from '@/src/ws';

export default function ChatScreen() {
  const { id, peer, peerId, kind, eventId, archived } = useLocalSearchParams<{
    id: string;
    peer?: string;
    peerId?: string;
    kind?: string;
    eventId?: string;
    archived?: string;
  }>();
  const { token, user } = useAuth();
  const { service, store, syncNow, ready: offlineReady, status, queuedCount, safety, cacheConversation } = useOffline();
  const { peers, connectedId } = useBle();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState(peerId ?? '');
  const [inputMode, setInputMode] = useState<'text' | 'ptt'>('text');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newIncoming, setNewIncoming] = useState(0);
  const [safetyRecord, setSafetyRecord] = useState<PeerSafetyRecord | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [eventRecipientIds, setEventRecipientIds] = useState<string[]>([]);
  const [eventArchived, setEventArchived] = useState(archived === '1');
  const isEventChat = kind === 'event';
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const pinnedToLatest = useRef(true);
  const sendLock = useRef(false);
  const focusedRef = useRef(false);
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  const lastOutbound = useMemo(
    () => [...messages].reverse().find((row) => row.sender_id === user?.id),
    [messages, user?.id],
  );
  const conversationQueued = messages.some(
    (row) => row.sender_id === user?.id && isInFlightOutboundStatus(row.status),
  );
  const needsOutboxPoll = messages.some((row) => isInFlightOutboundStatus(row.status));
  const transportView = conversationTransportStatus({
    recipientId,
    peers: peers.map((item) => ({
      userId: item.userId,
      sessionEstablished: item.sessionEstablished,
      connected: connectedId === item.deviceId,
    })),
    internetAvailable: internetStatusAvailable(status),
    conversationQueued,
    networkQueued: queuedCount > 0,
    lastOutboundStatus: lastOutbound?.status,
    relaying: lastOutbound?.status === 'RELAYING',
  });
  const canSend = isComposerSendable(draft, {
    sending: sendLock.current || sending,
    locked:
      eventArchived ||
      (!isEventChat &&
        (safetyRecord?.relationship === 'outgoing_request' ||
          safetyRecord?.relationship === 'incoming_request' ||
          safetyRecord?.relationship === 'blocked' ||
          safetyRecord?.relationship === 'declined')),
  });
  const invertedData = useMemo(() => [...messages].reverse(), [messages]);

  const mergeRows = useCallback((incoming: ChatMessage[]) => {
    setMessages((current) => mergeChatWindow(current, incoming));
  }, []);

  const refreshSafety = useCallback(async () => {
    if (isEventChat) return;
    if (!safety || !recipientId) return;
    setSafetyRecord(await safety.get(recipientId));
  }, [isEventChat, recipientId, safety]);

  useEffect(() => {
    if (!isEventChat || !token || !eventId || !user) return;
    void api.getEvent(token, eventId).then(async (event) => {
      setEventArchived(event.conversation_archived || event.status === 'ended');
      setEventRecipientIds(event.members.map((member) => member.id).filter((memberId) => memberId !== user.id));
      await cacheConversation({
        id: event.conversation_id,
        created_at: event.starts_at,
        peer: {
          id: event.host.id,
          username: event.name,
          identity_public_key: event.host.identity_public_key,
          has_avatar: event.host.has_avatar,
        },
        kind: 'event',
        title: event.name,
        event_id: event.id,
        archived: event.conversation_archived,
        members: event.members,
      });
    }).catch(() => undefined);
  }, [cacheConversation, eventId, isEventChat, token, user]);

  const markReadIfActive = useCallback(async () => {
    if (!id || !service || !userIdRef.current) return;
    if (
      !shouldMarkConversationRead({
        isConversationScreenFocused: focusedRef.current,
        appState: AppState.currentState,
      })
    ) {
      return;
    }
    if (safety && recipientId) {
      const record = await safety.get(recipientId);
      if (record?.relationship === 'incoming_request' || record?.relationship === 'blocked') return;
    }
    await service.markConversationRead(id, userIdRef.current).catch(() => undefined);
  }, [id, recipientId, safety, service]);

  const runPeerAction = useCallback(
    async (action: 'block' | 'unblock' | 'mute' | 'unmute' | 'accept' | 'decline' | 'report', category?: ReportCategory) => {
      if (!safety || !recipientId) return;
      if (action === 'block') {
        await safety.block(recipientId);
        if (token && peer) await api.blockUser(token, String(peer)).catch(() => undefined);
      } else if (action === 'unblock') {
        await safety.unblock(recipientId);
        if (token && peer) await api.unblockUser(token, String(peer)).catch(() => undefined);
      } else if (action === 'mute') await safety.setMuted(recipientId, true);
      else if (action === 'unmute') await safety.setMuted(recipientId, false);
      else if (action === 'accept') await safety.markAccepted(recipientId);
      else if (action === 'decline') await safety.decline(recipientId);
      else if (action === 'report' && category) {
        await safety.report(recipientId, category);
        if (token && peer) await api.reportUser(token, String(peer), category).catch(() => undefined);
      }
      await refreshSafety();
    },
    [peer, recipientId, refreshSafety, safety, token],
  );

  function openSafetyMenu() {
    setSheetOpen(true);
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.headerTitle} accessibilityRole="header">
          <Text style={styles.headerName} numberOfLines={1}>
            {peer || 'Chat'}
          </Text>
          <Text style={[styles.headerStatus, { color: colors.muted }]} numberOfLines={1}>
            {transportView.line}
          </Text>
        </View>
      ),
      headerRight: () => (
        <Pressable onPress={openSafetyMenu} accessibilityLabel="Chat options" style={styles.headerMenu}>
          <Text style={{ color: colors.tint, fontWeight: '700' }}>More</Text>
        </Pressable>
      ),
    });
  }, [navigation, peer, transportView.line, colors.muted, colors.tint, safetyRecord]);

  useEffect(() => {
    return () => {
      clearVoicePlaybackTemps().catch(() => undefined);
    };
  }, []);

  const loadLatest = useCallback(async () => {
    if (!id || !service) return;
    const page = await service.listMessagesPage(id, { limit: CHAT_PAGE_SIZE });
    setHasOlder(page.hasOlder);
    setMessages((current) => mergeChatWindow(current, page.rows.map(storedToChat)));
    if (!recipientId && store) {
      const convos = await store.listConversations();
      const match = convos.find((row) => row.id === id);
      if (match?.peer_id) setRecipientId(match.peer_id);
    }
  }, [id, service, store, recipientId]);

  useEffect(() => {
    refreshSafety().catch(() => undefined);
    if (!safety) return;
    return safety.onChange(() => {
      refreshSafety().catch(() => undefined);
    });
  }, [refreshSafety, safety]);

  useEffect(() => {
    loadLatest()
      .then(() => syncNow())
      .then(() => loadLatest())
      .catch((err) => setError(userFacingLoadError(err)));
  }, [loadLatest, syncNow]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      focusedRef.current = true;
      const run = () => {
        if (!alive) return;
        markReadIfActive().then(() => loadLatest()).catch(() => undefined);
      };
      run();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') run();
      });
      return () => {
        alive = false;
        focusedRef.current = false;
        sub.remove();
      };
    }, [markReadIfActive, loadLatest]),
  );

  useEffect(() => {
    if (!service || !id || !needsOutboxPoll) return;
    const tick = setInterval(() => {
      loadLatest().catch(() => undefined);
    }, 3_000);
    return () => clearInterval(tick);
  }, [service, id, needsOutboxPoll, loadLatest]);

  useHopSocket(token, (event) => {
    const incoming = event.message as (ChatMessage & Partial<StoredMessage>) | undefined;
    if (!incoming || incoming.conversation_id !== id || !service) return;
    const stored: StoredMessage = {
      message_id: incoming.message_id,
      conversation_id: incoming.conversation_id,
      sender_id: incoming.sender_id,
      recipient_id: incoming.recipient_id,
      text: incoming.text,
      encrypted_payload: incoming.encrypted_payload ?? '',
      status: incoming.status,
      transport: incoming.transport ?? 'internet',
      created_at: incoming.created_at,
      expires_at: incoming.expires_at ?? new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
      ttl: incoming.ttl ?? DEFAULT_TTL_MS,
      hop_count: incoming.hop_count ?? 0,
    };
    const fromSelf = incoming.sender_id === userIdRef.current;
    service
      .acceptInbound(stored)
      .then(async () => {
        await markReadIfActive();
        return service.listMessagesPage(id, { limit: CHAT_PAGE_SIZE });
      })
      .then((page) => {
        mergeRows(page.rows.map(storedToChat));
        const shouldScroll = shouldAutoScrollOnIncoming({
          fromSelf,
          pinnedToLatest: pinnedToLatest.current,
        });
        if (shouldScroll) {
          setNewIncoming(0);
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        } else if (!fromSelf) {
          if (!safetyRecord?.muted) setNewIncoming((count) => count + 1);
        }
      })
      .catch(() => undefined);
  });

  const loadOlder = useCallback(async () => {
    if (!id || !service || loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const page = await service.listMessagesPage(id, {
        beforeMessageId: messages[0]?.message_id,
        limit: CHAT_PAGE_SIZE,
      });
      setHasOlder(page.hasOlder);
      mergeRows(page.rows.map(storedToChat));
    } finally {
      setLoadingOlder(false);
    }
  }, [id, service, loadingOlder, hasOlder, messages, mergeRows]);

  if (!user) return <Redirect href="/login" />;
  if (!offlineReady) return null;
  const me = user;

  async function send() {
    if (!id || !service || !isComposerSendable(draft, { sending: sendLock.current })) return;
    if (isEventChat) {
      if (eventArchived) {
        setError('Event chat is archived');
        return;
      }
      if (eventRecipientIds.length === 0) {
        setError('Cannot send without a real recipient');
        return;
      }
    } else if (!recipientId || recipientId === me.id) {
      setError('Cannot send without a real recipient');
      return;
    }
    const text = draft.trim();
    sendLock.current = true;
    setSending(true);
    setDraft('');
    setError(null);
    pinnedToLatest.current = true;
    setNewIncoming(0);
    let allocatedId: string | undefined;
    let flushed: StoredMessage | undefined;
    try {
      flushed = isEventChat
        ? await sendEventChatText(service, {
            conversation_id: id,
            sender_id: me.id,
            recipient_ids: eventRecipientIds,
            text,
            archived: eventArchived,
            onAllocated: (row) => {
              allocatedId = row.message_id;
              sendLock.current = false;
              setSending(false);
              mergeRows([storedToChat(row)]);
              listRef.current?.scrollToOffset({ offset: 0, animated: true });
            },
          })
        : await sendChatText(service, {
            conversation_id: id,
            sender_id: me.id,
            recipient_id: recipientId,
            text,
            onAllocated: (row) => {
              allocatedId = row.message_id;
              sendLock.current = false;
              setSending(false);
              mergeRows([storedToChat(row)]);
              listRef.current?.scrollToOffset({ offset: 0, animated: true });
            },
          });
      mergeRows([storedToChat(flushed)]);
      await syncNow();
      await loadLatest();
    } catch (err) {
      await loadLatest().catch(() => undefined);
      const failedId = allocatedId;
      if (!flushed && failedId) {
        setMessages((current) => applyOptimisticSendFailure(current, failedId));
      }
      setError(flushed ? userFacingLoadError(err) : userFacingSendError(err));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function retryFailed(messageId: string) {
    if (!id || !service) return;
    const existing = messages.find((row) => row.message_id === messageId);
    setError(null);
    let outcome: StoredMessage | undefined;
    try {
      const retried = await service.retryFailed(messageId);
      if (retried) {
        outcome = retried;
        mergeRows([storedToChat(retried)]);
      } else if (existing?.text) {
        outcome = await sendChatText(service, {
          conversation_id: id,
          sender_id: me.id,
          recipient_id: recipientId,
          text: existing.text,
          message_id: existing.message_id,
          send_seq: existing.send_seq ?? undefined,
          onAllocated: (row) => mergeRows([storedToChat(row)]),
        });
        mergeRows([storedToChat(outcome)]);
      }
      await syncNow();
      await loadLatest();
    } catch (err) {
      await loadLatest().catch(() => undefined);
      if (!outcome) {
        setMessages((current) => applyOptimisticSendFailure(current, messageId));
      }
      setError(outcome ? userFacingLoadError(err) : userFacingSendError(err));
    }
  }

  async function sendVoice(clip: VoiceClip) {
    if (safetyRecord?.relationship === 'outgoing_request' ||
        safetyRecord?.relationship === 'incoming_request' ||
        safetyRecord?.relationship === 'blocked' ||
        safetyRecord?.relationship === 'declined') {
      setError(userFacingSendError(new Error('Accept this request before sending messages.')));
      return;
    }
    if (!id || !service || sendLock.current) return;
    if (!recipientId || recipientId === me.id) {
      setError('Cannot send without a real recipient');
      return;
    }
    sendLock.current = true;
    setError(null);
    let flushed: StoredMessage | undefined;
    try {
      flushed = await sendChatVoice(service, {
        conversation_id: id,
        sender_id: me.id,
        recipient_id: recipientId,
        audio_b64: clip.audio_b64,
        duration_ms: clip.duration_ms,
        mime: clip.mime,
      });
      mergeRows([storedToChat(flushed)]);
      pinnedToLatest.current = true;
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      await syncNow();
      await loadLatest();
    } catch (err) {
      await loadLatest().catch(() => undefined);
      setError(flushed ? userFacingLoadError(err) : userFacingSendError(err));
    } finally {
      sendLock.current = false;
    }
  }

  const queuedHint =
    transportView.route === 'queued' || transportView.route === 'offline'
      ? transportView.route === 'queued'
        ? 'Queued until a connection is available'
        : formatNetworkStatus(status) === 'Offline'
          ? 'Offline — messages stay on this device until you reconnect'
          : transportView.line
      : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : queuedHint ? (
        <Text style={[styles.hint, { color: colors.muted }]} accessibilityLiveRegion="polite">
          {queuedHint}
        </Text>
      ) : null}
      {safetyRecord?.relationship === 'incoming_request' ? (
        <View style={[styles.requestBanner, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.text }}>
            Message request. Accept to chat. They cannot send another introduction.
          </Text>
          <View style={styles.requestRow}>
            <Pressable
              onPress={() => void runPeerAction('accept')}
              style={[styles.requestBtn, { backgroundColor: colors.tint }]}>
              <Text style={styles.sendLabel}>Accept</Text>
            </Pressable>
            <Pressable
              onPress={() => void runPeerAction('decline')}
              style={[styles.requestBtn, { borderWidth: 1.5, borderColor: colors.tint }]}>
              <Text style={{ color: colors.tint, fontWeight: '700' }}>Decline</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {safetyRecord?.relationship === 'outgoing_request' ? (
        <Text style={[styles.hint, { color: colors.muted }]}>
          Waiting for them to accept. You already sent an introduction.
        </Text>
      ) : null}
      {safetyRecord?.relationship === 'none' ? (
        <Text style={[styles.hint, { color: colors.muted }]}>
          Unknown people start as a message request. One introduction until they accept.
        </Text>
      ) : null}
      {safetyRecord?.relationship === 'blocked' ? (
        <Text style={[styles.hint, { color: '#DC2626' }]}>This person is blocked.</Text>
      ) : null}
      {safetyRecord?.muted && safetyRecord.relationship === 'accepted' ? (
        <Text style={[styles.hint, { color: colors.muted }]}>Muted — messages still arrive, notifications off.</Text>
      ) : null}
      <View style={styles.listWrap}>
        <FlatList
          ref={listRef}
          inverted
          data={invertedData}
          keyExtractor={(item) => item.message_id}
          contentContainerStyle={styles.list}
          initialNumToRender={16}
          windowSize={8}
          maxToRenderPerBatch={12}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.2}
          onScroll={(event) => {
            const pinned = isPinnedToLatest(event.nativeEvent.contentOffset.y);
            pinnedToLatest.current = pinned;
            if (pinned && newIncoming) setNewIncoming(0);
          }}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <MessageBubble
              item={item}
              mine={item.sender_id === me.id}
              tint={colors.tint}
              muted={colors.muted}
              card={colors.card}
              textColor={colors.text}
              onRetry={item.sender_id === me.id && isFailedMessageStatus(item.status) ? retryFailed : undefined}
            />
          )}
        />
        {newIncoming > 0 ? (
          <Pressable
            onPress={() => {
              setNewIncoming(0);
              pinnedToLatest.current = true;
              listRef.current?.scrollToOffset({ offset: 0, animated: true });
            }}
            accessibilityRole="button"
            accessibilityLabel={`${newIncoming} new messages`}
            style={[styles.newPill, { backgroundColor: colors.tint }]}>
            <Text style={styles.newPillLabel}>
              {newIncoming === 1 ? 'New message' : `${newIncoming} new messages`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.composer, { backgroundColor: colors.background, paddingBottom: Math.max(12, insets.bottom) }]}>
        {eventArchived ? (
          <Text style={{ color: colors.muted, paddingHorizontal: 4 }}>Event Chat is archived. You can still read history.</Text>
        ) : inputMode === 'ptt' && !isEventChat ? (
          <View style={styles.pttRow}>
            <PTTButton
              tint={colors.tint}
              tintForeground="#042f2e"
              muted={colors.muted}
              card={colors.card}
              onSend={sendVoice}
            />
            <Pressable
              onPress={() => setInputMode('text')}
              accessibilityRole="button"
              accessibilityLabel="Switch to text"
              style={[styles.toggle, { backgroundColor: colors.card }]}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>Aa</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable
              onPress={() => setInputMode('ptt')}
              accessibilityRole="button"
              accessibilityLabel="Switch to push to talk"
              style={[styles.toggle, { backgroundColor: colors.card, display: isEventChat ? 'none' : 'flex' }]}>
              <Text style={[styles.toggleLabel, { color: colors.tint }]}>PTT</Text>
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={MAX_APPLICATION_TEXT_CHARS}
              accessibilityLabel="Message"
              style={[styles.input, { color: colors.text, backgroundColor: colors.card }]}
            />
            <Pressable
              onPress={send}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !canSend }}
              style={[styles.send, { backgroundColor: colors.tint, opacity: canSend ? 1 : 0.45 }]}>
              <Text style={styles.sendLabel}>Send</Text>
            </Pressable>
          </>
        )}
      </View>
      <ActionSheet
        visible={sheetOpen}
        onDismiss={() => setSheetOpen(false)}
        title={peer || 'Chat'}
        subtitle={transportView.line}
        actions={[
          safetyRecord?.relationship === 'blocked'
            ? { label: 'Unblock', onPress: () => void runPeerAction('unblock') }
            : { label: 'Block', destructive: true, onPress: () => void runPeerAction('block') },
          safetyRecord?.muted
            ? { label: 'Unmute', onPress: () => void runPeerAction('unmute') }
            : { label: 'Mute', onPress: () => void runPeerAction('mute') },
          { label: 'Report', onPress: () => setReportOpen(true) },
        ]}
      />
      <ActionSheet
        visible={reportOpen}
        onDismiss={() => setReportOpen(false)}
        title="Report"
        subtitle="Choose a category. The transcript is not attached."
        actions={REPORT_CATEGORIES.map((category) => ({
          label: category,
          onPress: () => void runPeerAction('report', category),
        }))}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  headerTitle: { alignItems: 'center', backgroundColor: 'transparent', maxWidth: 240 },
  headerName: { fontSize: 17, fontWeight: '700' },
  headerStatus: { fontSize: 12, marginTop: 1 },
  headerMenu: { paddingHorizontal: 8, paddingVertical: 4 },
  requestBanner: { marginHorizontal: 12, marginTop: 8, borderRadius: 12, padding: 12, gap: 8 },
  requestRow: { flexDirection: 'row', gap: 8, backgroundColor: 'transparent' },
  requestBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  listWrap: { flex: 1, backgroundColor: 'transparent' },
  list: { padding: 16, gap: 10 },
  composer: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 12, alignItems: 'flex-end' },
  pttRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
    minHeight: 44,
  },
  send: { borderRadius: 16, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  sendLabel: { color: '#042f2e', fontWeight: '700' },
  toggle: { borderRadius: 16, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  toggleLabel: { fontWeight: '700', fontSize: 13 },
  error: { color: '#DC2626', paddingHorizontal: 16, paddingTop: 8 },
  hint: { paddingHorizontal: 16, paddingTop: 8, fontSize: 13 },
  newPill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 12,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  newPillLabel: { color: '#042f2e', fontWeight: '700' },
});
