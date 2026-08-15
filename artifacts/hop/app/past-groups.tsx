import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LeftGroup, useHop } from '@/context/HopContext';
import { useColors } from '@/hooks/useColors';

function formatLeftAt(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function LeftGroupRow({
  entry,
  onRejoin,
  colors,
}: {
  entry: LeftGroup;
  onRejoin: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const { group, leftAt } = entry;
  const shown = group.members.slice(0, 3);
  const AVATAR = 44;
  const OVERLAP = AVATAR * 0.5;
  const clusterW = AVATAR + (shown.length - 1) * OVERLAP;

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      {/* Avatar cluster */}
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
                left: i * OVERLAP,
                top: 3,
                zIndex: shown.length - i,
                borderColor: colors.card,
              },
            ]}
          >
            <Text style={styles.avatarText}>{m.username[0].toUpperCase()}</Text>
          </View>
        ))}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {group.members.length} members · left {formatLeftAt(leftAt)}
        </Text>
      </View>

      {/* Rejoin button */}
      <TouchableOpacity
        onPress={onRejoin}
        style={[styles.rejoinBtn, { backgroundColor: colors.primary }]}
        activeOpacity={0.75}
      >
        <Ionicons name="enter-outline" size={14} color={colors.primaryForeground} />
        <Text style={[styles.rejoinText, { color: colors.primaryForeground }]}>Rejoin</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function PastGroupsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { leftGroups, rejoinGroup } = useHop();

  const handleRejoin = (groupId: string, groupName: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    rejoinGroup(groupId);
    // Navigate back to messages after a short delay so the list update is visible
    setTimeout(() => router.replace('/(tabs)/messages'), 300);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Past Groups</Text>
        <View style={{ width: 36 }} />
      </View>

      {leftGroups.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No past groups</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Groups you leave will appear here so you can rejoin later.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Tap Rejoin to jump back into a group you previously left.
          </Text>
          {leftGroups.map(entry => (
            <LeftGroupRow
              key={entry.group.id}
              entry={entry}
              colors={colors}
              onRejoin={() => handleRejoin(entry.group.id, entry.group.name)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, alignItems: 'center' },
  title: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  hint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  avatarText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  info: { flex: 1 },
  name: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  sub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  rejoinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
  },
  rejoinText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 14, textAlign: 'center', fontFamily: 'Inter_400Regular' },
});
