import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { AroundUsPeer, NearbyOperatingMode } from '@/src/nearby/types';
import { layoutRadarNodes, type RadarNode } from '@/src/nearby/radarLayout';
import { radarShouldAnimate } from '@/src/nearby/scanState';
import {
  CONCENTRIC_RING_RATIOS,
  RING_PULSE_AMOUNT,
  TRAIL_STEP_DEG,
  TRAIL_STEPS,
  beamGlow,
  ringSweepPulse,
  sweepDurationMs,
  trailHeight,
  trailOpacity,
} from '@/src/nearby/radarSweep';
import { useProfilePhoto } from '@/src/profile/useProfilePhoto';
import { Avatar } from '@/components/Avatar';

const NODE_SIZE = 36;
const TRAIL_INDICES = Array.from({ length: TRAIL_STEPS }, (_, i) => i + 1);

function useAppIsActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
    });
    return () => sub.remove();
  }, []);
  return active;
}

function RadarSelf({ name, color, userId }: { name: string; color: string; userId?: string | null }) {
  const { uri } = useProfilePhoto(userId);
  return <Avatar username={name} color={color} size={28} uri={uri} />;
}

function RadarRing({
  size,
  ratio,
  center,
  tint,
  eventActive,
  invisible,
  animate,
  sweepDeg,
}: {
  size: number;
  ratio: number;
  center: number;
  tint: string;
  eventActive: boolean;
  invisible: boolean;
  animate: boolean;
  sweepDeg: SharedValue<number>;
}) {
  const dim = size * ratio;
  const baseOpacity = invisible ? 0.18 : eventActive ? 0.5 : 0.35;
  const style = useAnimatedStyle(() => {
    if (!animate) return { opacity: baseOpacity };
    const pulse = RING_PULSE_AMOUNT * ringSweepPulse(sweepDeg.value);
    return { opacity: Math.min(1, baseOpacity + pulse) };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          borderWidth: eventActive ? 1 : 0.6,
          borderColor: tint,
          left: center - dim / 2,
          top: center - dim / 2,
        },
        style,
      ]}
    />
  );
}

function SweepArm({ size, center, tint }: { size: number; center: number; tint: string }) {
  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      {TRAIL_INDICES.map((step) => {
        const height = trailHeight(step);
        return (
          <View
            key={step}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${-step * TRAIL_STEP_DEG}deg` }] }]}>
            <View
              style={{
                position: 'absolute',
                left: center,
                top: center - height / 2,
                width: center,
                height,
                backgroundColor: tint,
                opacity: trailOpacity(step),
              }}
            />
          </View>
        );
      })}
      <View
        style={{
          position: 'absolute',
          left: center,
          top: center - 5,
          width: center,
          height: 10,
          backgroundColor: tint,
          opacity: 0.16,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: center,
          top: center - 1,
          width: center,
          height: 2,
          backgroundColor: tint,
          opacity: 0.95,
          shadowColor: tint,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.9,
          shadowRadius: 8,
        }}
      />
      {CONCENTRIC_RING_RATIOS.map((ratio) => (
        <View
          key={ratio}
          style={{
            position: 'absolute',
            left: center + center * ratio - 4,
            top: center - 4,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: tint,
            opacity: 0.42,
          }}
        />
      ))}
    </View>
  );
}

function RadarDot({
  node,
  color,
  userId,
  onPress,
  sweepDeg,
  animate,
}: {
  node: RadarNode;
  color: string;
  userId?: string;
  onPress: () => void;
  sweepDeg: SharedValue<number>;
  animate: boolean;
}) {
  const { uri } = useProfilePhoto(userId);
  const nodeDeg = (node.angle * 180) / Math.PI;
  const haloStyle = useAnimatedStyle(() => {
    const glow = animate ? beamGlow(sweepDeg.value, nodeDeg) : 0;
    return {
      opacity: glow * 0.8,
      transform: [{ scale: 0.85 + glow * 0.45 }],
    };
  });
  const avatarStyle = useAnimatedStyle(() => {
    const glow = animate ? beamGlow(sweepDeg.value, nodeDeg) : 0;
    return {
      transform: [{ scale: 1 + glow * 0.1 }],
    };
  });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${node.displayName}, ${node.proximity.replace('_', ' ')}`}
      style={{
        position: 'absolute',
        left: node.x - NODE_SIZE / 2,
        top: node.y - NODE_SIZE / 2,
        width: NODE_SIZE + 8,
        alignItems: 'center',
        zIndex: 5,
      }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: -6,
            left: -2,
            width: NODE_SIZE + 12,
            height: NODE_SIZE + 12,
            borderRadius: (NODE_SIZE + 12) / 2,
            backgroundColor: color,
          },
          haloStyle,
        ]}
      />
      <Animated.View style={avatarStyle}>
        <Avatar username={node.displayName} color={color} size={NODE_SIZE} uri={uri} borderColor={color} borderWidth={2} />
      </Animated.View>
      <Text numberOfLines={1} style={styles.nodeLabel}>
        {node.displayName}
      </Text>
    </Pressable>
  );
}

export function NearbyRadar({
  peers,
  size,
  tint,
  border,
  scanning,
  selfName,
  selfColor,
  emptyCopy,
  onPressPeer,
  operatingMode = 'around_us',
  reduceMotion = false,
  eventRemainingLabel,
  eventName,
  selfUserId,
}: {
  peers: AroundUsPeer[];
  size: number;
  tint: string;
  border: string;
  scanning: boolean;
  selfName: string;
  selfColor: string;
  emptyCopy: string;
  onPressPeer: (peer: AroundUsPeer) => void;
  operatingMode?: NearbyOperatingMode;
  reduceMotion?: boolean;
  eventRemainingLabel?: string;
  eventName?: string | null;
  selfUserId?: string | null;
}) {
  const tabFocused = useIsFocused();
  const appActive = useAppIsActive();
  const sweepDeg = useSharedValue(0);
  const nodes = layoutRadarNodes(peers, size);
  const byToken = new Map(peers.map((peer) => [peer.token, peer]));
  const center = size / 2;
  const invisible = operatingMode === 'invisible';
  const eventActive = operatingMode === 'event';
  const animate = radarShouldAnimate({ scanning, reduceMotion, invisible, tabFocused, appActive });
  const discOpacity = invisible ? 0.42 : 1;
  const sweepMs = sweepDurationMs(eventActive);

  useEffect(() => {
    if (!animate) {
      cancelAnimation(sweepDeg);
      return;
    }
    const raw = sweepDeg.value;
    const start = ((raw % 360) + 360) % 360;
    sweepDeg.value = start;
    sweepDeg.value = withRepeat(
      withTiming(start + 360, { duration: sweepMs, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(sweepDeg);
    };
  }, [animate, sweepDeg, sweepMs]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sweepDeg.value}deg` }],
  }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View
        style={[
          styles.disc,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: eventActive ? tint : border,
            borderWidth: eventActive ? 2 : 1,
            opacity: discOpacity,
          },
        ]}>
        {CONCENTRIC_RING_RATIOS.map((ratio) => (
          <RadarRing
            key={ratio}
            size={size}
            ratio={ratio}
            center={center}
            tint={tint}
            eventActive={eventActive}
            invisible={invisible}
            animate={animate}
            sweepDeg={sweepDeg}
          />
        ))}
        <View pointerEvents="none" style={[styles.crossH, { backgroundColor: border, top: center }]} />
        <View pointerEvents="none" style={[styles.crossV, { backgroundColor: border, left: center }]} />
        {animate ? (
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', width: size, height: size, zIndex: 2 }, sweepStyle]}>
            <View shouldRasterizeIOS renderToHardwareTextureAndroid>
              <SweepArm size={size} center={center} tint={tint} />
            </View>
          </Animated.View>
        ) : null}
        <View style={[styles.center, { backgroundColor: tint, opacity: invisible ? 0.55 : 1 }]}>
          <RadarSelf name={selfName} color={selfColor} userId={selfUserId} />
        </View>
        {nodes.map((node) => {
          const peer = byToken.get(node.token);
          if (!peer) return null;
          return (
            <RadarDot
              key={node.token}
              node={node}
              color={tint}
              userId={peer.userId}
              onPress={() => onPressPeer(peer)}
              sweepDeg={sweepDeg}
              animate={animate}
            />
          );
        })}
      </View>
      {eventActive && eventRemainingLabel ? (
        <View pointerEvents="none" style={styles.eventBadge}>
          {eventName ? (
            <Text style={[styles.eventBadgeText, { color: tint }]}>{eventName}</Text>
          ) : null}
          <Text style={[styles.eventBadgeText, { color: tint }]}>{eventRemainingLabel} left</Text>
        </View>
      ) : null}
      {peers.length === 0 ? (
        <View pointerEvents="none" style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>{emptyCopy}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', marginVertical: 8 },
  disc: {
    backgroundColor: '#070B12',
    borderWidth: 1,
    overflow: 'hidden',
  },
  crossH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, opacity: 0.5 },
  crossV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, opacity: 0.5 },
  center: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    left: '50%',
    top: '50%',
    marginLeft: -16,
    marginTop: -16,
    zIndex: 4,
  },
  nodeLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '700',
    color: '#E5E7EB',
    maxWidth: 64,
    textAlign: 'center',
  },
  emptyOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 18,
  },
  emptyText: {
    color: '#9CA3AF',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  eventBadge: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(7,11,18,0.78)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
  },
  eventBadgeText: { fontSize: 12, fontWeight: '800' },
});
