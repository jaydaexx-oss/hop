import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import {
  conversationPresenceLabel,
  formatInboxTimestamp,
  formatMessageStatus,
  formatUnreadBadge,
  type ConversationRoute,
} from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import { ProfileAvatar } from '@/components/ProfileAvatar';

export type ConversationRowProps = {
  name: string;
  preview: string;
  timestamp: string;
  unread: number;
  route: ConversationRoute;
  lastOutboundStatus?: string | null;
  lastFromSelf?: boolean;
  isMuted?: boolean;
  tint: string;
  muted: string;
  card: string;
  textColor: string;
  onPress: () => void;
  onLongPress?: () => void;
  peerId?: string;
  hasAvatar?: boolean;
};

function ConversationRowInner({
  name,
  preview,
  timestamp,
  unread,
  route,
  lastOutboundStatus,
  lastFromSelf,
  isMuted,
  tint,
  muted,
  card,
  textColor,
  onPress,
  onLongPress,
  peerId,
  hasAvatar,
}: ConversationRowProps) {
  const presence = conversationPresenceLabel(route);
  const nearbyOrOnline = route === 'nearby' || route === 'online';
  const badge = formatUnreadBadge(unread);
  const outboundLabel =
    lastFromSelf && lastOutboundStatus && unread === 0 ? formatMessageStatus(lastOutboundStatus) : null;
  const accessibilityLabel = [
    name,
    presence,
    preview,
    timestamp,
    badge ? `${unread} unread` : null,
    isMuted ? 'muted' : null,
    outboundLabel,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, { backgroundColor: card }]}>
      <View style={styles.avatarWrap}>
        <ProfileAvatar userId={peerId} username={name} color={tint} size={48} hasAvatar={hasAvatar} />
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[
            styles.presence,
            { backgroundColor: nearbyOrOnline ? tint : muted, borderColor: card },
          ]}
        />
      </View>
      <View style={styles.meta}>
        <View style={styles.topLine}>
          <Text style={[styles.name, { color: textColor }]} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.topRight}>
            {isMuted ? (
              <Text accessibilityLabel="Muted" style={[styles.muteIcon, { color: muted }]}>
                🔕
              </Text>
            ) : null}
            <Text style={[styles.time, { color: muted }]}>{timestamp}</Text>
          </View>
        </View>
        <View style={styles.bottomLine}>
          <Text style={[styles.preview, { color: muted }]} numberOfLines={1}>
            {outboundLabel ? `${outboundLabel} · ${preview}` : preview}
          </Text>
          {badge ? (
            <View style={[styles.unread, { backgroundColor: tint }]}>
              <Text style={styles.unreadLabel}>{badge}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export const ConversationRow = memo(ConversationRowInner);

export function inboxTimestamp(iso: string, now?: Date): string {
  return formatInboxTimestamp(iso, now);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginBottom: 10,
    minHeight: 72,
  },
  avatarWrap: { width: 48, height: 48, backgroundColor: 'transparent' },
  presence: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  meta: { flex: 1, backgroundColor: 'transparent', gap: 4 },
  topLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: 'transparent',
  },
  name: { fontSize: 17, fontWeight: '700', flex: 1 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'transparent' },
  muteIcon: { fontSize: 12 },
  time: { fontSize: 12, fontWeight: '600' },
  bottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  preview: { flex: 1, fontSize: 14 },
  unread: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadLabel: { color: '#042f2e', fontWeight: '800', fontSize: 12 },
});
