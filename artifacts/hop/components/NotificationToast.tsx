/**
 * NotificationToast — slides in from the top when a new inbound message
 * arrives in a conversation the user is NOT currently viewing.
 *
 * Tap to navigate directly to the chat. Auto-dismisses after 3 s.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { useHop } from '@/context/HopContext';
import { Avatar } from '@/components/Avatar';

const TOAST_DURATION_MS = 3000;
const SLIDE_DURATION_MS = 280;

export function NotificationToast() {
  const { pendingToast, dismissToast } = useHop();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Animated value: 0 = fully hidden above screen, 1 = fully visible
  const slideAnim = useRef(new Animated.Value(0)).current;
  // Track the dismiss timeout so we can clear it on early tap
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine whether the user is already inside the target chat
  const isInsideTarget = (() => {
    if (!pendingToast) return false;
    if (pendingToast.kind === 'dm') {
      return pathname === `/chat/${pendingToast.targetId}`;
    }
    return pathname === `/group/${pendingToast.targetId}`;
  })();

  // Animate in whenever a new toast arrives (and user isn't already there)
  useEffect(() => {
    if (!pendingToast || isInsideTarget) return;

    // Slide in
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: SLIDE_DURATION_MS,
      useNativeDriver: true,
    }).start();

    // Auto-dismiss after TOAST_DURATION_MS
    dismissTimerRef.current = setTimeout(() => {
      slideOut();
    }, TOAST_DURATION_MS);

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingToast]);

  const slideOut = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: SLIDE_DURATION_MS,
      useNativeDriver: true,
    }).start(() => dismissToast());
  };

  const handlePress = () => {
    if (!pendingToast) return;
    slideOut();
    const path =
      pendingToast.kind === 'dm'
        ? `/chat/${pendingToast.targetId}`
        : `/group/${pendingToast.targetId}`;
    router.push(path as any);
  };

  // Nothing to show
  if (!pendingToast || isInsideTarget) return null;

  // Slide translate: starts fully above the screen (negative), ends at 0
  const TOAST_HEIGHT = 80;
  const topOffset = insets.top + 12;
  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-(TOAST_HEIGHT + topOffset + 20), 0],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        { top: topOffset, transform: [{ translateY }] },
      ]}
    >
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
      >
        <Avatar
          uri={pendingToast.senderAvatarUri}
          color={pendingToast.senderColor}
          username={pendingToast.senderName}
          size={42}
        />
        <Animated.View style={styles.textBlock}>
          <Text style={styles.senderName} numberOfLines={1}>
            {pendingToast.senderName}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>
            {pendingToast.content}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(28, 28, 32, 0.96)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    // Shadow (iOS)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    // Elevation (Android)
    elevation: 8,
  },
  cardPressed: {
    opacity: 0.85,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  senderName: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  preview: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
});
