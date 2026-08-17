import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import {
  formatBubbleTimestamp,
  formatMessageStatus,
  formatMessageStatusDescription,
  isFailedMessageStatus,
} from '@hop/protocol';

import { Text, View } from '@/components/Themed';
import { VoiceMessageBubble } from '@/components/VoiceMessageBubble';
import type { ChatMessage } from '@/src/api/hop';

export type MessageBubbleProps = {
  item: ChatMessage;
  mine: boolean;
  tint: string;
  muted: string;
  card: string;
  textColor: string;
  onRetry?: (messageId: string) => void;
};

function MessageBubbleInner({ item, mine, tint, muted, card, textColor, onRetry }: MessageBubbleProps) {
  const failed = isFailedMessageStatus(item.status);
  const canRetry = item.status === 'FAILED' && Boolean(onRetry);
  const voice = item.kind === 'voice';
  const time = formatBubbleTimestamp(item.created_at);
  const statusLabel = mine ? formatMessageStatus(item.status, item.retry_attempts) : '';
  const statusDescription = mine ? formatMessageStatusDescription(item.status, item.retry_attempts) : '';
  const body = voice ? 'Voice message' : item.text?.trim() ? item.text : 'Encrypted message';
  const accessibilityLabel = [
    mine ? 'You sent' : 'Received',
    body,
    time,
    statusDescription,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View
      style={[styles.wrap, mine ? styles.mineWrap : styles.theirsWrap]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}>
      {voice ? (
        <VoiceMessageBubble
          messageId={item.message_id}
          audioB64={item.audio_b64}
          durationMs={item.duration_ms}
          mime={item.mime}
          isMe={mine}
          tint={tint}
          tintForeground="#042f2e"
          card={card}
          muted={muted}
        />
      ) : (
        <View style={[styles.bubble, { backgroundColor: mine ? tint : card }]}>
          <Text style={{ color: mine ? '#042f2e' : textColor }}>{body}</Text>
        </View>
      )}
      <View style={styles.meta}>
        {mine ? (
          <Text style={[styles.status, { color: failed ? '#DC2626' : muted }]}>
            {time ? `${statusLabel} · ${time}` : statusLabel}
          </Text>
        ) : (
          <Text style={[styles.status, { color: muted }]}>{time}</Text>
        )}
        {canRetry ? (
          <Pressable
            onPress={() => onRetry?.(item.message_id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry sending message"
            style={styles.retryHit}>
            <Text style={[styles.retry, { color: tint }]}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleInner, (prev, next) => {
  return (
    prev.item.message_id === next.item.message_id &&
    prev.item.status === next.item.status &&
    prev.item.text === next.item.text &&
    prev.item.retry_attempts === next.item.retry_attempts &&
    prev.item.kind === next.item.kind &&
    prev.mine === next.mine &&
    prev.tint === next.tint &&
    prev.muted === next.muted &&
    prev.card === next.card &&
    prev.textColor === next.textColor
  );
});

const styles = StyleSheet.create({
  wrap: { maxWidth: '80%', backgroundColor: 'transparent' },
  mineWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirsWrap: { alignSelf: 'flex-start' },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    marginTop: 2,
  },
  status: { fontSize: 11 },
  retry: { fontSize: 12, fontWeight: '700' },
  retryHit: { minHeight: 44, justifyContent: 'center' },
});
