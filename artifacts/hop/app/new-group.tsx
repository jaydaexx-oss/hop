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
import { useColors } from '@/hooks/useColors';
import { HopUser, useHop } from '@/context/HopContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

function MemberRow({
  user,
  selected,
  onToggle,
  colors,
}: {
  user: HopUser;
  selected: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.secondary : 'transparent' },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: user.color }]}>
        <Text style={styles.avatarText}>{user.username[0].toUpperCase()}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowName, { color: colors.foreground }]}>{user.username}</Text>
        <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
          {Math.round(user.signal)}% signal
        </Text>
      </View>
      <View
        style={[
          styles.check,
          {
            backgroundColor: selected ? colors.primary : 'transparent',
            borderColor: selected ? colors.primary : colors.border,
          },
        ]}
      >
        {selected && <Ionicons name="checkmark" size={14} color={colors.primaryForeground} />}
      </View>
    </Pressable>
  );
}

export default function NewGroupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { nearbyUsers, createGroup } = useHop();
  const [groupName, setGroupName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const toggle = (id: string) => {
    Haptics.selectionAsync();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const canCreate = selected.size >= 2;

  const handleCreate = () => {
    if (!canCreate) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const group = createGroup(groupName, Array.from(selected));
    if (group) {
      router.replace(`/group/${group.id}`);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>New Group</Text>
        <Pressable
          onPress={handleCreate}
          disabled={!canCreate}
          style={[styles.createBtn, { backgroundColor: canCreate ? colors.primary : colors.secondary }]}
        >
          <Text style={[styles.createBtnText, { color: canCreate ? colors.primaryForeground : colors.mutedForeground }]}>
            Create
          </Text>
        </Pressable>
      </View>

      {/* Group name input */}
      <View style={[styles.nameSection, { borderBottomColor: colors.border }]}>
        <Ionicons name="people" size={20} color={colors.primary} style={{ marginRight: 12 }} />
        <TextInput
          style={[styles.nameInput, { color: colors.foreground }]}
          placeholder="Group name (optional)"
          placeholderTextColor={colors.mutedForeground}
          value={groupName}
          onChangeText={setGroupName}
          maxLength={40}
          returnKeyType="done"
        />
      </View>

      {/* Member count hint */}
      <View style={styles.sectionLabel}>
        <Text style={[styles.sectionText, { color: colors.mutedForeground }]}>
          NEARBY — SELECT AT LEAST 2
        </Text>
        {selected.size > 0 && (
          <Text style={[styles.sectionCount, { color: colors.primary }]}>
            {selected.size} selected
          </Text>
        )}
      </View>

      <FlatList
        data={nearbyUsers}
        keyExtractor={u => u.id}
        renderItem={({ item }) => (
          <MemberRow
            user={item}
            selected={selected.has(item.id)}
            onToggle={() => toggle(item.id)}
            colors={colors}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.sep, { backgroundColor: colors.border, marginLeft: 78 }]} />
        )}
        contentContainerStyle={{ paddingBottom: bottomPad + 20 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="radio-outline" size={44} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No nearby users detected yet
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  title: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold' },
  createBtn: { borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8 },
  createBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  nameSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nameInput: { flex: 1, fontSize: 16, fontFamily: 'Inter_500Medium' },
  sectionLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 },
  sectionCount: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 17, fontFamily: 'Inter_700Bold' },
  rowBody: { flex: 1 },
  rowName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  rowSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  sep: { height: StyleSheet.hairlineWidth },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 32 },
});
