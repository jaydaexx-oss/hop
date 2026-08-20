import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api, type HopEvent } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { eventStatusLabel, eventWhenLabel, groupEvents } from '@/src/events/eventList';
import { useOffline } from '@/src/offline/OfflineProvider';
import { useHopSocket } from '@/src/ws';

export default function EventsListScreen() {
  const { token, user } = useAuth();
  const { store } = useOffline();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [events, setEvents] = useState<HopEvent[]>([]);
  const [discoverable, setDiscoverable] = useState<HopEvent[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [mine, open] = await Promise.all([api.events(token), api.discoverableEvents(token).catch(() => [])]);
      setEvents(mine);
      setDiscoverable(open.filter((row) => !mine.some((item) => item.id === row.id)));
      setError(null);
      if (store && user) {
        const counts: Record<string, number> = {};
        for (const event of mine) {
          counts[event.id] = await store.unreadCount(event.conversation_id, user.id);
        }
        setUnread(counts);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load events');
    }
  }, [store, token, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useHopSocket(token, (event) => {
    if (event.type === 'event_invite' || event.type === 'message') void load();
  });

  const grouped = useMemo(() => groupEvents(events), [events]);

  function renderEvent(event: HopEvent) {
    const unreadCount = unread[event.id] ?? 0;
    return (
      <Pressable
        key={event.id}
        onPress={() => router.push(`/events/${event.id}`)}
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardTop}>
          <Text style={[styles.name, { color: colors.text }]}>{event.name}</Text>
          <Text style={{ color: colors.event, fontWeight: '800' }}>{eventStatusLabel(event.row_status)}</Text>
        </View>
        <Text style={{ color: colors.muted }}>Host · {event.host.username}</Text>
        <Text style={{ color: colors.muted }}>{eventWhenLabel(event)}</Text>
        <Text style={{ color: colors.muted }}>
          {event.participant_count} {event.participant_count === 1 ? 'person' : 'people'}
          {unreadCount > 0 ? ` · ${unreadCount} new in Event Chat` : ''}
        </Text>
      </Pressable>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <StatusBanner />
      <Text style={[styles.title, { color: colors.text }]}>Events</Text>
      <Text style={{ color: colors.muted, marginBottom: 12 }}>
        Create or join a gathering. Event Mode radar turns on only after you select an active event.
      </Text>
      <Pressable
        onPress={() => router.push('/events/create')}
        style={[styles.create, { backgroundColor: colors.event }]}>
        <Text style={styles.createLabel}>+ Create Event</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={[styles.section, { color: colors.muted }]}>Active</Text>
      {grouped.active.length === 0 ? <Text style={{ color: colors.muted }}>No active events.</Text> : grouped.active.map(renderEvent)}

      <Text style={[styles.section, { color: colors.muted }]}>Upcoming / Invited</Text>
      {grouped.upcoming.length === 0 ? (
        <Text style={{ color: colors.muted }}>No upcoming events or invites.</Text>
      ) : (
        grouped.upcoming.map(renderEvent)
      )}

      {discoverable.length > 0 ? (
        <>
          <Text style={[styles.section, { color: colors.muted }]}>Discoverable nearby</Text>
          {discoverable.map(renderEvent)}
        </>
      ) : null}

      <Text style={[styles.section, { color: colors.muted }]}>Past</Text>
      {grouped.past.length === 0 ? <Text style={{ color: colors.muted }}>No ended events.</Text> : grouped.past.map(renderEvent)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40, gap: 8 },
  title: { fontSize: 28, fontWeight: '800' },
  create: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  createLabel: { color: '#042f2e', fontWeight: '800', fontSize: 16 },
  section: { marginTop: 16, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', fontSize: 12 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, backgroundColor: 'transparent' },
  name: { fontSize: 18, fontWeight: '800', flex: 1 },
  error: { color: '#DC2626' },
});
