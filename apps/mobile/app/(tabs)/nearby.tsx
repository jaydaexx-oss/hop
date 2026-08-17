import { useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  bluetoothStatusLabel,
  nearbyPeerPresence,
  nearbyPeerSheetActions,
  rssiSignalBars,
  type NearbySheetActionId,
} from '@hop/protocol';

import { ActionSheet, type SheetAction } from '@/components/ActionSheet';
import { NearbyRadar } from '@/components/NearbyRadar';
import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { chatRoute, openPeerThread } from '@/src/chat/openPeerThread';
import { SCAN_STATE_COPY } from '@/src/nearby/scanState';
import type { AroundUsPeer, NearbyPrivacyMode } from '@/src/nearby/types';
import { PRIVACY_LABELS, PROXIMITY_LABELS } from '@/src/nearby/types';
import { useNearbyPeers } from '@/src/nearby/useNearbyPeers';
import { useOffline } from '@/src/offline/OfflineProvider';
import { useLocalAvatarColor } from '@/src/profile/useLocalAvatarColor';
import { avatarInitialsFromName } from '@/components/Avatar';

const PRIVACY_ORDER: NearbyPrivacyMode[] = ['invisible', 'contacts', 'everyone'];
const RADAR_SIZE = Math.min(Dimensions.get('window').width * 0.88, 336);

function presenceLabel(peer: AroundUsPeer): string {
  const presence = nearbyPeerPresence({
    userId: peer.userId,
    sessionEstablished: peer.encrypted,
    connected: peer.connected,
  });
  if (presence === 'authenticated') return 'Online · encrypted';
  if (presence === 'connected') return 'Online';
  return 'Discovered';
}

function sheetLabel(id: NearbySheetActionId, peer: AroundUsPeer): string {
  if (id === 'view_profile') return 'View profile';
  if (id === 'message_request') return 'Message request';
  if (id === 'connect') return 'Connect';
  if (id === 'disconnect') return 'Disconnect';
  if (id === 'block') return `Block ${peer.displayName}`;
  return id;
}

export default function NearbyScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const router = useRouter();
  const { user, token } = useAuth();
  const { color: selfColor } = useLocalAvatarColor(user?.id);
  const { cacheConversation, listCachedConversations, safety } = useOffline();
  const {
    peers,
    scanState,
    privacyMode,
    setPrivacyMode,
    discoverable,
    setDiscoverable,
    eventMode,
    eventRemainingLabel,
    enableEventMode,
    disableEventMode,
    sessionActive,
    busy,
    error,
    nearbyCount,
    connectPeer,
    disconnectPeer,
    statusDetail,
  } = useNearbyPeers();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [sheetPeer, setSheetPeer] = useState<AroundUsPeer | null>(null);

  async function messagePeer(peer: AroundUsPeer) {
    if (!user || !peer.userId) return;
    setOpeningId(peer.token);
    setOpenError(null);
    try {
      if (!peer.connected) {
        await connectPeer(peer.deviceId);
      }
      const thread = await openPeerThread({
        token,
        myId: user.id,
        peerUserId: peer.userId,
        peerUsername: peer.displayName,
        peerPublicKey: peer.publicKey,
        cache: { listCached: listCachedConversations, cache: cacheConversation },
        safety,
      });
      router.push(chatRoute(thread.conversation));
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Could not open chat');
    } finally {
      setOpeningId(null);
    }
  }

  function openPeerProfile(peer: AroundUsPeer) {
    router.push(
      `/nearby-profile?userId=${encodeURIComponent(peer.userId ?? '')}&name=${encodeURIComponent(peer.displayName)}&proximity=${encodeURIComponent(PROXIMITY_LABELS[peer.proximity])}&publicKey=${encodeURIComponent(peer.publicKey ?? '')}`,
    );
  }

  async function blockPeer(peer: AroundUsPeer) {
    if (!peer.userId || !safety) return;
    await safety.block(peer.userId);
  }

  function runSheetAction(peer: AroundUsPeer, action: NearbySheetActionId) {
    if (action === 'view_profile') openPeerProfile(peer);
    else if (action === 'message_request') void messagePeer(peer);
    else if (action === 'connect') void connectPeer(peer.deviceId);
    else if (action === 'disconnect') void disconnectPeer();
    else if (action === 'block') void blockPeer(peer);
  }

  const sheetActions: SheetAction[] = sheetPeer
    ? nearbyPeerSheetActions({
        canMessage: sheetPeer.canMessage,
        connected: sheetPeer.connected,
        userId: sheetPeer.userId,
      }).map((id) => ({
        label: sheetLabel(id, sheetPeer),
        destructive: id === 'block',
        onPress: () => runSheetAction(sheetPeer, id),
      }))
    : [];

  async function toggleEventMode() {
    setEventError(null);
    try {
      if (eventMode.enabled) await disableEventMode();
      else await enableEventMode();
    } catch (err) {
      setEventError(err instanceof Error ? err.message : 'Could not update Event Mode');
    }
  }

  const emptyCopy = SCAN_STATE_COPY[scanState] || 'Nobody nearby right now.';
  const eventLocked = privacyMode === 'invisible';
  const scanning = scanState === 'searching' || scanState === 'peers_found';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <StatusBanner />
      <View style={styles.header}>
        <Text style={[styles.brand, { color: colors.tint }]}>HOP</Text>
        <Text style={[styles.scanBadge, { color: colors.muted }]}>
          {bluetoothStatusLabel(scanState)}
          {nearbyCount > 0 ? ` · ${nearbyCount}` : ''}
        </Text>
      </View>
      <Text style={styles.title}>Around Us</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Real people this phone can see over Bluetooth. Tap a dot for profile, connect, or a
        message request — never an automatic chat. Approximate proximity only.
      </Text>

      <NearbyRadar
        peers={peers}
        size={RADAR_SIZE}
        tint={colors.tint}
        border={colors.border}
        scanning={scanning}
        selfName={user?.username ?? 'You'}
        selfColor={selfColor}
        emptyCopy={emptyCopy}
        onPressPeer={(peer) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          setSheetPeer(peer);
        }}
      />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={styles.cardTitle}>Nearby visibility</Text>
        <Text style={{ color: colors.muted }}>
          Discoverable off is Invisible — you stop advertising and do not appear to new nearby
          users. Existing chats and internet messaging stay on. Event Mode cannot override it.
        </Text>
        <View style={styles.discoverRow}>
          <Text style={{ fontWeight: '700' }}>Discoverable</Text>
          <Switch
            value={discoverable}
            onValueChange={(on) => {
              void setDiscoverable(on);
            }}
            disabled={busy}
          />
        </View>
        <View style={styles.segment}>
          {PRIVACY_ORDER.map((mode) => {
            const active = privacyMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => setPrivacyMode(mode)}
                disabled={busy}
                style={[
                  styles.segmentItem,
                  {
                    backgroundColor: active ? colors.tint : 'transparent',
                    borderColor: colors.tint,
                  },
                ]}>
                <Text style={{ color: active ? '#042f2e' : colors.tint, fontWeight: '700', fontSize: 12 }}>
                  {PRIVACY_LABELS[mode]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={styles.cardTitle}>Event Mode</Text>
        {eventMode.enabled ? (
          <>
            <Text style={{ color: colors.tint, fontWeight: '700' }}>On · {eventRemainingLabel} left</Text>
            <Text style={{ color: colors.muted }}>
              {nearbyCount} HOP {nearbyCount === 1 ? 'user' : 'users'} nearby. Discovery is more active for
              this session only. Encryption is unchanged.
            </Text>
          </>
        ) : (
          <Text style={{ color: colors.muted }}>
            Optional 2-hour discovery boost for a gathering. Off until you turn it on. Expires
            automatically.
          </Text>
        )}
        {eventLocked ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Choose Contacts only or Everyone nearby before turning on Event Mode.
          </Text>
        ) : null}
        {eventError ? <Text style={styles.error}>{eventError}</Text> : null}
        <Pressable
          onPress={toggleEventMode}
          disabled={busy || (eventLocked && !eventMode.enabled)}
          style={[
            styles.button,
            {
              backgroundColor: eventMode.enabled ? 'transparent' : colors.tint,
              borderWidth: eventMode.enabled ? 1.5 : 0,
              borderColor: colors.tint,
              opacity: busy || (eventLocked && !eventMode.enabled) ? 0.45 : 1,
            },
          ]}>
          <Text style={{ color: eventMode.enabled ? colors.tint : '#042f2e', fontWeight: '700' }}>
            {eventMode.enabled ? 'Turn off Event Mode' : 'Turn on for 2 hours'}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={styles.cardTitle}>This phone</Text>
        <Text style={{ color: colors.muted }}>{bluetoothStatusLabel(scanState)}</Text>
        {privacyMode === 'invisible' ? (
          <Text style={{ color: colors.muted }}>Invisible — not advertising or scanning</Text>
        ) : (
          <Text style={{ color: colors.muted }}>
            {sessionActive
              ? eventMode.enabled
                ? 'Event Mode scanning'
                : 'Looking around'
              : 'Nearby is idle'}
          </Text>
        )}
        {statusDetail ? <Text style={{ color: colors.muted }}>{statusDetail}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {openError ? <Text style={styles.error}>{openError}</Text> : null}
      </View>

      <Text style={styles.section}>People around you</Text>
      {peers.length === 0 ? (
        <Text style={{ color: colors.muted, marginBottom: 16 }}>{emptyCopy}</Text>
      ) : (
        peers.map((peer) => {
          const busyPeer = busy || openingId === peer.token;
          return (
            <Pressable
              key={peer.token}
              onPress={() => setSheetPeer(peer)}
              style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.peerHeader}>
                <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
                  <Text style={styles.avatarText}>{peer.avatarInitials}</Text>
                </View>
                <View style={styles.peerMeta}>
                  <Text style={styles.peerName}>{peer.displayName}</Text>
                  <Text style={{ color: colors.muted }}>
                    {PROXIMITY_LABELS[peer.proximity]} · {presenceLabel(peer)}
                    {peer.encrypted ? ' · 🔒' : ''}
                    {peer.rssi != null ? ` · ${'•'.repeat(rssiSignalBars(peer.rssi))}` : ''}
                  </Text>
                </View>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {busyPeer ? 'Working…' : 'Tap for profile, connect, or a message request'}
              </Text>
            </Pressable>
          );
        })
      )}

      <Text style={styles.section}>Privacy</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Around Us shows a HOP name after a secure handshake, or “HOP user”. It never shows MAC
        addresses, phone numbers, email, GPS, or permanent device IDs. Physical two-phone BLE
        delivery is still pending verification.
      </Text>

      <ActionSheet
        visible={sheetPeer != null}
        onDismiss={() => setSheetPeer(null)}
        title={sheetPeer?.displayName ?? ''}
        subtitle={
          sheetPeer
            ? `${PROXIMITY_LABELS[sheetPeer.proximity]} · ${presenceLabel(sheetPeer)}`
            : undefined
        }
        avatarInitials={sheetPeer ? avatarInitialsFromName(sheetPeer.displayName) : '?'}
        avatarColor={colors.tint}
        actions={sheetActions}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    marginBottom: 4,
  },
  brand: { fontSize: 18, fontWeight: '800', letterSpacing: 1.4 },
  scanBadge: { fontSize: 12, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  lead: { fontSize: 15, lineHeight: 21, marginBottom: 16 },
  card: { borderRadius: 16, padding: 14, marginBottom: 12, gap: 6, backgroundColor: 'transparent' },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  discoverRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  section: { fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, backgroundColor: 'transparent' },
  segmentItem: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 8, paddingHorizontal: 10 },
  peerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'transparent',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#042f2e', fontWeight: '800', fontSize: 13 },
  peerMeta: { flex: 1, backgroundColor: 'transparent', gap: 2 },
  peerName: { fontSize: 18, fontWeight: '700' },
  button: { marginTop: 10, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  error: { color: '#DC2626' },
});
