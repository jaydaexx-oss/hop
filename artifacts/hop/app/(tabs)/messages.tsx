import React from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Conversation, GroupConversation, useHop } from '@/context/HopContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Avatar } from '@/components/Avatar';

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

// ── DM row ────────────────────────────────────────────────────────────────────
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
      style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.secondary : 'transparent' }]}
    >
      <Avatar
        uri={conv.user.avatarUri}
        color={conv.user.color}
        username={conv.user.username}
        size={50}
      />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[styles.name, { color: colors.foreground }, hasUnread && { fontFamily: 'Inter_700Bold' }]}>
            {conv.user.username}
          </Text>
          {last && <Text style={[styles.time, { color: colors.mutedForeground }]}>{formatTime(last.timestamp)}</Text>}
        </View>
        <View style={styles.bottom}>
          <Text
            style={[styles.preview, { color: hasUnread ? colors.foreground : colors.mutedForeground, fontFamily: hasUnread ? 'Inter_500Medium' : 'Inter_400Regular' }]}
            numberOfLines={1}
          >
            {last?.content ?? ''}
          </Text>
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>{conv.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ── Group row ─────────────────────────────────────────────────────────────────
function GroupItem({
  group,
  onPress,
  colors,
}: {
  group: GroupConversation;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const last = group.messages[group.messages.length - 1];
  const hasUnread = group.unread > 0;
  const shown = group.members.slice(0, 3);
  const AVATAR = 50;
  const OVERLAP = AVATAR * 0.5;
  const clusterW = AVATAR + (shown.length - 1) * OVERLAP;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.secondary : 'transparent' }]}
    >
      {/* Overlapping member avatars */}
      <View style={{ width: clusterW, height: AVATAR, flexShrink: 0 }}>
        {shown.map((m, i) => (
          <View
            key={i}
            style={[
              styles.avatar,
              {
                width: AVATAR - 6,
                height: AVATAR - 6,
                borderRadius: (AVATAR - 6) / 2,
                backgroundColor: m.color,
                position: 'absolute',
                left: i * OVERLAP,
                top: 3,
                zIndex: shown.length - i,
                borderWidth: 2,
                borderColor: colors.background,
              },
            ]}
          >
            <Text style={[styles.avatarText, { fontSize: 14 }]}>{m.username[0].toUpperCase()}</Text>
          </View>
        ))}
      </View>

      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[styles.name, { color: colors.foreground }, hasUnread && { fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
            {group.name}
          </Text>
          {last && <Text style={[styles.time, { color: colors.mutedForeground }]}>{formatTime(last.timestamp)}</Text>}
        </View>
        <View style={styles.bottom}>
          <Text
            style={[styles.preview, { color: hasUnread ? colors.foreground : colors.mutedForeground, fontFamily: hasUnread ? 'Inter_500Medium' : 'Inter_400Regular' }]}
            numberOfLines={1}
          >
            {last ? `${last.senderName ?? 'You'}: ${last.content}` : `${group.members.length} members`}
          </Text>
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>{group.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { conversations, groupConversations } = useHop();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 60;

  const hasAny = conversations.length > 0 || groupConversations.length > 0;

  // Build sections for SectionList
  const sections: { title: string; data: (Conversation | GroupConversation)[]; kind: 'group' | 'dm' }[] = [];
  if (groupConversations.length > 0) {
    sections.push({ title: 'GROUPS', data: groupConversations, kind: 'group' });
  }
  if (conversations.length > 0) {
    sections.push({ title: 'DIRECT', data: conversations, kind: 'dm' });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Messages</Text>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/new-group');
          }}
          style={[styles.newGroupBtn, { backgroundColor: colors.secondary }]}
          hitSlop={8}
        >
          <Ionicons name="people" size={16} color={colors.primary} />
          <Text style={[styles.newGroupText, { color: colors.primary }]}>New Group</Text>
        </Pressable>
      </View>

      {!hasAny ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubble-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Tap a nearby user on Radar to start chatting, or create a group.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => ('userId' in item ? item.userId : item.id)}
          renderSectionHeader={({ section }) => (
            sections.length > 1 ? (
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{section.title}</Text>
              </View>
            ) : null
          )}
          renderItem={({ item, section }) =>
            section.kind === 'group' ? (
              <GroupItem
                group={item as GroupConversation}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/group/${(item as GroupConversation).id}`);
                }}
                colors={colors}
              />
            ) : (
              <ConvItem
                conv={item as Conversation}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/chat/${(item as Conversation).userId}`);
                }}
                colors={colors}
              />
            )
          }
          ItemSeparatorComponent={() => (
            <View style={[styles.sep, { backgroundColor: colors.border, marginLeft: 82 }]} />
          )}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          stickySectionHeadersEnabled
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 22, fontFamily: 'Inter_700Bold' },
  newGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  newGroupText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  sectionHeader: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 },
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
  name: { fontSize: 15, fontFamily: 'Inter_600SemiBold', flex: 1, marginRight: 8 },
  time: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview: { fontSize: 13, flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginLeft: 8, paddingHorizontal: 5 },
  badgeText: { fontSize: 11, fontWeight: 'bold' as const, fontFamily: 'Inter_700Bold' },
  sep: { height: StyleSheet.hairlineWidth },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 14, textAlign: 'center', fontFamily: 'Inter_400Regular' },
});
