import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EVENT_ENTRY_COPY } from '@/src/nearby/nearbyPolicy';
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
import type { NearbyAudience } from '@/src/nearby/types';
import { AUDIENCE_LABELS } from '@/src/nearby/types';

type DurationChoice = EventDurationPresetKey | 'custom';

export type EventSetupValues = {
  name: string;
  durationMs: number;
  audience: NearbyAudience;
};

export function EventSetupSheet({
  visible,
  onDismiss,
  onStart,
  initialAudience,
  tint,
}: {
  visible: boolean;
  onDismiss: () => void;
  onStart: (values: EventSetupValues) => void;
  initialAudience: NearbyAudience;
  tint: string;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<DurationChoice>('2h');
  const [customHours, setCustomHours] = useState('1');
  const [customMinutes, setCustomMinutes] = useState('0');
  const [audience, setAudience] = useState<NearbyAudience>(initialAudience);

  useEffect(() => {
    if (visible) setAudience(initialAudience);
  }, [initialAudience, visible]);

  const durationMs =
    choice === 'custom'
      ? customEventDurationMs(Number(customHours) || 0, Number(customMinutes) || 0)
      : EVENT_DURATION_PRESET_MS[choice];
  const eventName = normalizeEventName(name);
  const canStart = Boolean(eventName);

  function resetAndDismiss() {
    setName('');
    setChoice('2h');
    setCustomHours('1');
    setCustomMinutes('0');
    onDismiss();
  }

  function start() {
    if (!eventName) return;
    onStart({
      name: eventName,
      durationMs: clampEventDurationMs(durationMs),
      audience,
    });
    setName('');
    setChoice('2h');
    setCustomHours('1');
    setCustomMinutes('0');
  }

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={resetAndDismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={resetAndDismiss} accessibilityLabel="Dismiss" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoid} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{EVENT_ENTRY_COPY.title}</Text>
          <Text style={styles.message}>{EVENT_ENTRY_COPY.body}</Text>

          <Text style={styles.label}>Event name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Campus mixer"
            placeholderTextColor="#6B7280"
            maxLength={MAX_EVENT_NAME_LENGTH}
            autoCapitalize="sentences"
            style={styles.input}
          />

          <Text style={styles.label}>Duration</Text>
          <View style={styles.chips}>
            {EVENT_DURATION_PRESET_KEYS.map((key) => {
              const selected = choice === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setChoice(key)}
                  style={[styles.chip, selected && { backgroundColor: tint, borderColor: tint }]}>
                  <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>{key}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setChoice('custom')}
              style={[styles.chip, choice === 'custom' && { backgroundColor: tint, borderColor: tint }]}>
              <Text style={[styles.chipLabel, choice === 'custom' && styles.chipLabelOn]}>Custom</Text>
            </Pressable>
          </View>
          {choice === 'custom' ? (
            <View style={styles.customRow}>
              <TextInput
                value={customHours}
                onChangeText={setCustomHours}
                keyboardType="number-pad"
                style={[styles.input, styles.customInput]}
                placeholder="Hours"
                placeholderTextColor="#6B7280"
              />
              <Text style={styles.customUnit}>h</Text>
              <TextInput
                value={customMinutes}
                onChangeText={setCustomMinutes}
                keyboardType="number-pad"
                style={[styles.input, styles.customInput]}
                placeholder="Minutes"
                placeholderTextColor="#6B7280"
              />
              <Text style={styles.customUnit}>m</Text>
              <Text style={styles.customHint}>{eventDurationLabel(durationMs)}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Who can find you</Text>
          <View style={styles.audienceRow}>
            {(['contacts', 'everyone'] as NearbyAudience[]).map((option) => {
              const selected = audience === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setAudience(option)}
                  style={[
                    styles.audienceChip,
                    { borderColor: selected ? tint : '#374151', backgroundColor: selected ? `${tint}22` : 'transparent' },
                  ]}>
                  <Text style={{ color: selected ? tint : '#9CA3AF', fontWeight: '700', fontSize: 13 }}>
                    {AUDIENCE_LABELS[option]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={start}
            disabled={!canStart}
            style={[styles.startBtn, { backgroundColor: tint, opacity: canStart ? 1 : 0.45 }]}>
            <Text style={styles.startLabel}>{EVENT_ENTRY_COPY.confirm}</Text>
          </Pressable>
          <Pressable onPress={resetAndDismiss} style={styles.cancelRow}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  avoid: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
    backgroundColor: '#374151',
  },
  title: { fontSize: 18, fontWeight: '800', color: '#F9FAFB', marginBottom: 8 },
  message: { fontSize: 13, color: '#D1D5DB', lineHeight: 19, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: '#9CA3AF', marginBottom: 8, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F9FAFB',
    fontSize: 16,
    backgroundColor: '#1F2937',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1.5,
    borderColor: '#374151',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipLabel: { color: '#D1D5DB', fontWeight: '800', fontSize: 13 },
  chipLabelOn: { color: '#042f2e' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  customInput: { flex: 1, paddingVertical: 10 },
  customUnit: { color: '#9CA3AF', fontWeight: '700' },
  customHint: { color: '#9CA3AF', fontWeight: '700', minWidth: 48 },
  audienceRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  audienceChip: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  startBtn: { marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  startLabel: { color: '#042f2e', fontWeight: '800', fontSize: 16 },
  cancelRow: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#1F2937',
  },
  cancelLabel: { fontSize: 15, fontWeight: '700', color: '#9CA3AF' },
});
