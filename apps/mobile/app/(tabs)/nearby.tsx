import { useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet } from 'react-native';
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
import { NearbyModeSelector } from '@/components/NearbyModeSelector';
import { NearbyRadar } from '@/components/NearbyRadar';
import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';
import { useReduceMotion } from '@/components/useReduceMotion';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { chatRoute, openPeerThread } from '@/src/chat/openPeerThread';
import {
  CREATE_EVENT_ROUTE,
  EVENTS_LIST_ROUTE,
  planEventModeTap,
} from '@/src/nearby/eventModeEntry';
import { EVENT_BLOCKED_COPY, INVISIBLE_RADAR_COPY } from '@/src/nearby/nearbyPolicy';
import { SCAN_STATE_COPY } from '@/src/nearby/scanState';
import type { AroundUsPeer, NearbyAudience, NearbyOperatingMode } from '@/src/nearby/types';
import { AUDIENCE_LABELS, OPERATING_MODE_LABELS, PROXIMITY_LABELS } from '@/src/nearby/types';
import { useNearbyPeers } from '@/src/nearby/useNearbyPeers';
import { useOffline } from '@/src/offline/OfflineProvider';
import { useLocalAvatarColor } from '@/src/profile/useLocalAvatarColor';
import { avatarInitialsFromName } from '@/components/Avatar';
import { ProfileAvatar } from '@/components/ProfileAvatar';

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

function leadCopy(mode: NearbyOperatingMode, eventLive: boolean): string {
  if (mode === 'invisible') return INVISIBLE_RADAR_COPY;
  if (mode === 'event') {
    return eventLive
      ? 'Gathering discovery is on. Faster Bluetooth for this session only. Tap a person for profile, connect, or a message request — never an automatic chat.'
      : 'Event Mode radar. Create a gathering or select one to start discovery. Tap a person for profile, connect, or a message request — never an automatic chat.';
  }
  return 'Real people this phone can see over Bluetooth. Tap a dot for profile, connect, or a message request — never an automatic chat. Approximate proximity only.';
}

export default function NearbyScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { user, token } = useAuth();
  const { color: selfColor } = useLocalAvatarColor(user?.id);
  const { cacheConversation, listCachedConversations, safety } = useOffline();
  const {
    peers,
    scanState,
    operatingMode,
    setOperatingMode,
    audience,
    setAudience,
    eventMode,
    eventRemainingLabel,
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
  const [eventShell, setEventShell] = useState(false);
  const [modeSheet, setModeSheet] = useState<'event-blocked' | null>(null);

  const showEventRadar = operatingMode === 'event' || eventShell;
  const displayMode: NearbyOperatingMode = showEventRadar ? 'event' : operatingMode;
  const eventLive = eventMode.enabled;
  const radarTint = showEventRadar ? colors.event : colors.tint;
  const scanning =
    operatingMode !== 'invisible' && (scanState === 'searching' || scanState === 'peers_found');
  const emptyCopy =
    operatingMode === 'invisible' ? INVISIBLE_RADAR_COPY : SCAN_STATE_COPY[scanState] || 'Nobody nearby right now.';

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

  function onSelectMode(mode: NearbyOperatingMode) {
    setEventError(null);
    if (mode === 'event') {
      const plan = planEventModeTap({ operatingMode, eventEnabled: eventMode.enabled });
      if (plan.openBlockedSheet) {
        setModeSheet('event-blocked');
        return;
      }
      if (plan.showEventShell) setEventShell(true);
      return;
    }
    setEventShell(false);
    setModeSheet(null);
    void setOperatingMode(mode).catch((err) => {
      setEventError(err instanceof Error ? err.message : 'Could not update Nearby mode');
    });
  }

  async function chooseBlockedAudience(next: NearbyAudience) {
    setModeSheet(null);
    try {
      await setOperatingMode('around_us', { audience: next });
      setEventShell(true);
    } catch (err) {
      setEventError(err instanceof Error ? err.message : 'Could not update Nearby mode');
    }
  }

  const blockedActions: SheetAction[] = [
    { label: AUDIENCE_LABELS.contacts, onPress: () => void chooseBlockedAudience('contacts') },
    { label: AUDIENCE_LABELS.everyone, onPress: () => void chooseBlockedAudience('everyone') },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <StatusBanner />
      <View style={styles.header}>
        <Text style={[styles.brand, { color: colors.tint }]}>HOP</Text>
        <Text style={[styles.scanBadge, { color: displayMode === 'event' ? colors.event : colors.muted }]}>
          {displayMode === 'event'
            ? eventLive
              ? `${eventMode.name ? `${eventMode.name} · ` : 'Event Mode · '}${eventRemainingLabel}`
              : 'Event Mode'
            : bluetoothStatusLabel(scanState)}
          {nearbyCount > 0 ? ` · ${nearbyCount}` : ''}
        </Text>
      </View>
      <Text style={styles.title}>{OPERATING_MODE_LABELS[displayMode]}</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>{leadCopy(displayMode, eventLive)}</Text>

      <NearbyModeSelector
        operatingMode={displayMode}
        audience={audience}
        eventName={eventLive ? eventMode.name : undefined}
        eventRemainingLabel={eventRemainingLabel}
        eventLive={eventLive}
        tint={colors.tint}
        eventTint={colors.event}
        muted={colors.muted}
        border={colors.border}
        text={colors.text}
        busy={busy}
        onSelectMode={onSelectMode}
        onSelectAudience={(next) => {
          void setAudience(next);
        }}
        onCreateEvent={() => router.push(CREATE_EVENT_ROUTE)}
        onOpenEvents={() => router.push(EVENTS_LIST_ROUTE)}
        onEndEvent={() => {
          setEventShell(false);
          void setOperatingMode('around_us').catch((err) => {
            setEventError(err instanceof Error ? err.message : 'Could not end Event Mode');
          });
        }}
      />
      {eventError ? <Text style={styles.error}>{eventError}</Text> : null}

      <NearbyRadar
        peers={peers}
        size={RADAR_SIZE}
        tint={radarTint}
        border={colors.border}
        scanning={scanning}
        selfName={user?.username ?? 'You'}
        selfColor={selfColor}
        selfUserId={user?.id}
        emptyCopy={emptyCopy}
        operatingMode={displayMode}
        reduceMotion={reduceMotion}
        eventName={eventLive ? eventMode.name : undefined}
        eventRemainingLabel={eventLive ? eventRemainingLabel : undefined}
        onPressPeer={(peer) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          setSheetPeer(peer);
        }}
      />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={styles.cardTitle}>This phone</Text>
        <Text style={{ color: colors.muted }}>{bluetoothStatusLabel(scanState)}</Text>
        {operatingMode === 'invisible' ? (
          <Text style={{ color: colors.muted }}>Invisible — not advertising or scanning</Text>
        ) : (
          <Text style={{ color: colors.muted }}>
            {sessionActive
              ? eventLive
                ? `Event Mode scanning · ${eventMode.name ? `${eventMode.name} · ` : ''}${eventRemainingLabel} left`
                : showEventRadar
                  ? 'Event Mode radar'
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
                <ProfileAvatar
                  userId={peer.userId}
                  username={peer.displayName}
                  color={colors.tint}
                  size={40}
                />
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
        avatarUserId={sheetPeer?.userId}
        avatarColor={colors.tint}
        actions={sheetActions}
      />
      <ActionSheet
        visible={modeSheet === 'event-blocked'}
        onDismiss={() => setModeSheet(null)}
        title={EVENT_BLOCKED_COPY.title}
        message={EVENT_BLOCKED_COPY.body}
        avatarInitials="IN"
        avatarColor={colors.tint}
        actions={blockedActions}
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
  section: { fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  peerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'transparent',
  },
  peerMeta: { flex: 1, backgroundColor: 'transparent', gap: 2 },
  peerName: { fontSize: 18, fontWeight: '700' },
  error: { color: '#DC2626', marginBottom: 8 },
});
