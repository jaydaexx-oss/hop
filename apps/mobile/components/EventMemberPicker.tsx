import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Text } from '@/components/Themed';
import { defaultLocalAvatarColor } from '@/src/profile/avatarAppearance';
import {
  eventPickerCandidates,
  filterEventPickerCandidates,
  type EventPickerCandidate,
} from '@/src/events/candidatePicker';
import type { AroundUsPeer } from '@/src/nearby/types';
import type { Conversation } from '@/src/api/hop';
import { api } from '@/src/api/hop';

export function EventMemberPicker({
  selfId,
  token,
  nearby,
  acceptedIds,
  conversations,
  selected,
  onChange,
  tint,
  muted,
  text,
  card,
  border,
}: {
  selfId: string;
  token: string | null;
  nearby: AroundUsPeer[];
  acceptedIds: Iterable<string>;
  conversations: Conversation[];
  selected: EventPickerCandidate[];
  onChange: (next: EventPickerCandidate[]) => void;
  tint: string;
  muted: string;
  text: string;
  card: string;
  border: string;
}) {
  const [query, setQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const base = useMemo(
    () => eventPickerCandidates({ selfId, nearby, acceptedIds, conversations }),
    [acceptedIds, conversations, nearby, selfId],
  );
  const visible = filterEventPickerCandidates(base, query);
  const selectedIds = new Set(selected.map((row) => row.userId));

  function toggle(row: EventPickerCandidate) {
    if (selectedIds.has(row.userId)) {
      onChange(selected.filter((item) => item.userId !== row.userId));
      return;
    }
    onChange([...selected, row]);
  }

  async function searchUsername() {
    if (!token) return;
    const username = query.trim().toLowerCase();
    if (username.length < 3) return;
    setSearchError(null);
    try {
      const user = await api.userByUsername(token, username);
      if (user.id === selfId) return;
      const next = { userId: user.id, username: user.username, source: 'recent' as const, hasAvatar: user.has_avatar };
      if (!selectedIds.has(user.id)) onChange([...selected, next]);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'User not found');
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.count, { color: muted }]}>{selected.length} selected</Text>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search username"
          placeholderTextColor={muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: text, borderColor: border, backgroundColor: card }]}
        />
        <Pressable onPress={() => void searchUsername()} style={[styles.searchBtn, { backgroundColor: tint }]}>
          <Text style={styles.searchLabel}>Add</Text>
        </Pressable>
      </View>
      {searchError ? <Text style={styles.error}>{searchError}</Text> : null}
      <ScrollView style={styles.list}>
        {visible.map((row) => {
          const on = selectedIds.has(row.userId);
          return (
            <Pressable
              key={row.userId}
              onPress={() => toggle(row)}
              style={[styles.row, { borderColor: border, backgroundColor: card }]}>
              <ProfileAvatar
                userId={row.userId}
                username={row.username}
                color={defaultLocalAvatarColor(row.userId)}
                size={36}
                hasAvatar={row.hasAvatar}
              />
              <View style={styles.meta}>
                <Text style={{ color: text, fontWeight: '700' }}>{row.username}</Text>
                <Text style={{ color: muted, fontSize: 12 }}>
                  {row.source === 'nearby' ? 'Nearby' : row.source === 'contacts' ? 'Contact' : 'Recent chat'}
                </Text>
              </View>
              <Text style={{ color: on ? tint : muted, fontWeight: '800' }}>{on ? '✓' : ''}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, minHeight: 220 },
  count: { fontWeight: '700' },
  searchRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  searchBtn: { borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' },
  searchLabel: { color: '#042f2e', fontWeight: '800' },
  list: { maxHeight: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  meta: { flex: 1, backgroundColor: 'transparent' },
  error: { color: '#DC2626' },
});
