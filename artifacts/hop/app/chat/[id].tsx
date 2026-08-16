import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useColors } from '@/hooks/useColors';
import { Message, useHop } from '@/context/HopContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Avatar } from '@/components/Avatar';
import { PTTButton } from '@/components/PTTButton';
import { VoiceMessageBubble } from '@/components/VoiceMessageBubble';
import { TransportBadge, OfflineQueueBanner } from '@/components/TransportBadge';
import { useTransportState } from '@/hooks/useTransportState';

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    profile, getConversation, sendMessage, sendVoiceMessage,
    markRead, conversations, nearbyUsers, isMuted, toggleMute,
  } = useHop();
  const [input, setInput] = useState('');
  const [inputMode, setInputMode] = useState<'text' | 'ptt'>('text');
  const transport = useTransportState(id);

  const conv = id ? getConversation(id) : undefined;
  const nearUser = id ? nearbyUsers.find(u => u.id === id) : undefined;
  const userName = conv?.user.username ?? nearUser?.username ?? 'Unknown';
  const userColor = conv?.user.color ?? nearUser?.color ?? '#888';
  const userAvatarUri = conv?.user.avatarUri ?? nearUser?.avatarUri;
  const messages = conv?.messages ?? [];

  useEffect(() => {
    if (id) markRead(id);
  }, [id, conversations.length]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage(id, trimmed);
    setInput('');
  }, [input, id, sendMessage]);

  const handleVoiceSend = useCallback((uri: string, durationMs: number) => {
    if (!id) return;
    sendVoiceMessage(id, uri, durationMs);
  }, [id, sendVoiceMessage]);

  const toggleInputMode = useCallback(() => {
    setInputMode(m => m === 'text' ? 'ptt' : 'text');
    setInput('');
  }, []);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isMe = item.senderId === profile?.id;
      return (
        <View style={[styles.msgRow, isMe ? styles.rowRight : styles.rowLeft]}>
          {!isMe && (
            <Avatar uri={userAvatarUri} color={userColor} username={userName} size={26} />
          )}
          {item.messageType === 'voice' ? (
            <VoiceMessageBubble
              uri={item.voiceUri}
              durationMs={item.voiceDurationMs}
              isMe={isMe}
              primaryColor={colors.primary}
              primaryForegroundColor={colors.primaryForeground}
              foregroundColor={colors.foreground}
              cardColor={colors.card}
              borderColor={colors.border}
            />
          ) : (
            <View
              style={[
                styles.bubble,
                isMe
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
              ]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  { color: isMe ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {item.content}
              </Text>
            </View>
          )}
        </View>
      );
    },
    [profile?.id, colors, userColor, userName, userAvatarUri],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </Pressable>
        <Avatar uri={userAvatarUri} color={userColor} username={userName} size={36} />
        <View style={styles.headerInfo}>
          <Text style={[styles.headerName, { color: colors.foreground }]}>{userName}</Text>
          <TransportBadge kind={transport.kind} label={transport.label} colors={colors} />
        </View>
        <Pressable onPress={() => id && toggleMute(id)} hitSlop={12} style={styles.muteBtn}>
          <Ionicons
            name={id && isMuted(id) ? 'notifications-off' : 'notifications'}
            size={22}
            color={id && isMuted(id) ? colors.mutedForeground : colors.foreground}
          />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={0}>
        {/* Offline queue banner */}
        {transport.hasQueue && <OfflineQueueBanner colors={colors} />}

        {/* Messages */}
        <FlatList
          data={[...messages].reverse()}
          keyExtractor={m => m.id}
          renderItem={renderMessage}
          inverted
          contentContainerStyle={styles.msgList}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Avatar uri={userAvatarUri} color={userColor} username={userName} size={72} />
              <Text style={[styles.emptyName, { color: colors.foreground }]}>{userName}</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Start the conversation
              </Text>
            </View>
          }
        />

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: bottomPad + 10 },
          ]}
        >
          {inputMode === 'ptt' ? (
            /* ── PTT mode ── */
            <View style={styles.pttRow}>
              <PTTButton colors={colors} onSend={handleVoiceSend} />
              <Pressable
                onPress={toggleInputMode}
                hitSlop={8}
                style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="chatbubble-outline" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ) : (
            /* ── Text mode ── */
            <View style={styles.textRow}>
              <TextInput
                style={[styles.textInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
                placeholder="Message..."
                placeholderTextColor={colors.mutedForeground}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={500}
                returnKeyType="send"
                blurOnSubmit={false}
                onSubmitEditing={handleSend}
              />
              <Pressable onPress={toggleInputMode} hitSlop={8} style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="mic-outline" size={20} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={handleSend}
                disabled={!input.trim()}
                style={[styles.sendBtn, { backgroundColor: input.trim() ? colors.primary : colors.secondary }]}
              >
                <Ionicons name="arrow-up" size={18} color={input.trim() ? colors.primaryForeground : colors.mutedForeground} />
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex:      { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  back:    { padding: 2 },
  muteBtn: { padding: 4 },
  headerInfo:    { flex: 1 },
  headerName:    { fontSize: 16, fontFamily: 'Inter_700Bold' },
  headerSub:     { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  onlineDot:     { width: 6, height: 6, borderRadius: 3 },
  headerSubText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  msgList:  { paddingHorizontal: 16, paddingVertical: 12 },
  msgRow:   { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10, gap: 8 },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft:  { justifyContent: 'flex-start' },
  bubble:     { maxWidth: '74%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleText: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  inputBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  pttRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: 'Inter_400Regular',
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  emptyWrap:   { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyName:   { fontSize: 20, fontFamily: 'Inter_700Bold' },
  emptySub:    { fontSize: 14, fontFamily: 'Inter_400Regular' },
});
