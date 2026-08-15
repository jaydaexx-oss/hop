import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useColors } from '@/hooks/useColors';
import { Conversation, GroupConversation, HopUser, useHop } from '@/context/HopContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Avatar } from '@/components/Avatar';
import { ActionSheet } from '@/components/ActionSheet';

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

// ── Delete action revealed on swipe ───────────────────────────────────────────
function DeleteAction({ onDelete }: { onDelete: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.deleteAction, { backgroundColor: colors.destructive }]}
      onPress={onDelete}
      activeOpacity={0.8}
    >
      <Ionicons name="trash-outline" size={22} color="#fff" />
      <Text style={styles.deleteActionText}>Delete</Text>
    </TouchableOpacity>
  );
}

// ── DM row ────────────────────────────────────────────────────────────────────
function ConvItem({
  conv,
  muted,
  onPress,
  onLongPress,
  onDelete,
  colors,
}: {
  conv: Conversation;
  muted: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDelete: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const swipeRef = useRef<Swipeable>(null);
  const last = conv.messages[conv.messages.length - 1];
  const hasUnread = conv.unread > 0;

  const handleDelete = () => {
    swipeRef.current?.close();
    onDelete();
  };

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      overshootRight={false}
      renderRightActions={() => <DeleteAction onDelete={handleDelete} />}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.secondary : colors.background }]}
      >
        <Avatar uri={conv.user.avatarUri} color={conv.user.color} username={conv.user.username} size={50} />
        <View style={styles.body}>
          <View style={styles.top}>
            <Text style={[styles.name, { color: colors.foreground }, hasUnread && { fontFamily: 'Inter_700Bold' }]}>
              {conv.user.username}
            </Text>
            <View style={styles.topRight}>
              {muted && <Ionicons name="notifications-off-outline" size={13} color={colors.mutedForeground} style={styles.muteIcon} />}
              {last && <Text style={[styles.time, { color: colors.mutedForeground }]}>{formatTime(last.timestamp)}</Text>}
            </View>
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
    </Swipeable>
  );
}

// ── Group row ─────────────────────────────────────────────────────────────────
function GroupItem({
  group,
  muted,
  onPress,
  onLongPress,
  onDelete,
  colors,
}: {
  group: GroupConversation;
  muted: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDelete: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const swipeRef = useRef<Swipeable>(null);
  const last = group.messages[group.messages.length - 1];
  const hasUnread = group.unread > 0;
  const shown = group.members.slice(0, 3);
  const AVATAR = 50;
  const OVERLAP = AVATAR * 0.5;
  const clusterW = AVATAR + (shown.length - 1) * OVERLAP;

  const handleDelete = () => {
    swipeRef.current?.close();
    onDelete();
  };

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      overshootRight={false}
      renderRightActions={() => <DeleteAction onDelete={handleDelete} />}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.secondary : colors.background }]}
      >
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
            <View style={styles.topRight}>
              {muted && <Ionicons name="notifications-off-outline" size={13} color={colors.mutedForeground} style={styles.muteIcon} />}
              {last && <Text style={[styles.time, { color: colors.mutedForeground }]}>{formatTime(last.timestamp)}</Text>}
            </View>
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
    </Swipeable>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { conversations, groupConversations, messageRequests, blockUser, reportUser, deleteConversation, deleteGroup, undoDeleteConversation, undoDeleteGroup, isMuted } = useHop();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 60;

  // Action sheet state — holds the user to show actions for
  const [sheetTarget, setSheetTarget] = useState<{ user: HopUser; isDM: boolean } | null>(null);

  // Undo-delete state
  const [undoPending, setUndoPending] = useState<{ label: string; onUndo: () => void } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoAnim = useRef(new Animated.Value(0)).current;

  const clearUndo = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    Animated.timing(undoAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
      setUndoPending(null)
    );
  }, [undoAnim]);

  const showUndoToast = useCallback(
    (label: string, onUndo: () => void) => {
      // Cancel any existing undo toast before showing a new one
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoPending({ label, onUndo });
      Animated.timing(undoAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      undoTimerRef.current = setTimeout(clearUndo, 4000);
    },
    [undoAnim, clearUndo]
  );

  // Clean up timer on unmount
  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);

  const hasAny = conversations.length > 0 || groupConversations.length > 0;

  const sections: { title: string; data: (Conversation | GroupConversation)[]; kind: 'group' | 'dm' }[] = [];
  if (groupConversations.length > 0) sections.push({ title: 'GROUPS', data: groupConversations, kind: 'group' });
  if (conversations.length > 0) sections.push({ title: 'DIRECT', data: conversations, kind: 'dm' });

  const openDMSheet = (conv: Conversation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSheetTarget({ user: conv.user, isDM: true });
  };

  const handleDeleteConv = (conv: Conversation) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    deleteConversation(conv.userId);
    showUndoToast(`Conversation with ${conv.user.username} deleted`, () => {
      undoDeleteConversation(conv);
    });
  };

  const handleDeleteGroup = (group: GroupConversation) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    deleteGroup(group.id);
    showUndoToast(`"${group.name}" deleted`, () => {
      undoDeleteGroup(group);
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Messages</Text>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/new-group'); }}
          style={[styles.newGroupBtn, { backgroundColor: colors.secondary }]}
          hitSlop={8}
        >
          <Ionicons name="people" size={16} color={colors.primary} />
          <Text style={[styles.newGroupText, { color: colors.primary }]}>New Group</Text>
        </Pressable>
      </View>

      {/* Message requests banner */}
      {messageRequests.length > 0 && (
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/message-requests'); }}
          style={[styles.requestsBanner, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.requestsIcon, { backgroundColor: colors.primary + '22' }]}>
            <Ionicons name="person-add-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.requestsText}>
            <Text style={[styles.requestsTitle, { color: colors.foreground }]}>Message Requests</Text>
            <Text style={[styles.requestsSub, { color: colors.mutedForeground }]}>
              {messageRequests.length} pending
            </Text>
          </View>
          <View style={[styles.requestsBadge, { backgroundColor: colors.primary }]}>
            <Text style={[styles.requestsBadgeText, { color: colors.primaryForeground }]}>{messageRequests.length}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
        </Pressable>
      )}

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
          renderSectionHeader={({ section }) =>
            sections.length > 1 ? (
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{section.title}</Text>
              </View>
            ) : null
          }
          renderItem={({ item, section }) =>
            section.kind === 'group' ? (
              <GroupItem
                group={item as GroupConversation}
                muted={isMuted((item as GroupConversation).id)}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/group/${(item as GroupConversation).id}`); }}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  Alert.alert((item as GroupConversation).name, `${(item as GroupConversation).members.length} members in this group`);
                }}
                onDelete={() => handleDeleteGroup(item as GroupConversation)}
                colors={colors}
              />
            ) : (
              <ConvItem
                conv={item as Conversation}
                muted={isMuted((item as Conversation).userId)}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/chat/${(item as Conversation).userId}`); }}
                onLongPress={() => openDMSheet(item as Conversation)}
                onDelete={() => handleDeleteConv(item as Conversation)}
                colors={colors}
              />
            )
          }
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: colors.border, marginLeft: 82 }]} />}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          stickySectionHeadersEnabled
        />
      )}

      {/* Undo delete snackbar */}
      {undoPending && (
        <Animated.View
          style={[
            styles.undoBar,
            { bottom: bottomPad + 12 },
            {
              transform: [
                {
                  translateY: undoAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [80, 0],
                  }),
                },
              ],
              opacity: undoAnim,
            },
          ]}
        >
          <Text style={styles.undoLabel} numberOfLines={1}>{undoPending.label}</Text>
          <TouchableOpacity
            onPress={() => {
              undoPending.onUndo();
              clearUndo();
            }}
            hitSlop={12}
            style={styles.undoBtn}
          >
            <Text style={styles.undoBtnText}>Undo</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* DM action sheet */}
      {sheetTarget?.isDM && (
        <ActionSheet
          visible={!!sheetTarget}
          onDismiss={() => setSheetTarget(null)}
          user={{
            username: sheetTarget.user.username,
            color: sheetTarget.user.color,
            avatarUri: sheetTarget.user.avatarUri,
            subtitle: 'nearby',
          }}
          actions={[
            {
              label: 'Message',
              icon: 'chatbubble-outline',
              onPress: () => { setSheetTarget(null); router.push(`/chat/${sheetTarget.user.id}`); },
            },
            {
              label: 'Report',
              icon: 'flag-outline',
              onPress: () => { setSheetTarget(null); setTimeout(() => reportUser(sheetTarget.user.id), 150); },
            },
            {
              label: 'Block',
              icon: 'ban-outline',
              destructive: true,
              onPress: () => {
                const uid = sheetTarget.user.id;
                const uname = sheetTarget.user.username;
                setSheetTarget(null);
                setTimeout(() => {
                  Alert.alert(`Block @${uname}?`, 'They won\'t be able to message you or appear on your radar.', [
                    { text: 'Block', style: 'destructive', onPress: () => blockUser(uid) },
                    { text: 'Cancel', style: 'cancel' },
                  ]);
                }, 150);
              },
            },
          ]}
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
  newGroupBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  newGroupText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  requestsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  requestsIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  requestsText: { flex: 1 },
  requestsTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  requestsSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  requestsBadge: { minWidth: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5 },
  requestsBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  sectionHeader: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  avatar: { justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontWeight: 'bold' as const, fontFamily: 'Inter_700Bold' },
  body: { flex: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  name: { fontSize: 15, fontFamily: 'Inter_600SemiBold', flex: 1, marginRight: 8 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  muteIcon: { opacity: 0.6 },
  time: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview: { fontSize: 13, flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginLeft: 8, paddingHorizontal: 5 },
  badgeText: { fontSize: 11, fontWeight: 'bold' as const, fontFamily: 'Inter_700Bold' },
  sep: { height: StyleSheet.hairlineWidth },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 14, textAlign: 'center', fontFamily: 'Inter_400Regular' },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 88,
    gap: 4,
  },
  deleteActionText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(28, 28, 32, 0.96)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 9998,
  },
  undoLabel: {
    flex: 1,
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  undoBtn: {
    paddingHorizontal: 4,
  },
  undoBtnText: {
    color: '#6C9EFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
});
