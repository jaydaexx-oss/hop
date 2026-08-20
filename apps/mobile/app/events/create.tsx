import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { EventMemberPicker } from '@/components/EventMemberPicker';
import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import type { EventPickerCandidate } from '@/src/events/candidatePicker';
import {
  EVENT_DURATION_PRESET_KEYS,
  EVENT_DURATION_PRESET_MS,
  MAX_EVENT_NAME_LENGTH,
  clampEventDurationMs,
  customEventDurationMs,
  eventDurationLabel,
  normalizeEventName,
  type EventDurationPresetKey,
} from '@/src/nearby/eventDuration';
import { useNearbyPeers } from '@/src/nearby/useNearbyPeers';
import { useOffline } from '@/src/offline/OfflineProvider';

type DurationChoice = EventDurationPresetKey | 'custom';
type Visibility = 'invite_only' | 'discoverable';

export default function CreateEventScreen() {
  const { token, user } = useAuth();
  const { listCachedConversations, safety } = useOffline();
  const { peers } = useNearbyPeers();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<DurationChoice>('2h');
  const [customHours, setCustomHours] = useState('1');
  const [customMinutes, setCustomMinutes] = useState('0');
  const [visibility, setVisibility] = useState<Visibility>('invite_only');
  const [selected, setSelected] = useState<EventPickerCandidate[]>([]);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [conversations, setConversations] = useState<Awaited<ReturnType<typeof listCachedConversations>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const durationMs =
    choice === 'custom'
      ? customEventDurationMs(Number(customHours) || 0, Number(customMinutes) || 0)
      : EVENT_DURATION_PRESET_MS[choice];
  const eventName = normalizeEventName(name);

  async function loadPicker() {
    const [convos, accepted] = await Promise.all([
      listCachedConversations(),
      safety ? safety.acceptedPeerIds() : Promise.resolve(new Set<string>()),
    ]);
    setConversations(convos);
    setAcceptedIds([...accepted]);
  }

  async function create() {
    if (!token || !eventName) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createEvent(token, {
        name: eventName,
        duration_ms: clampEventDurationMs(durationMs),
        visibility,
        invite_usernames: selected.map((row) => row.username),
      });
      router.replace(`/events/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create event');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <StatusBanner />
      <Text style={[styles.title, { color: colors.text }]}>Create Event</Text>
      {step === 0 ? (
        <>
          <Text style={[styles.label, { color: colors.muted }]}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Campus mixer"
            placeholderTextColor={colors.muted}
            maxLength={MAX_EVENT_NAME_LENGTH}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          />
          <Pressable
            disabled={!eventName}
            onPress={() => setStep(1)}
            style={[styles.btn, { backgroundColor: colors.event, opacity: eventName ? 1 : 0.45 }]}>
            <Text style={styles.btnLabel}>Next</Text>
          </Pressable>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <Text style={[styles.label, { color: colors.muted }]}>Duration</Text>
          <View style={styles.chips}>
            {EVENT_DURATION_PRESET_KEYS.map((key) => {
              const on = choice === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setChoice(key)}
                  style={[styles.chip, { borderColor: on ? colors.event : colors.border, backgroundColor: on ? colors.event : 'transparent' }]}>
                  <Text style={{ color: on ? '#042f2e' : colors.text, fontWeight: '800' }}>{key}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setChoice('custom')}
              style={[styles.chip, { borderColor: choice === 'custom' ? colors.event : colors.border, backgroundColor: choice === 'custom' ? colors.event : 'transparent' }]}>
              <Text style={{ color: choice === 'custom' ? '#042f2e' : colors.text, fontWeight: '800' }}>Custom</Text>
            </Pressable>
          </View>
          {choice === 'custom' ? (
            <View style={styles.customRow}>
              <TextInput
                value={customHours}
                onChangeText={setCustomHours}
                keyboardType="number-pad"
                style={[styles.input, styles.custom, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
              <Text style={{ color: colors.muted }}>h</Text>
              <TextInput
                value={customMinutes}
                onChangeText={setCustomMinutes}
                keyboardType="number-pad"
                style={[styles.input, styles.custom, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              />
              <Text style={{ color: colors.muted }}>m · {eventDurationLabel(durationMs)}</Text>
            </View>
          ) : null}
          <Pressable onPress={() => setStep(2)} style={[styles.btn, { backgroundColor: colors.event }]}>
            <Text style={styles.btnLabel}>Next</Text>
          </Pressable>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <Text style={[styles.label, { color: colors.muted }]}>Visibility</Text>
          <Pressable
            onPress={() => setVisibility('invite_only')}
            style={[styles.choice, { borderColor: visibility === 'invite_only' ? colors.event : colors.border }]}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>Private / Invite only</Text>
            <Text style={{ color: colors.muted }}>Only invited people can join.</Text>
          </Pressable>
          <Pressable
            onPress={() => setVisibility('discoverable')}
            style={[styles.choice, { borderColor: visibility === 'discoverable' ? colors.event : colors.border }]}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>Discoverable nearby</Text>
            <Text style={{ color: colors.muted }}>Others can find it and must tap Join. Not auto-join.</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void loadPicker();
              setStep(3);
            }}
            style={[styles.btn, { backgroundColor: colors.event }]}>
            <Text style={styles.btnLabel}>Invite people</Text>
          </Pressable>
        </>
      ) : null}
      {step === 3 && user ? (
        <>
          <Text style={[styles.label, { color: colors.muted }]}>Invite people</Text>
          <Text style={{ color: colors.muted }}>Nearby, contacts, and recent chats. Nearby people are not added automatically.</Text>
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
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            disabled={busy}
            onPress={() => void create()}
            style={[styles.btn, { backgroundColor: colors.event, opacity: busy ? 0.6 : 1 }]}>
            <Text style={styles.btnLabel}>Create</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 12, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '800' },
  label: { fontWeight: '800', textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  custom: { flex: 1 },
  choice: { borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 4 },
  btn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  btnLabel: { color: '#042f2e', fontWeight: '800', fontSize: 16 },
  error: { color: '#DC2626' },
});
