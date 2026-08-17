import { useLocalSearchParams, useNavigation, Redirect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import {
  DEFAULT_TTL_MS,
  conversationTransportStatus,
  formatMessageStatus,
  internetStatusAvailable,
  isFailedMessageStatus,
  isInFlightOutboundStatus,
  type StoredMessage,
} from '@hop/protocol';

import { PTTButton, type VoiceClip } from '@/components/PTTButton';
import { Text, View } from '@/components/Themed';
import { VoiceMessageBubble } from '@/components/VoiceMessageBubble';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { type ChatMessage } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { sendChatText, sendChatVoice } from '@/src/chat/sendChat';
import { storedToChat, useOffline } from '@/src/offline/OfflineProvider';
import { clearVoicePlaybackTemps } from '@/src/voice/cache';
import { useHopSocket } from '@/src/ws';

export default function ChatScreen() {
  const { id, peer, peerId } = useLocalSearchParams<{ id: string; peer?: string; peerId?: string }>();
  const { token, user } = useAuth();
  const { service, store, syncNow, ready: offlineReady, status, queuedCount } = useOffline();
  const { peers, connectedId } = useBle();
  const navigation = useNavigation();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState(peerId ?? '');
  const [inputMode, setInputMode] = useState<'text' | 'ptt'>('text');
  const [sending, setSending] = useState(false);

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

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Text style={styles.headerName} numberOfLines={1}>
            {peer || 'Chat'}
          </Text>
          <Text style={[styles.headerStatus, { color: colors.muted }]} numberOfLines={1}>
            {transportView.line}
          </Text>
        </View>
      ),
    });
  }, [navigation, peer, transportView.line, colors.muted]);

  useEffect(() => {
    return () => {
      clearVoicePlaybackTemps().catch(() => undefined);
    };
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    if (service) {
      const local = await service.listMessages(id);
      setMessages(local.map(storedToChat));
    }
    await syncNow();
    if (service) {
      if (user?.id) await service.markConversationRead(id, user.id).catch(() => undefined);
      const local = await service.listMessages(id);
      setMessages(local.map(storedToChat));
    }
    if (!recipientId && store) {
      const convos = await store.listConversations();
      const match = convos.find((row) => row.id === id);
      if (match?.peer_id) setRecipientId(match.peer_id);
    }
  }, [id, service, store, syncNow, recipientId, user?.id]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load messages'));
  }, [load]);

  useEffect(() => {
    if (!service || !id || sending || !needsOutboxPoll) return;
    const tick = setInterval(() => {
      service
        .listMessages(id)
        .then((rows) => setMessages(rows.map(storedToChat)))
        .catch(() => undefined);
    }, 3_000);
    return () => clearInterval(tick);
  }, [service, id, sending, needsOutboxPoll]);

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
    service
      .acceptInbound(stored)
      .then(async () => {
        if (user?.id) await service.markConversationRead(id, user.id).catch(() => undefined);
        return service.listMessages(id);
      })
      .then((rows) => setMessages(rows.map(storedToChat)))
      .catch(() => undefined);
  });

  if (!user) return <Redirect href="/login" />;
  if (!offlineReady) return null;
  const me = user;

  async function send() {
    if (!id || !draft.trim() || !service || sending) return;
    if (!recipientId || recipientId === me.id) {
      setError('Cannot send without a real recipient');
      return;
    }
    const text = draft.trim();
    setDraft('');
    setError(null);
    setSending(true);
    const optimistic: ChatMessage = {
      message_id: `sending-${Date.now()}`,
      sender_id: me.id,
      recipient_id: recipientId,
      conversation_id: id,
      text,
      status: 'SENDING',
      created_at: new Date().toISOString(),
      e2ee: true,
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const sent = await sendChatText(service, {
        conversation_id: id,
        sender_id: me.id,
        recipient_id: recipientId,
        text,
      });
      setMessages((current) => [
        ...current.filter((row) => row.message_id !== optimistic.message_id && row.message_id !== sent.message_id),
        storedToChat(sent),
      ]);
      await syncNow();
      if (service) {
        const local = await service.listMessages(id);
        setMessages(local.map(storedToChat));
      }
    } catch (err) {
      setMessages((current) => current.filter((row) => row.message_id !== optimistic.message_id));
      setDraft(text);
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  async function retryFailed(messageId: string) {
    if (!id || !service || sending) return;
    setError(null);
    setSending(true);
    try {
      await service.retryFailed(messageId);
      await syncNow();
      const local = await service.listMessages(id);
      setMessages(local.map(storedToChat));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setSending(false);
    }
  }

  async function sendVoice(clip: VoiceClip) {
    if (!id || !service || sending) return;
    if (!recipientId || recipientId === me.id) {
      setError('Cannot send without a real recipient');
      return;
    }
    setError(null);
    setSending(true);
    try {
      const sent = await sendChatVoice(service, {
        conversation_id: id,
        sender_id: me.id,
        recipient_id: recipientId,
        audio_b64: clip.audio_b64,
        duration_ms: clip.duration_ms,
        mime: clip.mime,
      });
      setMessages((current) => [
        ...current.filter((row) => row.message_id !== sent.message_id),
        storedToChat(sent),
      ]);
      await syncNow();
      if (service) {
        const local = await service.listMessages(id);
        setMessages(local.map(storedToChat));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={messages}
        keyExtractor={(item) => item.message_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const mine = item.sender_id === me.id;
          const failed = isFailedMessageStatus(item.status);
          const canRetry = item.status === 'FAILED';
          const voice = item.kind === 'voice';
          return (
            <View style={[styles.bubbleWrap, mine ? styles.mineWrap : styles.theirsWrap]}>
              {voice ? (
                <VoiceMessageBubble
                  messageId={item.message_id}
                  audioB64={item.audio_b64}
                  durationMs={item.duration_ms}
                  mime={item.mime}
                  isMe={mine}
                  tint={colors.tint}
                  tintForeground="#042f2e"
                  card={colors.card}
                  muted={colors.muted}
                />
              ) : (
                <View
                  style={[
                    styles.bubble,
                    { backgroundColor: mine ? colors.tint : colors.card },
                  ]}>
                  <Text style={{ color: mine ? '#042f2e' : colors.text }}>{item.text ?? '[encrypted]'}</Text>
                </View>
              )}
              {mine ? (
                <View style={styles.statusRow}>
                  <Text style={[styles.status, { color: failed ? '#DC2626' : colors.muted }]}>
                    {formatMessageStatus(item.status, item.retry_attempts)}
                  </Text>
                  {canRetry ? (
                    <Pressable onPress={() => retryFailed(item.message_id)} hitSlop={8}>
                      <Text style={[styles.retry, { color: colors.tint }]}>Retry</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        }}
      />
      <View style={[styles.composer, { backgroundColor: colors.background }]}>
        {inputMode === 'ptt' ? (
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
              style={[styles.toggle, { backgroundColor: colors.card }]}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>Aa</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable
              onPress={() => setInputMode('ptt')}
              style={[styles.toggle, { backgroundColor: colors.card }]}>
              <Text style={[styles.toggleLabel, { color: colors.tint }]}>PTT</Text>
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={colors.muted}
              style={[styles.input, { color: colors.text, backgroundColor: colors.card }]}
            />
            <Pressable
              onPress={send}
              disabled={sending}
              style={[styles.send, { backgroundColor: colors.tint, opacity: sending ? 0.6 : 1 }]}>
              <Text style={styles.sendLabel}>Send</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  headerTitle: { alignItems: 'center', backgroundColor: 'transparent', maxWidth: 240 },
  headerName: { fontSize: 17, fontWeight: '700' },
  headerStatus: { fontSize: 12, marginTop: 1 },
  list: { padding: 16, gap: 10 },
  bubbleWrap: { maxWidth: '80%', backgroundColor: 'transparent' },
  mineWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirsWrap: { alignSelf: 'flex-start' },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  status: { fontSize: 11, marginTop: 2 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    marginTop: 2,
  },
  retry: { fontSize: 11, fontWeight: '700' },
  composer: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' },
  pttRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  send: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10 },
  sendLabel: { color: '#042f2e', fontWeight: '700' },
  toggle: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  toggleLabel: { fontWeight: '700', fontSize: 13 },
  error: { color: '#DC2626', paddingHorizontal: 16, paddingTop: 8 },
});
