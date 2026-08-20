import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { EventMemberPicker } from '@/components/EventMemberPicker';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api, type HopEvent } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import type { EventPickerCandidate } from '@/src/events/candidatePicker';
import { eventChatRoute, eventStatusLabel, eventWhenLabel, remainingMs } from '@/src/events/eventList';
import { DEFAULT_EVENT_DURATION_MS } from '@/src/nearby/types';
import { useNearbyPeers } from '@/src/nearby/useNearbyPeers';
import { useOffline } from '@/src/offline/OfflineProvider';
import { defaultLocalAvatarColor } from '@/src/profile/avatarAppearance';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const { listCachedConversations, safety, cacheConversation } = useOffline();
  const { peers, setOperatingMode, eventMode } = useNearbyPeers();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [event, setEvent] = useState<HopEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [selected, setSelected] = useState<EventPickerCandidate[]>([]);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [conversations, setConversations] = useState<Awaited<ReturnType<typeof listCachedConversations>>>([]);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const next = await api.getEvent(token, id);
      setEvent(next);
      setError(null);
      await cacheConversation({
        id: next.conversation_id,
        created_at: next.starts_at,
        peer: {
          id: next.host.id,
          username: next.name,
          identity_public_key: next.host.identity_public_key,
          has_avatar: next.host.has_avatar,
        },
        kind: 'event',
        title: next.name,
        event_id: next.id,
        archived: next.conversation_archived,
        members: next.members,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load event');
    }
  }, [cacheConversation, id, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function openInvitePicker() {
    const [convos, accepted] = await Promise.all([
      listCachedConversations(),
      safety ? safety.acceptedPeerIds() : Promise.resolve(new Set<string>()),
    ]);
    setConversations(convos);
    setAcceptedIds([...accepted]);
    setInviting(true);
  }

  function confirm(title: string, message: string, onYes: () => void) {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: onYes },
    ]);
  }

  async function run(action: () => Promise<HopEvent>) {
    setError(null);
    try {
      setEvent(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update event');
    }
  }

  async function activateEventMode() {
    if (!event) return;
    setError(null);
    try {
      await setOperatingMode('event', {
        durationMs: remainingMs(event) || DEFAULT_EVENT_DURATION_MS,
        eventName: event.name,
        eventId: event.id,
      });
      router.replace('/(tabs)/nearby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Event Mode');
    }
  }

  if (!event || !user) {
    return (
      <View style={styles.wrap}>
        <StatusBanner />
        {error ? <Text style={styles.error}>{error}</Text> : <Text>Loading…</Text>}
      </View>
    );
  }

  const isHost = event.my_role === 'host';
  const isGuest = event.my_role === 'guest';
  const isInvited = event.my_role === 'invited';
  const canChat = isHost || isGuest;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <StatusBanner />
      <Text style={[styles.title, { color: colors.text }]}>{event.name}</Text>
      <Text style={{ color: colors.event, fontWeight: '800' }}>{eventStatusLabel(event.row_status)}</Text>
      <Text style={{ color: colors.muted }}>Host · {event.host.username}</Text>
      <Text style={{ color: colors.muted }}>{eventWhenLabel(event)}</Text>
      <Text style={{ color: colors.muted }}>
        {event.visibility === 'discoverable' ? 'Discoverable nearby' : 'Invite only'} · {event.participant_count} people
      </Text>
      {eventMode.eventId === event.id && eventMode.enabled ? (
        <Text style={{ color: colors.event, fontWeight: '700' }}>Event Mode is on for this gathering.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isInvited ? (
        <View style={styles.rowBtns}>
          <Pressable onPress={() => void run(() => api.acceptEventInvite(token!, event.id))} style={[styles.btn, { backgroundColor: colors.event }]}>
            <Text style={styles.btnLabel}>Accept</Text>
          </Pressable>
          <Pressable onPress={() => void run(() => api.declineEventInvite(token!, event.id))} style={[styles.btn, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>Decline</Text>
          </Pressable>
        </View>
      ) : null}

      {event.my_role == null && event.visibility === 'discoverable' && event.status === 'active' ? (
        <Pressable onPress={() => void run(() => api.joinEvent(token!, event.id))} style={[styles.btn, { backgroundColor: colors.event }]}>
          <Text style={styles.btnLabel}>Join</Text>
        </Pressable>
      ) : null}

      {canChat && event.status === 'active' ? (
        <Pressable onPress={() => void activateEventMode()} style={[styles.btn, { backgroundColor: colors.event }]}>
          <Text style={styles.btnLabel}>Use Event Mode</Text>
        </Pressable>
      ) : null}

      {canChat ? (
        <Pressable
          onPress={() => router.push(eventChatRoute(event) as `/chat/${string}`)}
          style={[styles.btn, { backgroundColor: colors.tint }]}>
          <Text style={styles.btnLabel}>{event.conversation_archived ? 'Open archived Event Chat' : 'Event Chat'}</Text>
        </Pressable>
      ) : null}

      <Text style={[styles.section, { color: colors.muted }]}>Participants</Text>
      {event.members.map((member) => (
        <View key={member.id} style={[styles.person, { borderColor: colors.border }]}>
          <ProfileAvatar
            userId={member.id}
            username={member.username}
            color={defaultLocalAvatarColor(member.id)}
            size={36}
            hasAvatar={member.has_avatar}
          />
          <View style={styles.personMeta}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{member.username}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{member.role === 'host' ? 'Host' : 'Guest'}</Text>
          </View>
          {isHost && member.role === 'guest' ? (
            <Pressable
              onPress={() =>
                confirm('Remove guest', `${member.username} will lose Event Chat and participation.`, () => {
                  void run(() => api.removeEventMember(token!, event.id, member.id));
                })
              }>
              <Text style={{ color: colors.destructive, fontWeight: '800' }}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {isHost && event.pending_invites.length > 0 ? (
        <>
          <Text style={[styles.section, { color: colors.muted }]}>Pending invites</Text>
          {event.pending_invites.map((invite) => (
            <View key={invite.invitee.id} style={[styles.person, { borderColor: colors.border }]}>
              <ProfileAvatar
                userId={invite.invitee.id}
                username={invite.invitee.username}
                color={defaultLocalAvatarColor(invite.invitee.id)}
                size={36}
                hasAvatar={invite.invitee.has_avatar}
              />
              <Text style={{ color: colors.text, flex: 1, fontWeight: '700' }}>{invite.invitee.username}</Text>
              <Pressable
                onPress={() =>
                  confirm('Cancel invite', `Withdraw the invite for ${invite.invitee.username}?`, () => {
                    void run(() => api.cancelEventInvite(token!, event.id, invite.invitee.id));
                  })
                }>
                <Text style={{ color: colors.destructive, fontWeight: '800' }}>Cancel Invite</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}

      {isHost && event.status !== 'ended' ? (
        <>
          <Pressable onPress={() => void openInvitePicker()} style={[styles.btn, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>Invite People</Text>
          </Pressable>
          {inviting ? (
            <>
              <EventMemberPicker
                selfId={user.id}
                token={token}
                nearby={peers}
                acceptedIds={acceptedIds}
                conversations={conversations}
                selected={selected}
                onChange={setSelected}
                tint={colors.event}
                muted={colors.muted}
                text={colors.text}
                card={colors.card}
                border={colors.border}
              />
              <Pressable
                onPress={() =>
                  void run(async () => {
                    const next = await api.inviteToEvent(
                      token!,
                      event.id,
                      selected.map((row) => row.username),
                    );
                    setInviting(false);
                    setSelected([]);
                    return next;
                  })
                }
                style={[styles.btn, { backgroundColor: colors.event }]}>
                <Text style={styles.btnLabel}>Send invites</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            onPress={() =>
              confirm('End event', 'Event Chat will be archived. People keep history they already have.', () => {
                void run(() => api.endEvent(token!, event.id));
              })
            }
            style={[styles.btn, { backgroundColor: colors.destructive }]}>
            <Text style={styles.btnLabel}>End Event</Text>
          </Pressable>
        </>
      ) : null}

      {isGuest ? (
        <Pressable
          onPress={() =>
            confirm('Leave event', 'You will leave this gathering and lose future Event Chat.', () => {
              void run(() => api.leaveEvent(token!, event.id)).then(() => router.replace('/events'));
            })
          }
          style={[styles.btn, { backgroundColor: colors.card }]}>
          <Text style={{ color: colors.destructive, fontWeight: '800' }}>Leave Event</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 10, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '800' },
  section: { marginTop: 8, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', fontSize: 12 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10 },
  personMeta: { flex: 1, backgroundColor: 'transparent' },
  rowBtns: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  btnLabel: { color: '#042f2e', fontWeight: '800', fontSize: 16 },
  error: { color: '#DC2626' },
});
