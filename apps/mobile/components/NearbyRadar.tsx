import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AroundUsPeer, NearbyOperatingMode } from '@/src/nearby/types';
import { layoutRadarNodes, type RadarNode } from '@/src/nearby/radarLayout';
import { radarShouldAnimate } from '@/src/nearby/scanState';
import { useProfilePhoto } from '@/src/profile/useProfilePhoto';
import { Avatar } from '@/components/Avatar';

const NODE_SIZE = 36;

function PulseRing({
  delay,
  size,
  color,
}: {
  delay: number;
  size: number;
  color: string;
}) {
  const scale = useRef(new Animated.Value(0.12)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const run = () => {
      scale.setValue(0.12);
      opacity.setValue(0.55);
      Animated.parallel([
        Animated.timing(scale, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) run();
      });
    };
    const t = setTimeout(run, delay);
    return () => {
      clearTimeout(t);
      scale.stopAnimation();
      opacity.stopAnimation();
    };
  }, [delay, opacity, scale]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
          transform: [{ scale }],
          opacity,
        },
      ]}
    />
  );
}

function RadarSelf({ name, color, userId }: { name: string; color: string; userId?: string | null }) {
  const { uri } = useProfilePhoto(userId);
  return <Avatar username={name} color={color} size={28} uri={uri} />;
}

function RadarDot({
  node,
  color,
  userId,
  onPress,
}: {
  node: RadarNode;
  color: string;
  userId?: string;
  onPress: () => void;
}) {
  const { uri } = useProfilePhoto(userId);
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
      <Avatar username={node.displayName} color={color} size={NODE_SIZE} uri={uri} borderColor={color} borderWidth={2} />
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
  const rotation = useRef(new Animated.Value(0)).current;
  const nodes = layoutRadarNodes(peers, size);
  const byToken = new Map(peers.map((peer) => [peer.token, peer]));
  const center = size / 2;
  const invisible = operatingMode === 'invisible';
  const eventActive = operatingMode === 'event';
  const animate = radarShouldAnimate({ scanning, reduceMotion, invisible });
  const discOpacity = invisible ? 0.42 : 1;

  useEffect(() => {
    if (!animate) {
      rotation.stopAnimation();
      rotation.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(rotation, { toValue: 1, duration: eventActive ? 2200 : 3200, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, eventActive, rotation]);

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const sweepDuration = eventActive ? 1800 : 2600;

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
        {[0.33, 0.66, 1].map((ratio) => (
          <View
            key={ratio}
            style={{
              position: 'absolute',
              width: size * ratio,
              height: size * ratio,
              borderRadius: (size * ratio) / 2,
              borderWidth: eventActive ? 1 : 0.6,
              borderColor: tint,
              opacity: invisible ? 0.18 : eventActive ? 0.5 : 0.35,
              left: center - (size * ratio) / 2,
              top: center - (size * ratio) / 2,
            }}
          />
        ))}
        <View pointerEvents="none" style={[styles.crossH, { backgroundColor: border, top: center }]} />
        <View pointerEvents="none" style={[styles.crossV, { backgroundColor: border, left: center }]} />
        {animate ? (
          <>
            <PulseRing delay={0} size={size} color={tint} />
            <PulseRing delay={Math.round(sweepDuration / 3)} size={size} color={tint} />
            <PulseRing delay={Math.round((sweepDuration * 2) / 3)} size={size} color={tint} />
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: size,
                height: size,
                transform: [{ rotate: spin }],
              }}>
              <View
                style={{
                  position: 'absolute',
                  left: center,
                  top: center - 1,
                  width: center,
                  height: eventActive ? 3 : 2,
                  backgroundColor: tint,
                  opacity: 0.85,
                }}
              />
            </Animated.View>
          </>
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
