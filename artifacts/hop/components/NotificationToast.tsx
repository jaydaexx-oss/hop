/**
 * NotificationToast — slides in from the top when a new inbound message
 * arrives in a conversation the user is NOT currently viewing.
 *
 * Tap to navigate directly to the chat. Auto-dismisses after 3 s.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { useHop } from '@/context/HopContext';
import { Avatar } from '@/components/Avatar';

const TOAST_DURATION_MS = 3000;
const SLIDE_DURATION_MS = 280;

export function NotificationToast() {
  const { pendingToast, dismissToast, clearHistory } = useHop();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Animated value: 0 = fully hidden above screen, 1 = fully visible
  const slideAnim = useRef(new Animated.Value(0)).current;
  // Track the dismiss timeout so we can clear it on early tap
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine whether the user is already inside the target chat
  const isInsideTarget = (() => {
    if (!pendingToast) return false;
    if (pendingToast.kind === 'error') return false;
    if (pendingToast.kind === 'dm') {
      return pathname === `/chat/${pendingToast.targetId}`;
    }
    return pathname === `/group/${pendingToast.targetId}`;
  })();

  // If the queue head targets the conversation the user is already inside,
  // skip it immediately so the rest of the queue isn't blocked.
  // Also handles route changes that happen while a toast is animating.
  useEffect(() => {
    if (!pendingToast || !isInsideTarget) return;
    // Cancel any in-flight dismiss timer and reset the animation position
    // so the next toast can slide in cleanly.
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    slideAnim.stopAnimation();
    slideAnim.setValue(0);
    dismissToast();
    // pathname is the dependency that makes isInsideTarget re-evaluate on navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingToast, pathname]);

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
    }).start(({ finished }) => {
      // Only dequeue when the animation ran to completion.
      // If stopAnimation() was called (e.g. by the route-aware skip effect),
      // finished === false and we let the skip effect handle dismissal.
      if (finished) dismissToast();
    });
  };

  const handlePress = () => {
    if (!pendingToast) return;
    slideOut();
    if (pendingToast.kind === 'error') return; // just dismiss — no navigation
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
        style={({ pressed }) => [
          styles.card,
          pendingToast.kind === 'error' && styles.cardError,
          pressed && styles.cardPressed,
        ]}
        android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
      >
        {pendingToast.kind === 'error' ? (
          <View style={styles.errorIconWrap}>
            <Text style={styles.errorIconText}>⚠️</Text>
          </View>
        ) : (
          <Avatar
            uri={pendingToast.senderAvatarUri}
            color={pendingToast.senderColor}
            username={pendingToast.senderName}
            size={42}
          />
        )}
        <Animated.View style={styles.textBlock}>
          <Text
            style={[styles.senderName, pendingToast.kind === 'error' && styles.senderNameError]}
            numberOfLines={1}
          >
            {pendingToast.kind === 'error' ? 'Storage Error' : pendingToast.senderName}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>
            {pendingToast.content}
          </Text>
        </Animated.View>
        {pendingToast.kind === 'error' && (
          <Pressable
            onPress={() => {
              clearHistory();
              slideOut();
            }}
            style={({ pressed }) => [
              styles.clearBtn,
              pressed && styles.clearBtnPressed,
            ]}
            hitSlop={8}
          >
            <Text style={styles.clearBtnText}>Clear history</Text>
          </Pressable>
        )}
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
  cardError: {
    borderWidth: 1,
    borderColor: 'rgba(255, 160, 60, 0.45)',
    backgroundColor: 'rgba(40, 28, 20, 0.97)',
  },
  cardPressed: {
    opacity: 0.85,
  },
  errorIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 160, 60, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorIconText: {
    fontSize: 22,
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
  senderNameError: {
    color: '#FFA03C',
  },
  preview: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  clearBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 160, 60, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 160, 60, 0.35)',
    marginLeft: 4,
  },
  clearBtnPressed: {
    backgroundColor: 'rgba(255, 160, 60, 0.32)',
  },
  clearBtnText: {
    color: '#FFA03C',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
});
