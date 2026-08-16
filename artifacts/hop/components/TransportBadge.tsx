import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TransportKind } from '@/hooks/useTransportState';
import type { useColors } from '@/hooks/useColors';

// ─── Per-transport visual config ─────────────────────────────────────────────

const CONFIG: Record<
  TransportKind,
  { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; pulse: boolean }
> = {
  bluetooth: { icon: 'bluetooth',       color: '#00CCFF', pulse: true  },
  internet:  { icon: 'globe-outline',   color: '#22C55E', pulse: false },
  queued:    { icon: 'cloud-offline-outline', color: '#F59E0B', pulse: false },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  kind: TransportKind;
  label: string;
  colors: ReturnType<typeof useColors>;
}

export function TransportBadge({ kind, label, colors }: Props) {
  const cfg = CONFIG[kind];

  // Subtle opacity pulse for BLE — communicates "live" radio link
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!cfg.pulse) {
      opacity.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [cfg.pulse]);

  return (
    <Animated.View style={[styles.row, { opacity: cfg.pulse ? opacity : 1 }]}>
      <Ionicons name={cfg.icon} size={11} color={cfg.color} />
      <Text style={[styles.label, { color: cfg.color }]}>{label}</Text>
    </Animated.View>
  );
}

// ─── Offline queue banner (shown at top of message list) ──────────────────────

interface BannerProps {
  colors: ReturnType<typeof useColors>;
}

export function OfflineQueueBanner({ colors }: BannerProps) {
  return (
    <View style={[styles.banner, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}>
      <Ionicons name="time-outline" size={13} color="#F59E0B" />
      <Text style={styles.bannerText}>
        No connection · messages will send when you reconnect
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  label: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#F59E0B',
    flex: 1,
  },
});
