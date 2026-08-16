import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  nearbyPeerLabel,
  nearbyPeerPresence,
  rssiSignalBars,
  type BlePeer,
} from '@hop/protocol';

import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { openOrCreatePeerConversation } from '@/src/chat/openPeerConversation';
import { useOffline } from '@/src/offline/OfflineProvider';

function SignalBars({ bars, color }: { bars: number; color: string }) {
  return (
    <View style={styles.bars}>
      {[1, 2, 3, 4].map((level) => (
        <View
          key={level}
          style={[
            styles.bar,
            { height: 4 + level * 3, backgroundColor: color, opacity: bars >= level ? 1 : 0.2 },
          ]}
        />
      ))}
    </View>
  );
}

function presenceLabel(peer: BlePeer, connected: boolean): string {
  const presence = nearbyPeerPresence({
    userId: peer.userId,
    sessionEstablished: peer.sessionEstablished,
    connected,
  });
  if (presence === 'authenticated') return 'Authenticated';
  if (presence === 'connected') return 'Connected';
  return 'Available';
}

export default function NearbyScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const router = useRouter();
  const { user, token } = useAuth();
  const { cacheConversation, listCachedConversations } = useOffline();
  const {
    status,
    peers,
    connectedId,
    busy,
    error,
    sessionActive,
    startNearby,
    stopNearby,
    connectPeer,
    disconnectPeer,
  } = useBle();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      startNearby().catch(() => undefined);
      return () => {
        stopNearby().catch(() => undefined);
      };
    }, [startNearby, stopNearby]),
  );

  const scanLabel = !sessionActive
    ? 'Idle'
    : status.scanning
      ? 'Scanning'
      : 'Scan pause (battery)';
  const advertiseLabel = status.advertising
    ? `Visible as ${user?.username ?? 'you'}`
    : status.advertisingSupported
      ? 'Not advertising'
      : 'Advertising unsupported on this OS/hardware';
  const visiblePeers = peers.filter((peer) => peer.userId !== user?.id);

  async function messagePeer(peer: BlePeer) {
    // Production CTA: open the 1:1 thread, then ChatScreen sends via MessageService.
    if (!user || !peer.userId) return;
    setOpeningId(peer.deviceId);
    setOpenError(null);
    try {
      if (connectedId !== peer.deviceId) {
        await connectPeer(peer.deviceId);
      }
      const username = nearbyPeerLabel(peer);
      const convo = await openOrCreatePeerConversation({
        token,
        myId: user.id,
        peerUserId: peer.userId,
        peerUsername: username,
        peerPublicKey: peer.publicKey,
        cache: { listCached: listCachedConversations, cache: cacheConversation },
      });
      router.push(`/chat/${convo.id}?peer=${encodeURIComponent(convo.peer.username)}&peerId=${convo.peer.id}`);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Could not open chat');
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.wrap}>
      <StatusBanner />
      <Text style={styles.title}>Nearby</Text>
      <Text style={[styles.lead, { color: colors.muted }]}>
        Discover HOP users over Bluetooth. Chat picks Bluetooth or internet automatically — you never
        choose a transport.
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={styles.cardTitle}>This phone</Text>
        <Text style={{ color: colors.muted }}>{advertiseLabel}</Text>
        <Text style={{ color: colors.muted }}>{scanLabel}</Text>
        {status.detail ? <Text style={{ color: colors.muted }}>{status.detail}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {openError ? <Text style={styles.error}>{openError}</Text> : null}
        <Pressable
          onPress={() => (sessionActive ? stopNearby() : startNearby())}
          disabled={busy}
          style={[styles.button, { backgroundColor: colors.tint, opacity: busy ? 0.6 : 1 }]}>
          <Text style={styles.buttonLabel}>{sessionActive ? 'Stop Nearby' : 'Start Nearby'}</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Discovered HOP users</Text>
      {visiblePeers.length === 0 ? (
        <Text style={{ color: colors.muted, marginBottom: 16 }}>
          No compatible HOP peers yet. Keep Nearby open on both phones, a few meters apart, with
          Bluetooth on.
        </Text>
      ) : (
        visiblePeers.map((peer) => {
          const connected = connectedId === peer.deviceId;
          const canMessage = Boolean(peer.userId && peer.sessionEstablished);
          const bars = rssiSignalBars(peer.rssi);
          const busyPeer = busy || openingId === peer.deviceId;
          return (
            <View key={peer.deviceId} style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.peerHeader}>
                <Text style={styles.peerName}>{nearbyPeerLabel(peer)}</Text>
                <SignalBars bars={bars} color={colors.tint} />
              </View>
              <Text style={{ color: colors.muted }}>{presenceLabel(peer, connected)}</Text>
              <View style={styles.row}>
                {connected ? (
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
                  onPress={() => messagePeer(peer)}
                  disabled={busyPeer || !canMessage}
                  style={[
                    styles.smallButton,
                    { backgroundColor: colors.tint, opacity: busyPeer || !canMessage ? 0.45 : 1 },
                  ]}>
                  <Text style={styles.buttonLabel}>{openingId === peer.deviceId ? 'Opening…' : 'Message'}</Text>
                </Pressable>
              </View>
              {!canMessage ? (
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
        Nearby shows a HOP username from handshake, or “HOP user”. It never shows MAC addresses,
        phone numbers, email, GPS, or permanent device IDs. Physical two-phone BLE delivery is still
        pending verification.
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
  section: { fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  peerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' },
  peerName: { fontSize: 18, fontWeight: '700', flex: 1, marginRight: 8 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, backgroundColor: 'transparent' },
  bar: { width: 4, borderRadius: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  button: { marginTop: 10, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  smallButton: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  buttonLabel: { color: '#042f2e', fontWeight: '700' },
  error: { color: '#DC2626' },
});
