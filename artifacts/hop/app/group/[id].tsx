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

// Overlapping member avatar cluster shown in the header
function MemberCluster({ members, size = 32 }: { members: { color: string; username: string }[]; size?: number }) {
  const shown = members.slice(0, 3);
  const overlap = size * 0.55;
  const totalW = size + (shown.length - 1) * overlap;
  return (
    <View style={{ width: totalW, height: size }}>
      {shown.map((m, i) => (
        <View
          key={i}
          style={[
            styles.clusterAvatar,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: m.color,
              left: i * overlap,
              zIndex: shown.length - i,
            },
          ]}
        >
          <Text style={[styles.clusterText, { fontSize: size * 0.38 }]}>
            {m.username[0].toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function GroupChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, getGroupConversation, sendGroupMessage, markGroupRead, groupConversations, isMuted, toggleMute } = useHop();
  const [input, setInput] = useState('');

  const group = id ? getGroupConversation(id) : undefined;
  const messages = group?.messages ?? [];

  useEffect(() => {
    if (id) markGroupRead(id);
  }, [id, groupConversations.length]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendGroupMessage(id, trimmed);
    setInput('');
  }, [input, id, sendGroupMessage]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isMe = item.senderId === profile?.id;
      return (
        <View style={[styles.msgRow, isMe ? styles.rowRight : styles.rowLeft]}>
          {!isMe && (
            <View style={[styles.msgAvatar, { backgroundColor: item.senderColor ?? '#888' }]}>
              <Text style={styles.msgAvatarText}>
                {(item.senderName ?? '?')[0].toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.bubbleCol}>
            {!isMe && item.senderName && (
              <Text style={[styles.senderName, { color: item.senderColor ?? colors.primary }]}>
                {item.senderName}
              </Text>
            )}
            <View
              style={[
                styles.bubble,
                isMe
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.bubbleText, { color: isMe ? colors.primaryForeground : colors.foreground }]}>
                {item.content}
              </Text>
            </View>
          </View>
        </View>
      );
    },
    [profile?.id, colors]
  );

  if (!group) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.mutedForeground }}>Group not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </Pressable>
        <MemberCluster members={group.members} size={34} />
        <View style={styles.headerInfo}>
          <Text style={[styles.headerName, { color: colors.foreground }]} numberOfLines={1}>
            {group.name}
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {group.members.length} members · nearby
          </Text>
        </View>
        <Pressable
          onPress={() => id && toggleMute(id)}
          hitSlop={12}
          style={styles.muteBtn}
        >
          <Ionicons
            name={id && isMuted(id) ? 'notifications-off' : 'notifications'}
            size={22}
            color={id && isMuted(id) ? colors.mutedForeground : colors.foreground}
          />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={0}>
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
              <MemberCluster members={group.members} size={52} />
              <Text style={[styles.emptyName, { color: colors.foreground }]}>{group.name}</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                {group.members.map(m => m.username).join(', ')}
              </Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground, marginTop: 4 }]}>
                Say something to the group!
              </Text>
            </View>
          }
        />

        <View style={[styles.inputBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: bottomPad + 10 }]}>
          <TextInput
            style={[styles.textInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            placeholder="Message group..."
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={handleSend}
          />
          <Pressable
            onPress={handleSend}
            disabled={!input.trim()}
            style={[styles.sendBtn, { backgroundColor: input.trim() ? colors.primary : colors.secondary }]}
          >
            <Ionicons name="arrow-up" size={18} color={input.trim() ? colors.primaryForeground : colors.mutedForeground} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  back: { padding: 2 },
  muteBtn: { padding: 4 },
  clusterAvatar: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  clusterText: { color: '#fff', fontFamily: 'Inter_700Bold' },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  msgList: { paddingHorizontal: 16, paddingVertical: 12 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, gap: 8 },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  msgAvatar: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  msgAvatarText: { color: '#fff', fontSize: 10, fontFamily: 'Inter_700Bold' },
  bubbleCol: { maxWidth: '74%' },
  senderName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginBottom: 3, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleText: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
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
  sendBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyName: { fontSize: 20, fontFamily: 'Inter_700Bold', marginTop: 10 },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 24 },
});
