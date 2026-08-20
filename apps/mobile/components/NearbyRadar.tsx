import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import type { AroundUsPeer, NearbyOperatingMode } from '@/src/nearby/types';
import { layoutRadarNodes, type RadarNode } from '@/src/nearby/radarLayout';
import { radarShouldAnimate } from '@/src/nearby/scanState';
import {
  CONCENTRIC_RING_RATIOS,
  RING_CYCLE_MS,
  SWEEP_DURATION_MS,
  TRAIL_STEP_DEG,
  TRAIL_STEPS,
  advanceRingProgress,
  advanceSweepDeg,
  beamGlow,
  ringBreathe,
  ringPassGlow,
  sweepDurationMs,
  trailHeight,
  trailOpacity,
} from '@/src/nearby/radarSweep';
import { useProfilePhoto } from '@/src/profile/useProfilePhoto';
import { Avatar } from '@/components/Avatar';

const NODE_SIZE = 36;
const TRAIL_INDICES = Array.from({ length: TRAIL_STEPS }, (_, i) => i + 1);
const RING_COUNT = CONCENTRIC_RING_RATIOS.length;

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
  ringIndex,
  animating,
  ringProgress,
}: {
  size: number;
  ratio: number;
  center: number;
  tint: string;
  eventActive: boolean;
  invisible: boolean;
  ringIndex: number;
  animating: SharedValue<number>;
  ringProgress: SharedValue<number>;
}) {
  const dim = size * ratio;
  const baseOpacity = invisible ? 0.18 : eventActive ? 0.5 : 0.35;
  const style = useAnimatedStyle(() => {
    if (animating.value !== 1) {
      return { opacity: baseOpacity, transform: [{ scale: 1 }] };
    }
    const breathe = ringBreathe(ringProgress.value, ringIndex, RING_COUNT);
    const pass = ringPassGlow(ringProgress.value, ringIndex, RING_COUNT);
    return {
      opacity: Math.min(1, baseOpacity + breathe.opacityBoost + pass),
      transform: [{ scale: breathe.scale }],
    };
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
    <View pointerEvents="none" collapsable={false} style={{ width: size, height: size }}>
      {TRAIL_INDICES.map((step) => {
        const height = trailHeight(step);
        return (
          <View
            key={step}
            pointerEvents="none"
            collapsable={false}
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
          top: center - 1.25,
          width: center,
          height: 2.5,
          backgroundColor: tint,
          opacity: 0.95,
          shadowColor: tint,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.95,
          shadowRadius: 10,
        }}
      />
      {CONCENTRIC_RING_RATIOS.map((ratio) => (
        <View
          key={ratio}
          style={{
            position: 'absolute',
            left: center + center * ratio - 5,
            top: center - 5,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: tint,
            opacity: 0.72,
            shadowColor: tint,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.95,
            shadowRadius: 8,
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
  animating,
}: {
  node: RadarNode;
  color: string;
  userId?: string;
  onPress: () => void;
  sweepDeg: SharedValue<number>;
  animating: SharedValue<number>;
}) {
  const { uri } = useProfilePhoto(userId);
  const nodeDeg = (node.angle * 180) / Math.PI;
  const haloStyle = useAnimatedStyle(() => {
    const glow = animating.value === 1 ? beamGlow(sweepDeg.value, nodeDeg) : 0;
    return {
      opacity: glow * 0.9,
      transform: [{ scale: 0.8 + glow * 0.55 }],
    };
  });
  const avatarStyle = useAnimatedStyle(() => {
    const glow = animating.value === 1 ? beamGlow(sweepDeg.value, nodeDeg) : 0;
    return {
      transform: [{ scale: 1 + glow * 0.14 }],
      opacity: 0.88 + glow * 0.12,
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
  const ringProgress = useSharedValue(0);
  const animating = useSharedValue(0);
  const durationMs = useSharedValue(SWEEP_DURATION_MS);
  const nodes = layoutRadarNodes(peers, size);
  const byToken = new Map(peers.map((peer) => [peer.token, peer]));
  const center = size / 2;
  const invisible = operatingMode === 'invisible';
  const eventActive = operatingMode === 'event';
  const animate = radarShouldAnimate({ scanning, reduceMotion, invisible, tabFocused, appActive });
  const discOpacity = invisible ? 0.42 : 1;
  const sweepMs = sweepDurationMs(eventActive);

  const sweepFrame = useFrameCallback((info) => {
    'worklet';
    if (animating.value !== 1) return;
    const dt = info.timeSincePreviousFrame;
    if (dt == null || dt > 80) return;
    sweepDeg.value = advanceSweepDeg(sweepDeg.value, dt, durationMs.value);
    ringProgress.value = advanceRingProgress(ringProgress.value, dt, RING_CYCLE_MS);
  }, false);

  useEffect(() => {
    durationMs.value = sweepMs;
    animating.value = animate ? 1 : 0;
    sweepFrame.setActive(animate);
  }, [animate, animating, durationMs, sweepFrame, sweepMs]);

  const sweepStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: size,
    height: size,
    zIndex: 2,
    opacity: animating.value,
    // Applied on this view (not a zero-size child). Frame updates set the
    // current angle; we never interpolate rotate 0deg→360deg as one pair.
    transform: [{ rotate: sweepDeg.value + 'deg' }],
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
        {CONCENTRIC_RING_RATIOS.map((ratio, ringIndex) => (
          <RadarRing
            key={ratio}
            size={size}
            ratio={ratio}
            center={center}
            tint={tint}
            eventActive={eventActive}
            invisible={invisible}
            ringIndex={ringIndex}
            animating={animating}
            ringProgress={ringProgress}
          />
        ))}
        <View pointerEvents="none" style={[styles.crossH, { backgroundColor: border, top: center }]} />
        <View pointerEvents="none" style={[styles.crossV, { backgroundColor: border, left: center }]} />
        <Animated.View
          pointerEvents="none"
          collapsable={false}
          shouldRasterizeIOS
          renderToHardwareTextureAndroid
          style={sweepStyle}>
          <SweepArm size={size} center={center} tint={tint} />
        </Animated.View>
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
              animating={animating}
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
