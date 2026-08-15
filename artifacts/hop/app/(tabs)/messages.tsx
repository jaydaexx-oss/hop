import React from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Conversation, useHop } from '@/context/HopContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function ConvItem({
  conv,
  onPress,
  colors,
}: {
  conv: Conversation;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const last = conv.messages[conv.messages.length - 1];
  const hasUnread = conv.unread > 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        { backgroundColor: pressed ? colors.secondary : 'transparent' },
      ]}
    >
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: conv.user.color }]}>
        <Text style={styles.avatarText}>{conv.user.username[0].toUpperCase()}</Text>
      </View>

      {/* Body */}
      <View style={styles.body}>
        <View style={styles.top}>
          <Text
            style={[
              styles.name,
              { color: colors.foreground },
              hasUnread && { fontFamily: 'Inter_700Bold' },
            ]}
          >
            {conv.user.username}
          </Text>
          {last && (
            <Text style={[styles.time, { color: colors.mutedForeground }]}>
              {formatTime(last.timestamp)}
            </Text>
          )}
        </View>
        <View style={styles.bottom}>
          <Text
            style={[
              styles.preview,
              {
                color: hasUnread ? colors.foreground : colors.mutedForeground,
                fontFamily: hasUnread ? 'Inter_500Medium' : 'Inter_400Regular',
              },
            ]}
            numberOfLines={1}
          >
            {last?.content ?? ''}
          </Text>
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>
                {conv.unread}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { conversations } = useHop();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 60;

  const handlePress = (conv: Conversation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/chat/${conv.userId}`);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Messages</Text>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={c => c.userId}
        renderItem={({ item }) => (
          <ConvItem conv={item} onPress={() => handlePress(item)} colors={colors} />
        )}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        ItemSeparatorComponent={() => (
          <View style={[styles.sep, { backgroundColor: colors.border, marginLeft: 82 }]} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubble-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Tap a nearby user on Radar to start chatting
            </Text>
          </View>
        }
      />
    </View>
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
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#fff', fontWeight: 'bold' as const, fontSize: 19, fontFamily: 'Inter_700Bold' },
  body: { flex: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  name: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  time: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview: { fontSize: 13, flex: 1 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    paddingHorizontal: 5,
  },
  badgeText: { fontSize: 11, fontWeight: 'bold' as const, fontFamily: 'Inter_700Bold' },
  sep: { height: StyleSheet.hairlineWidth },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 14, textAlign: 'center', fontFamily: 'Inter_400Regular' },
});
