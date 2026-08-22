import { useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import {
  formatBroadcastTime,
  isOwnBroadcast,
  planBroadcastReply,
  type NearbyBroadcast,
} from '@hop/protocol';

import { ActionSheet } from '@/components/ActionSheet';
import { Avatar } from '@/components/Avatar';
import { ComposerKeyboardScreen } from '@/components/ComposerKeyboardScreen';
import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBroadcast } from '@/src/broadcast/BroadcastProvider';
import { broadcastReplyRoute, replyToBroadcast } from '@/src/broadcast/replyToBroadcast';
import { useOffline } from '@/src/offline/OfflineProvider';
import { defaultLocalAvatarColor } from '@/src/profile/avatarAppearance';
import { dismissKeyboardOnOutsideTap, keyboardDismissScrollProps } from '@/src/ui/keyboardDismiss';

function BroadcastCard({
  item,
  isOwn,
  colors,
  onReply,
  onMenu,
}: {
  item: NearbyBroadcast;
  isOwn: boolean;
  colors: (typeof Colors)['light'];
  onReply: () => void;
  onMenu: () => void;
}) {
  return (
    <Pressable
      onPress={isOwn ? undefined : onReply}
      disabled={isOwn}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, opacity: !isOwn && pressed ? 0.82 : 1 },
      ]}>
      <Avatar color={defaultLocalAvatarColor(item.authorId)} username={item.displayName} size={38} />
      <View style={styles.cardBody}>
        <View style={styles.cardMeta}>
          <View style={styles.cardNameRow}>
            <Text style={styles.cardName}>{item.displayName}</Text>
            {isOwn ? (
              <View style={[styles.ownBadge, { backgroundColor: `${colors.tint}22` }]}>
                <Text style={[styles.ownBadgeText, { color: colors.tint }]}>you</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.cardMetaRight}>
            <Text style={[styles.cardTime, { color: colors.muted }]}>{formatBroadcastTime(item.createdAt)}</Text>
            {isOwn ? (
              <Pressable
                onPress={onMenu}
                hitSlop={10}
                accessibilityLabel="Broadcast options"
                accessibilityRole="button">
                <Text style={[styles.menuDots, { color: colors.muted }]}>•••</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Text style={styles.cardContent}>{item.body}</Text>
        {!isOwn ? (
          <View style={styles.replyHint}>
            <SymbolView
              name={{ ios: 'arrow.uturn.left', android: 'undo', web: 'undo' }}
              tintColor={colors.tint}
              size={12}
            />
            <Text style={[styles.replyHintText, { color: colors.tint }]}>Tap to reply</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function BroadcastScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const router = useRouter();
  const { user, token } = useAuth();
  const { posts, sendBroadcast, deleteBroadcast, sending, error, blockedIds } = useBroadcast();
  const { cacheConversation, listCachedConversations, safety } = useOffline();
  const [input, setInput] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [menuPost, setMenuPost] = useState<NearbyBroadcast | null>(null);

  function confirmDelete(post: NearbyBroadcast) {
    Alert.alert('Delete this broadcast?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteBroadcast(post.id) },
    ]);
  }

  async function handleReply(item: NearbyBroadcast) {
    if (!user) return;
    const plan = planBroadcastReply(item, { selfId: user.id, blockedIds });
    if (plan.action !== 'open_private_chat') return;
    setReplyError(null);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const thread = await replyToBroadcast({
        post: item,
        selfId: user.id,
        blockedIds,
        token,
        cache: { listCached: listCachedConversations, cache: cacheConversation },
        safety,
      });
      router.push(broadcastReplyRoute(thread.conversation, thread.broadcastId));
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Could not open private chat');
    }
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await sendBroadcast(trimmed);
    setInput('');
  }

  return (
    <ComposerKeyboardScreen
      tabBarOwnsSafeArea
      style={{ backgroundColor: colors.background }}
      renderComposer={(paddingBottom) => (
        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom,
            },
          ]}>
          <TextInput
            style={[styles.composerInput, { color: colors.text, backgroundColor: colors.background }]}
            placeholder="Broadcast nearby…"
            placeholderTextColor={colors.muted}
            value={input}
            onChangeText={setInput}
            maxLength={280}
            multiline
            returnKeyType="send"
            onSubmitEditing={() => void handleSend()}
          />
          <Pressable
            onPress={() => void handleSend()}
            disabled={!input.trim() || sending}
            style={[
              styles.sendBtn,
              { backgroundColor: input.trim() ? colors.tint : colors.border, opacity: sending ? 0.6 : 1 },
            ]}>
            <SymbolView
              name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
              tintColor={input.trim() ? '#FFFFFF' : colors.muted}
              size={18}
            />
          </Pressable>
        </View>
      )}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <Pressable onPress={() => dismissKeyboardOnOutsideTap(Keyboard.dismiss)} accessible={false}>
          <StatusBanner />
        </Pressable>
        <Pressable
          onPress={() => dismissKeyboardOnOutsideTap(Keyboard.dismiss)}
          accessible={false}
          style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={styles.title}>Broadcast</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>Visible to everyone nearby</Text>
        </Pressable>
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BroadcastCard
              item={item}
              isOwn={isOwnBroadcast(item, user?.id)}
              colors={colors}
              onReply={() => void handleReply(item)}
              onMenu={() => setMenuPost(item)}
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          {...keyboardDismissScrollProps}
          ListEmptyComponent={
            <Pressable
              onPress={() => dismissKeyboardOnOutsideTap(Keyboard.dismiss)}
              accessible={false}
              style={styles.empty}>
              <SymbolView
                name={{ ios: 'megaphone', android: 'campaign', web: 'campaign' }}
                tintColor={colors.muted}
                size={48}
              />
              <Text style={styles.emptyTitle}>No broadcasts yet</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>Send the first message to people nearby</Text>
            </Pressable>
          }
        />
        {error || replyError ? (
          <Pressable onPress={() => dismissKeyboardOnOutsideTap(Keyboard.dismiss)} accessible={false}>
            <Text style={[styles.error, { color: colors.destructive }]}>{replyError || error}</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
      <ActionSheet
        visible={menuPost != null && isOwnBroadcast(menuPost, user?.id)}
        onDismiss={() => setMenuPost(null)}
        title="Broadcast"
        message={menuPost?.body}
        avatarInitials={menuPost?.displayName?.slice(0, 2).toUpperCase() ?? 'YO'}
        avatarUserId={menuPost?.authorId}
        avatarColor={colors.tint}
        actions={[
          {
            label: 'Delete broadcast',
            destructive: true,
            onPress: () => {
              if (menuPost && isOwnBroadcast(menuPost, user?.id)) confirmDelete(menuPost);
            },
          },
        ]}
      />
    </ComposerKeyboardScreen>
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
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2 },
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, flexGrow: 1 },
  card: {
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
  },
  cardBody: { flex: 1, backgroundColor: 'transparent' },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 5,
    backgroundColor: 'transparent',
  },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, backgroundColor: 'transparent' },
  cardName: { fontSize: 13, fontWeight: '600' },
  ownBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  ownBadgeText: { fontSize: 10, fontWeight: '600' },
  cardMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  cardTime: { fontSize: 11 },
  menuDots: { fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  cardContent: { fontSize: 14, lineHeight: 21 },
  replyHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7, backgroundColor: 'transparent' },
  replyHintText: { fontSize: 11, fontWeight: '500' },
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
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  emptyText: { fontSize: 14, textAlign: 'center' },
  error: { paddingHorizontal: 16, paddingBottom: 8, fontSize: 13 },
});
