/**
 * Reusable slide-up action sheet.
 * Shows a user header (avatar + name + subtitle) and a list of actions.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/Avatar';

export interface SheetAction {
  label: string;
  icon: string;
  onPress: () => void;
  destructive?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  onDismiss: () => void;
  user: { username: string; color: string; avatarUri?: string; subtitle?: string };
  actions: SheetAction[];
}

export function ActionSheet({ visible, onDismiss, user, actions }: ActionSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(300)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 260 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 300, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 12,
            transform: [{ translateY: slideY }],
          },
        ]}
        pointerEvents="box-none"
      >
        {/* Handle */}
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        {/* User header */}
        <View style={styles.header}>
          <Avatar uri={user.avatarUri} color={user.color} username={user.username} size={48} />
          <View style={styles.headerText}>
            <Text style={[styles.headerName, { color: colors.foreground }]}>@{user.username}</Text>
            {user.subtitle ? (
              <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>{user.subtitle}</Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Actions */}
        {actions.map((action, i) => (
          <Pressable
            key={i}
            onPress={() => { onDismiss(); setTimeout(action.onPress, 120); }}
            style={({ pressed }) => [
              styles.actionRow,
              { backgroundColor: pressed ? colors.secondary : 'transparent' },
            ]}
          >
            <Ionicons
              name={action.icon as any}
              size={21}
              color={action.destructive ? colors.destructive : colors.foreground}
            />
            <Text
              style={[
                styles.actionLabel,
                { color: action.destructive ? colors.destructive : colors.foreground },
              ]}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}

        {/* Cancel */}
        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.cancelRow,
            { backgroundColor: pressed ? colors.secondary : colors.secondary + 'AA' },
          ]}
        >
          <Text style={[styles.cancelLabel, { color: colors.mutedForeground }]}>Cancel</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 16,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, gap: 14 },
  headerText: { flex: 1 },
  headerName: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginBottom: 6 },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 16, gap: 16 },
  actionLabel: { fontSize: 16, fontFamily: 'Inter_500Medium' },
  cancelRow: { marginHorizontal: 16, marginTop: 8, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
