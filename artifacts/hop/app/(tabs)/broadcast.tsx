import React, { useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useColors } from '@/hooks/useColors';
import { Broadcast, useHop } from '@/context/HopContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function BroadcastCard({
  item,
  colors,
}: {
  item: Broadcast;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={[styles.cardAvatar, { backgroundColor: item.senderColor }]}>
        <Text style={styles.cardAvatarText}>{item.senderName[0].toUpperCase()}</Text>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardMeta}>
          <Text style={[styles.cardName, { color: colors.foreground }]}>{item.senderName}</Text>
          <Text style={[styles.cardTime, { color: colors.mutedForeground }]}>
            {formatTime(item.timestamp)}
          </Text>
        </View>
        <Text style={[styles.cardContent, { color: colors.foreground }]}>{item.content}</Text>
      </View>
    </View>
  );
}

export default function BroadcastScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { broadcasts, sendBroadcast, profile } = useHop();
  const [input, setInput] = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !profile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendBroadcast(trimmed);
    setInput('');
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={{ flex: 1, paddingTop: topPad }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Broadcast</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Visible to everyone nearby
          </Text>
        </View>

        <FlatList
          data={broadcasts}
          keyExtractor={b => b.id}
          renderItem={({ item }) => <BroadcastCard item={item} colors={colors} />}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="megaphone-outline" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No broadcasts yet
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Send the first message to people nearby
              </Text>
            </View>
          }
        />

        {/* Composer */}
        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: bottomPad + 56,
            },
          ]}
        >
          <TextInput
            style={[
              styles.composerInput,
              { color: colors.foreground, backgroundColor: colors.secondary },
            ]}
            placeholder="Broadcast nearby..."
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={setInput}
            maxLength={280}
            multiline
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable
            onPress={handleSend}
            disabled={!input.trim()}
            style={[
              styles.sendBtn,
              { backgroundColor: input.trim() ? colors.primary : colors.secondary },
            ]}
          >
            <Ionicons
              name="arrow-up"
              size={18}
              color={input.trim() ? colors.primaryForeground : colors.mutedForeground}
            />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  card: {
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
  },
  cardAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  cardAvatarText: { color: '#fff', fontWeight: 'bold' as const, fontSize: 15, fontFamily: 'Inter_700Bold' },
  cardBody: { flex: 1 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  cardName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  cardTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  cardContent: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  composerInput: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
    fontFamily: 'Inter_400Regular',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 14, textAlign: 'center', fontFamily: 'Inter_400Regular' },
});
