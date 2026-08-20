import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileAvatar } from '@/components/ProfileAvatar';

export type SheetAction = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

type ActionSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  subtitle?: string;
  message?: string;
  avatarInitials?: string;
  avatarColor?: string;
  avatarUserId?: string | null;
  actions: SheetAction[];
};

export function ActionSheet({
  visible,
  onDismiss,
  title,
  subtitle,
  message,
  avatarInitials,
  avatarColor = '#14B8A6',
  avatarUserId,
  actions,
}: ActionSheetProps) {
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(320)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 260 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 320, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [opacity, slideY, visible]);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Dismiss" />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + 12, transform: [{ translateY: slideY }] },
        ]}
        pointerEvents="box-none">
        <View style={styles.handle} />
        <View style={styles.header}>
          <ProfileAvatar
            userId={avatarUserId}
            username={title}
            color={avatarColor}
            size={48}
          />
          <View style={styles.headerText}>
            <Text style={styles.headerName}>{title}</Text>
            {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
            {message ? <Text style={styles.headerMessage}>{message}</Text> : null}
          </View>
        </View>
        <View style={styles.divider} />
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={() => {
              onDismiss();
              setTimeout(action.onPress, 120);
            }}
            style={({ pressed }) => [styles.actionRow, pressed && styles.actionPressed]}>
            <Text style={[styles.actionLabel, action.destructive && styles.destructive]}>{action.label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={onDismiss} style={styles.cancelRow}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#111827',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
    backgroundColor: '#374151',
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, gap: 14 },
  headerText: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: '700', color: '#F9FAFB' },
  headerSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  headerMessage: { fontSize: 13, color: '#D1D5DB', marginTop: 8, lineHeight: 19 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#1F2937', marginBottom: 6 },
  actionRow: { paddingHorizontal: 22, paddingVertical: 16 },
  actionPressed: { backgroundColor: '#1F2937' },
  actionLabel: { fontSize: 16, fontWeight: '600', color: '#F9FAFB' },
  destructive: { color: '#F87171' },
  cancelRow: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#1F2937',
  },
  cancelLabel: { fontSize: 15, fontWeight: '700', color: '#9CA3AF' },
});
