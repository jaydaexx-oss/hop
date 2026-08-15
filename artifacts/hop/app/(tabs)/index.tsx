import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { HopUser, useHop } from '@/context/HopContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Redirect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
const RADAR_SIZE = Math.min(width * 0.88, 336);
const CENTER = RADAR_SIZE / 2;
const MAX_RADIUS = CENTER;

// --- PulseRing: concentric expanding ring animation ---
function PulseRing({
  delay,
  colors,
}: {
  delay: number;
  colors: ReturnType<typeof useColors>;
}) {
  const scale = useRef(new Animated.Value(0.1)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = () => {
      scale.setValue(0.1);
      opacity.setValue(0.65);
      Animated.parallel([
        Animated.timing(scale, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ]).start(() => animate());
    };
    const t = setTimeout(animate, delay);
    return () => clearTimeout(t);
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: RADAR_SIZE / 2,
          borderWidth: 1.5,
          borderColor: colors.primary,
          transform: [{ scale }],
          opacity,
        },
      ]}
    />
  );
}

// --- RadarNode: individual nearby user dot (own component so useAnimatedStyle is not inside map) ---
function RadarNode({
  user,
  onPress,
  colors,
}: {
  user: HopUser;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: 1000 }),
        withTiming(1, { duration: 1000 })
      ),
      -1,
      true
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Closer to center = stronger signal
  const distance = MAX_RADIUS * (1 - (user.signal / 100) * 0.72) - 26;
  const x = CENTER + Math.cos(user.angle) * distance;
  const y = CENTER + Math.sin(user.angle) * distance;
  const SIZE = 34;

  return (
    <Reanimated.View
      style={[
        {
          position: 'absolute',
          left: x - SIZE / 2,
          top: y - SIZE / 2,
          zIndex: 5,
        },
        animStyle,
      ]}
    >
      <Pressable onPress={onPress} style={styles.nodePress}>
        <View
          style={[
            styles.nodeAvatar,
            {
              width: SIZE,
              height: SIZE,
              borderRadius: SIZE / 2,
              backgroundColor: user.color,
              borderColor: colors.primary,
            },
          ]}
        >
          <Text style={styles.nodeInitial}>{user.username[0].toUpperCase()}</Text>
        </View>
        <Text
          style={[styles.nodeLabel, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {user.username}
        </Text>
      </Pressable>
    </Reanimated.View>
  );
}

export default function RadarScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { nearbyUsers, isScanning, profile, isOnboarding, loaded } = useHop();
  const scanRotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(scanRotation, {
        toValue: 1,
        duration: 3200,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const scanAngle = scanRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handleNodePress = useCallback(
    (user: HopUser) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push(`/chat/${user.id}`);
    },
    []
  );

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  // Redirect to onboarding once state is loaded
  if (loaded && isOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  if (!loaded) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.appName, { color: colors.primary }]}>HOP</Text>
        <View style={styles.scanBadge}>
          <Ionicons
            name="bluetooth"
            size={11}
            color={isScanning ? colors.primary : colors.mutedForeground}
          />
          <Text style={[styles.scanText, { color: colors.mutedForeground }]}>
            {isScanning ? `${nearbyUsers.length} nearby` : 'offline'}
          </Text>
        </View>
      </View>

      {/* Radar disc */}
      <View style={styles.radarWrapper}>
        <View
          style={[
            styles.radar,
            {
              width: RADAR_SIZE,
              height: RADAR_SIZE,
              borderRadius: RADAR_SIZE / 2,
              borderColor: colors.border,
            },
          ]}
        >
          {/* Static grid rings */}
          {[0.33, 0.66, 1].map(r => (
            <View
              key={r}
              style={{
                position: 'absolute',
                width: RADAR_SIZE * r,
                height: RADAR_SIZE * r,
                borderRadius: (RADAR_SIZE * r) / 2,
                borderWidth: 0.5,
                borderColor: colors.border,
                left: CENTER - (RADAR_SIZE * r) / 2,
                top: CENTER - (RADAR_SIZE * r) / 2,
              }}
            />
          ))}

          {/* Crosshair */}
          <View
            pointerEvents="none"
            style={[styles.crossH, { backgroundColor: colors.border }]}
          />
          <View
            pointerEvents="none"
            style={[styles.crossV, { backgroundColor: colors.border }]}
          />

          {/* Pulse rings */}
          <PulseRing delay={0} colors={colors} />
          <PulseRing delay={866} colors={colors} />
          <PulseRing delay={1732} colors={colors} />

          {/* Rotating scan line — full-size view rotates around its own center */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: RADAR_SIZE,
              height: RADAR_SIZE,
              transform: [{ rotate: scanAngle }],
            }}
          >
            <View
              style={{
                position: 'absolute',
                left: CENTER,
                top: CENTER - 1,
                width: CENTER,
                height: 2,
                backgroundColor: colors.primary,
                opacity: 0.85,
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: CENTER,
                top: CENTER - 1.5,
                width: CENTER,
                height: 3,
                backgroundColor: colors.primary,
                opacity: 0.15,
              }}
            />
          </Animated.View>

          {/* Center — my avatar */}
          <View style={[styles.center, { backgroundColor: colors.primary }]}>
            {profile && (
              <View style={[styles.centerInner, { backgroundColor: profile.color }]}>
                <Text style={styles.centerInitial}>
                  {profile.username[0].toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {/* Nearby user nodes */}
          {nearbyUsers.map(user => (
            <RadarNode
              key={user.id}
              user={user}
              onPress={() => handleNodePress(user)}
              colors={colors}
            />
          ))}
        </View>
      </View>

      {/* Footer hint */}
      <View
        style={[
          styles.footer,
          { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 62 },
        ]}
      >
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
          tap a dot to message
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    paddingTop: 14,
    paddingBottom: 4,
  },
  appName: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: 4 },
  scanBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  scanText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  radarWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  radar: { borderWidth: 1, overflow: 'hidden', position: 'relative' },
  crossH: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: CENTER - 0.25,
    height: 0.5,
  },
  crossV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: CENTER - 0.25,
    width: 0.5,
  },
  center: {
    position: 'absolute',
    left: CENTER - 22,
    top: CENTER - 22,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  centerInner: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerInitial: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  nodePress: { alignItems: 'center' },
  nodeAvatar: { justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  nodeInitial: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  nodeLabel: { fontSize: 9, marginTop: 2, fontFamily: 'Inter_500Medium' },
  footer: { alignItems: 'center', paddingTop: 6 },
  footerText: { fontSize: 11, fontFamily: 'Inter_400Regular', letterSpacing: 0.5 },
});
