import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { nearbyPeerPresence } from '@hop/protocol';

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

const PRIVACY_ORDER: NearbyPrivacyMode[] = ['invisible', 'contacts', 'everyone'];

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

export default function NearbyScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const router = useRouter();
  const { user, token } = useAuth();
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

  function openPeerActions(peer: AroundUsPeer) {
    Alert.alert(peer.displayName, `${PROXIMITY_LABELS[peer.proximity]} · ${presenceLabel(peer)}`, [
      {
        text: 'View profile',
        onPress: () =>
          router.push(
            `/nearby-profile?userId=${encodeURIComponent(peer.userId ?? '')}&name=${encodeURIComponent(peer.displayName)}&proximity=${encodeURIComponent(PROXIMITY_LABELS[peer.proximity])}&publicKey=${encodeURIComponent(peer.publicKey ?? '')}`,
          ),
      },
      {
        text: peer.canMessage ? 'Message request' : 'Connect first',
        onPress: () => {
          if (peer.canMessage) void messagePeer(peer);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function toggleEventMode() {
    setEventError(null);
    try {
      if (eventMode.enabled) await disableEventMode();
      else await enableEventMode();
    } catch (err) {
      setEventError(err instanceof Error ? err.message : 'Could not update Event Mode');
    }
  }

  const emptyCopy = SCAN_STATE_COPY[scanState];
  const eventLocked = privacyMode === 'invisible';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <StatusBanner />
      <Text style={styles.title}>Around Us</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        See HOP users near this phone over Bluetooth. Chat still picks Bluetooth or internet
        automatically. Approximate proximity only — never meters, GPS, or hardware IDs.
      </Text>

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
            {eventMode.sessionId ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Session ready for a future event code. Not a location.
              </Text>
            ) : null}
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
        <Text style={{ color: colors.muted }}>
          {privacyMode === 'invisible'
            ? 'Invisible — not advertising or scanning'
            : sessionActive
              ? eventMode.enabled
                ? 'Event Mode scanning'
                : 'Looking around'
              : 'Nearby is idle'}
        </Text>
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
            <View key={peer.token} style={[styles.card, { backgroundColor: colors.card }]}>
              <Pressable onPress={() => openPeerActions(peer)} style={styles.peerHeader}>
                <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
                  <Text style={styles.avatarText}>{peer.avatarInitials}</Text>
                </View>
                <View style={styles.peerMeta}>
                  <Text style={styles.peerName}>{peer.displayName}</Text>
                  <Text style={{ color: colors.muted }}>
                    {PROXIMITY_LABELS[peer.proximity]} · {presenceLabel(peer)}
                    {peer.encrypted ? ' · 🔒' : ''}
                  </Text>
                </View>
              </Pressable>
              <View style={styles.row}>
                {peer.connected ? (
                  <Pressable
                    onPress={() => disconnectPeer()}
                    disabled={busyPeer}
                    style={[styles.smallButton, { borderColor: colors.tint, borderWidth: 1.5 }]}>
                    <Text style={{ color: colors.tint, fontWeight: '700' }}>Disconnect</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => connectPeer(peer.deviceId)}
                    disabled={busyPeer}
                    style={[styles.smallButton, { borderColor: colors.tint, borderWidth: 1.5 }]}>
                    <Text style={{ color: colors.tint, fontWeight: '700' }}>Connect</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => openPeerActions(peer)}
                  disabled={busyPeer || !peer.canMessage}
                  style={[
                    styles.smallButton,
                    { backgroundColor: colors.tint, opacity: busyPeer || !peer.canMessage ? 0.45 : 1 },
                  ]}>
                  <Text style={styles.buttonLabel}>{openingId === peer.token ? 'Opening…' : 'Message'}</Text>
                </Pressable>
              </View>
              {!peer.canMessage ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Connect first to authenticate this HOP user.
                </Text>
              ) : null}
            </View>
          );
        })
      )}

      <Text style={styles.section}>Privacy</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Around Us shows a HOP name after a secure handshake, or “HOP user”. It never shows MAC
        addresses, phone numbers, email, GPS, or permanent device IDs. Physical two-phone BLE
        delivery is still pending verification.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40 },
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, backgroundColor: 'transparent' },
  button: { marginTop: 10, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  smallButton: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  buttonLabel: { color: '#042f2e', fontWeight: '700' },
  error: { color: '#DC2626' },
});
