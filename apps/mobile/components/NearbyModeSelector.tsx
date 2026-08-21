import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  OPERATING_MODE_ORDER,
  OPERATING_MODE_HINTS,
} from '@/src/nearby/nearbyPolicy';
import type { NearbyAudience, NearbyOperatingMode } from '@/src/nearby/types';
import { AUDIENCE_LABELS, OPERATING_MODE_LABELS } from '@/src/nearby/types';

export function NearbyModeSelector({
  operatingMode,
  audience,
  eventName,
  eventRemainingLabel,
  tint,
  eventTint,
  muted,
  border,
  text,
  busy,
  onSelectMode,
  onSelectAudience,
  onEndEvent,
  onCreateEvent,
  onOpenEvents,
  eventLive = false,
}: {
  operatingMode: NearbyOperatingMode;
  audience: NearbyAudience;
  eventName?: string | null;
  eventRemainingLabel: string;
  tint: string;
  eventTint: string;
  muted: string;
  border: string;
  text: string;
  busy: boolean;
  eventLive?: boolean;
  onSelectMode: (mode: NearbyOperatingMode) => void;
  onSelectAudience: (audience: NearbyAudience) => void;
  onEndEvent?: () => void;
  onCreateEvent?: () => void;
  onOpenEvents?: () => void;
}) {
  const activeTint = operatingMode === 'event' ? eventTint : tint;
  const showAudience = operatingMode !== 'invisible';

  return (
    <View style={styles.wrap}>
      <View
        accessibilityRole="tablist"
        accessibilityLabel="Nearby mode"
        style={[styles.segment, { borderColor: border }]}>
        {OPERATING_MODE_ORDER.map((mode) => {
          const selected = operatingMode === mode;
          const selectedBg = mode === 'event' ? eventTint : tint;
          return (
            <Pressable
              key={mode}
              accessibilityRole="tab"
              accessibilityLabel={OPERATING_MODE_LABELS[mode]}
              accessibilityHint={OPERATING_MODE_HINTS[mode]}
              accessibilityState={{ selected, disabled: busy }}
              onPress={() => onSelectMode(mode)}
              disabled={busy}
              style={[
                styles.segmentItem,
                selected && { backgroundColor: selectedBg },
              ]}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={[
                  styles.segmentLabel,
                  { color: selected ? '#042f2e' : text },
                ]}>
                {OPERATING_MODE_LABELS[mode]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {operatingMode === 'event' ? (
        <View style={styles.eventBlock}>
          {eventName ? (
            <Text style={[styles.eventName, { color: eventTint }]}>{eventName}</Text>
          ) : null}
          <Text style={[styles.eventStatus, { color: eventTint }]}>
            {eventLive
              ? `Event Mode active · ${eventRemainingLabel} left`
              : 'Event Mode radar · create or select a gathering'}
          </Text>
          {onCreateEvent ? (
            <Pressable
              onPress={onCreateEvent}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Create Event"
              style={[styles.createBtn, { backgroundColor: eventTint }]}>
              <Text style={styles.createLabel}>Create Event</Text>
            </Pressable>
          ) : null}
          {onOpenEvents ? (
            <Pressable
              onPress={onOpenEvents}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Events"
              style={[styles.endBtn, { borderColor: eventTint }]}>
              <Text style={{ color: eventTint, fontWeight: '800', fontSize: 13 }}>Events</Text>
            </Pressable>
          ) : null}
          {eventLive && onEndEvent ? (
            <Pressable
              onPress={onEndEvent}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="End Event Mode"
              style={[styles.endBtn, { borderColor: eventTint }]}>
              <Text style={{ color: eventTint, fontWeight: '800', fontSize: 13 }}>End Event Mode</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {showAudience ? (
        <View style={styles.audienceBlock}>
          <Text style={[styles.audienceCaption, { color: muted }]}>Who can find you</Text>
          <View style={styles.audienceRow}>
            {(['contacts', 'everyone'] as NearbyAudience[]).map((option) => {
              const selected = audience === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityLabel={AUDIENCE_LABELS[option]}
                  accessibilityState={{ selected, disabled: busy }}
                  onPress={() => onSelectAudience(option)}
                  disabled={busy}
                  style={[
                    styles.audienceChip,
                    {
                      borderColor: selected ? activeTint : border,
                      backgroundColor: selected ? `${activeTint}22` : 'transparent',
                    },
                  ]}>
                  <Text style={{ color: selected ? activeTint : muted, fontWeight: '700', fontSize: 13 }}>
                    {AUDIENCE_LABELS[option]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <Text style={[styles.invisibleNote, { color: muted }]}>
          Highest privacy. Existing chats, QR, and requests still work.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  segment: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  eventStatus: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
  eventBlock: { gap: 6, alignItems: 'center' },
  eventName: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  createBtn: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  createLabel: { color: '#042f2e', fontWeight: '800', fontSize: 15 },
  endBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  audienceBlock: { gap: 8 },
  audienceCaption: { fontSize: 12, fontWeight: '600' },
  audienceRow: { flexDirection: 'row', gap: 8 },
  audienceChip: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  invisibleNote: { fontSize: 13, lineHeight: 18 },
});
