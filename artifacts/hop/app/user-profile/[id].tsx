import React, { useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useHop } from '@/context/HopContext';
import { Avatar } from '@/components/Avatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function UserProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { nearbyUsers, blockUser, reportUser } = useHop();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const user = nearbyUsers.find(u => u.id === id);

  const handleBlock = () => {
    Alert.alert(
      `Block @${user?.username}?`,
      'They won\'t be able to message you, and you won\'t see them on the radar.',
      [
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await blockUser(id!);
            router.back();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleReport = () => {
    reportUser(id!);
  };

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </Pressable>
        <View style={styles.notFound}>
          <Text style={[styles.notFoundText, { color: colors.mutedForeground }]}>User no longer nearby</Text>
        </View>
      </View>
    );
  }

  const signalBars = Math.ceil(user.signal / 25); // 1–4

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Nav bar */}
      <View style={[styles.nav, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>Profile</Text>
        <Pressable onPress={handleReport} hitSlop={12}>
          <Ionicons name="flag-outline" size={22} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Hero */}
      <View style={styles.hero}>
        <Avatar uri={user.avatarUri} color={user.color} username={user.username} size={88} borderColor={user.color} borderWidth={3} />
        <Text style={[styles.username, { color: colors.foreground }]}>@{user.username}</Text>

        {/* Signal strength */}
        <View style={[styles.signalRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.bars}>
            {[1, 2, 3, 4].map(b => (
              <View
                key={b}
                style={[
                  styles.bar,
                  { height: 8 + b * 4, backgroundColor: b <= signalBars ? colors.primary : colors.border },
                ]}
              />
            ))}
          </View>
          <Text style={[styles.signalText, { color: colors.foreground }]}>{user.signal}% signal</Text>
          <View style={[styles.nearbyPill, { backgroundColor: colors.primary + '22' }]}>
            <View style={[styles.nearbyDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.nearbyLabel, { color: colors.primary }]}>nearby</Text>
          </View>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.replace(`/chat/${user.id}`);
          }}
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="chatbubble" size={18} color={colors.primaryForeground} />
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Message</Text>
        </Pressable>

        <Pressable
          onPress={handleBlock}
          style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Ionicons name="ban-outline" size={18} color={colors.destructive} />
          <Text style={[styles.secondaryBtnText, { color: colors.destructive }]}>Block</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  backBtn: { padding: 2 },
  hero: { alignItems: 'center', paddingTop: 40, paddingBottom: 28, gap: 12 },
  username: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { width: 5, borderRadius: 2 },
  signalText: { fontSize: 14, fontFamily: 'Inter_500Medium', flex: 1 },
  nearbyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  nearbyDot: { width: 6, height: 6, borderRadius: 3 },
  nearbyLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  actions: { paddingHorizontal: 24, gap: 12 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    paddingVertical: 16,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  notFound: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  notFoundText: { fontSize: 15, fontFamily: 'Inter_400Regular' },
});
