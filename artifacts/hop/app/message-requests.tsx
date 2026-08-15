import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { MessageRequest, useHop } from '@/context/HopContext';
import { Avatar } from '@/components/Avatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function RequestRow({
  req,
  colors,
  onAccept,
  onDecline,
  onBlock,
  onReport,
}: {
  req: MessageRequest;
  colors: ReturnType<typeof useColors>;
  onAccept: () => void;
  onDecline: () => void;
  onBlock: () => void;
  onReport: () => void;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Sender row */}
      <View style={styles.senderRow}>
        <Avatar uri={req.fromUser.avatarUri} color={req.fromUser.color} username={req.fromUser.username} size={46} />
        <View style={styles.senderInfo}>
          <Text style={[styles.senderName, { color: colors.foreground }]}>@{req.fromUser.username}</Text>
          <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{formatTime(req.timestamp)}</Text>
        </View>
        <Pressable onPress={onReport} hitSlop={12} style={styles.flagBtn}>
          <Ionicons name="flag-outline" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Message preview */}
      <View style={[styles.previewBubble, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Text style={[styles.previewText, { color: colors.foreground }]}>{req.preview}</Text>
      </View>

      {/* Actions */}
      <View style={styles.btnRow}>
        <Pressable
          onPress={onAccept}
          style={[styles.acceptBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.acceptText, { color: colors.primaryForeground }]}>Message</Text>
        </Pressable>
        <Pressable
          onPress={onDecline}
          style={[styles.declineBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
        >
          <Text style={[styles.declineText, { color: colors.foreground }]}>Delete</Text>
        </Pressable>
        <Pressable
          onPress={onBlock}
          style={[styles.blockBtn, { borderColor: colors.destructive + '55' }]}
        >
          <Text style={[styles.blockText, { color: colors.destructive }]}>Block</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function MessageRequestsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { messageRequests, acceptRequest, declineRequest, blockUser, reportUser } = useHop();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleAccept = (req: MessageRequest) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    acceptRequest(req.id);
    router.replace(`/chat/${req.fromUser.id}`);
  };

  const handleDecline = (req: MessageRequest) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    declineRequest(req.id);
  };

  const handleBlock = (req: MessageRequest) => {
    Alert.alert(
      `Block @${req.fromUser.username}?`,
      'They won\'t be able to message you and won\'t appear on your radar.',
      [
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            blockUser(req.fromUser.id);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleReport = (req: MessageRequest) => {
    reportUser(req.fromUser.id);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.title, { color: colors.foreground }]}>Message Requests</Text>
          {messageRequests.length > 0 && (
            <Text style={[styles.count, { color: colors.mutedForeground }]}>
              {messageRequests.length} pending
            </Text>
          )}
        </View>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        data={messageRequests}
        keyExtractor={r => r.id}
        renderItem={({ item }) => (
          <RequestRow
            req={item}
            colors={colors}
            onAccept={() => handleAccept(item)}
            onDecline={() => handleDecline(item)}
            onBlock={() => handleBlock(item)}
            onReport={() => handleReport(item)}
          />
        )}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 20 }]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={52} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>All clear</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No pending message requests
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  title: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  count: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  list: { padding: 16, gap: 14 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  senderInfo: { flex: 1 },
  senderName: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  timestamp: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  flagBtn: { padding: 4 },
  previewBubble: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  previewText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  btnRow: { flexDirection: 'row', gap: 8 },
  acceptBtn: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  acceptText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  declineBtn: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  declineText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  blockBtn: { paddingHorizontal: 16, borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1 },
  blockText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' },
});
