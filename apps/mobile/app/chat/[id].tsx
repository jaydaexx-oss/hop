import { useLocalSearchParams, useNavigation, Redirect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { DEFAULT_TTL_MS, type StoredMessage } from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api, type ChatMessage } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { storedToChat, useOffline } from '@/src/offline/OfflineProvider';
import { useHopSocket } from '@/src/ws';

export default function ChatScreen() {
  const { id, peer, peerId } = useLocalSearchParams<{ id: string; peer?: string; peerId?: string }>();
  const { token, user } = useAuth();
  const { service, store, syncNow, ready: offlineReady } = useOffline();
  const navigation = useNavigation();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState(peerId ?? '');

  useLayoutEffect(() => {
    navigation.setOptions({ title: peer || 'Chat' });
  }, [navigation, peer]);

  const load = useCallback(async () => {
    if (!id) return;
    if (service) {
      const local = await service.listMessages(id);
      setMessages(local.map(storedToChat));
    }
    await syncNow();
    if (service) {
      const local = await service.listMessages(id);
      setMessages(local.map(storedToChat));
    }
    if (!recipientId && store) {
      const convos = await store.listConversations();
      const match = convos.find((row) => row.id === id);
      if (match?.peer_id) setRecipientId(match.peer_id);
    }
    if (token && service) {
      const rows = await service.listMessages(id);
      for (const row of rows) {
        if (row.recipient_id === user?.id && row.status !== 'READ') {
          try {
            await api.ack(token, row.message_id, 'READ');
          } catch {
            /* ignore while offline */
          }
        }
      }
    }
  }, [id, service, store, syncNow, token, user?.id, recipientId]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load messages'));
  }, [load]);

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
      .then(() => service.listMessages(id))
      .then((rows) => setMessages(rows.map(storedToChat)))
      .catch(() => undefined);
    if (token && incoming.recipient_id === user?.id && incoming.status !== 'READ') {
      api.ack(token, incoming.message_id, 'READ').catch(() => undefined);
    }
  });

  if (!user) return <Redirect href="/login" />;
  if (!offlineReady) return null;
  const me = user;

  async function send() {
    if (!id || !draft.trim() || !service) return;
    const text = draft.trim();
    setDraft('');
    setError(null);
    try {
      const sent = await service.sendText({
        conversation_id: id,
        sender_id: me.id,
        recipient_id: recipientId || me.id,
        text,
      });
      setMessages((current) => [
        ...current.filter((row) => row.message_id !== sent.message_id),
        storedToChat(sent),
      ]);
      await syncNow();
    } catch (err) {
      setDraft(text);
      setError(err instanceof Error ? err.message : 'Send failed');
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
          return (
            <View style={[styles.bubbleWrap, mine ? styles.mineWrap : styles.theirsWrap]}>
              <View
                style={[
                  styles.bubble,
                  { backgroundColor: mine ? colors.tint : colors.card },
                ]}>
                <Text style={{ color: mine ? '#042f2e' : colors.text }}>{item.text ?? '[encrypted]'}</Text>
              </View>
              {mine ? (
                <Text style={[styles.status, { color: colors.muted }]}>{item.status.toLowerCase()}</Text>
              ) : null}
            </View>
          );
        }}
      />
      <View style={[styles.composer, { backgroundColor: colors.background }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.text, backgroundColor: colors.card }]}
        />
        <Pressable onPress={send} style={[styles.send, { backgroundColor: colors.tint }]}>
          <Text style={styles.sendLabel}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  bubbleWrap: { maxWidth: '80%', backgroundColor: 'transparent' },
  mineWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirsWrap: { alignSelf: 'flex-start' },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  status: { fontSize: 11, marginTop: 2 },
  composer: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' },
  input: { flex: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  send: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10 },
  sendLabel: { color: '#042f2e', fontWeight: '700' },
  error: { color: '#DC2626', paddingHorizontal: 16, paddingTop: 8 },
});
