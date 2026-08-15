import React, { useState } from 'react';
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
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { Broadcast, useHop } from '@/context/HopContext';
import { Avatar } from '@/components/Avatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function BroadcastCard({
  item,
  isOwn,
  colors,
  onReply,
}: {
  item: Broadcast;
  isOwn: boolean;
  colors: ReturnType<typeof useColors>;
  onReply: () => void;
}) {
  const Wrapper = isOwn ? View : Pressable;
  const wrapperProps = isOwn ? {} : {
    onPress: onReply,
    style: ({ pressed }: { pressed: boolean }) => [
      styles.card,
      { backgroundColor: colors.card, opacity: pressed ? 0.82 : 1 },
    ],
  };

  return (
    // @ts-ignore — Pressable/View conditional is fine at runtime
    <Wrapper {...(isOwn ? { style: [styles.card, { backgroundColor: colors.card }] } : wrapperProps)}>
      <Avatar
        color={item.senderColor}
        username={item.senderName}
        size={38}
      />
      <View style={styles.cardBody}>
        <View style={styles.cardMeta}>
          <View style={styles.cardNameRow}>
            <Text style={[styles.cardName, { color: colors.foreground }]}>{item.senderName}</Text>
            {isOwn && (
              <View style={[styles.ownBadge, { backgroundColor: colors.primary + '22' }]}>
                <Text style={[styles.ownBadgeText, { color: colors.primary }]}>you</Text>
              </View>
            )}
          </View>
          <Text style={[styles.cardTime, { color: colors.mutedForeground }]}>
            {formatTime(item.timestamp)}
          </Text>
        </View>
        <Text style={[styles.cardContent, { color: colors.foreground }]}>{item.content}</Text>
        {!isOwn && (
          <View style={styles.replyHint}>
            <Ionicons name="arrow-undo-outline" size={11} color={colors.primary} />
            <Text style={[styles.replyHintText, { color: colors.primary }]}>Tap to reply</Text>
          </View>
        )}
      </View>
    </Wrapper>
  );
}

export default function BroadcastScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { broadcasts, sendBroadcast, profile, openDirectMessage } = useHop();
  const [input, setInput] = useState('');

  const handleReply = (item: Broadcast) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const userId = openDirectMessage({
      id: item.senderId,
      username: item.senderName,
      color: item.senderColor,
      signal: 70,
      angle: 0,
    });
    router.push(`/chat/${userId}`);
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !profile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendBroadcast(trimmed);
    setInput('');
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={{ flex: 1, paddingTop: topPad }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Broadcast</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Visible to everyone nearby
          </Text>
        </View>

        <FlatList
          data={broadcasts}
          keyExtractor={b => b.id}
          renderItem={({ item }) => (
            <BroadcastCard
              item={item}
              isOwn={item.senderId === profile?.id}
              colors={colors}
              onReply={() => handleReply(item)}
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="megaphone-outline" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No broadcasts yet
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Send the first message to people nearby
              </Text>
            </View>
          }
        />

        {/* Composer */}
        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: bottomPad + 56,
            },
          ]}
        >
          <TextInput
            style={[
              styles.composerInput,
              { color: colors.foreground, backgroundColor: colors.secondary },
            ]}
            placeholder="Broadcast nearby..."
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={setInput}
            maxLength={280}
            multiline
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable
            onPress={handleSend}
            disabled={!input.trim()}
            style={[
              styles.sendBtn,
              { backgroundColor: input.trim() ? colors.primary : colors.secondary },
            ]}
          >
            <Ionicons
              name="arrow-up"
              size={18}
              color={input.trim() ? colors.primaryForeground : colors.mutedForeground}
            />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  card: {
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
  },
  cardBody: { flex: 1 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  cardName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  ownBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  ownBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  cardTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  cardContent: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  replyHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7 },
  replyHintText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  composerInput: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
    fontFamily: 'Inter_400Regular',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 14, textAlign: 'center', fontFamily: 'Inter_400Regular' },
});
