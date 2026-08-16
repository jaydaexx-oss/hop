import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import {
  BluetoothTransport,
  createBluetoothTransport,
  decryptApplicationMessage,
  type BleLinkStatus,
  type BlePeer,
  type IdentityKeyPair,
} from '@hop/protocol';

import { useAuth } from '@/src/auth/AuthProvider';
import { api } from '@/src/api/hop';
import { useOffline } from '@/src/offline/OfflineProvider';
import { HopBleEngine } from '@/src/ble/HopBleEngine';
import { loadOrCreateIdentity } from '@/src/crypto/identity';
import { loadRelayConsent, saveRelayConsent } from '@/src/ble/relayConsent';

export type NearbyLog = {
  at: string;
  text: string;
};

type BleContextValue = {
  engine: HopBleEngine;
  status: BleLinkStatus;
  peers: BlePeer[];
  connectedId: string | null;
  busy: boolean;
  error: string | null;
  log: NearbyLog[];
  sessionActive: boolean;
  startNearby: () => Promise<void>;
  stopNearby: () => Promise<void>;
  connectPeer: (deviceId: string) => Promise<void>;
  disconnectPeer: () => Promise<void>;
  sendTestPayload: (deviceId: string) => Promise<void>;
  relayConsent: boolean;
  setRelayConsent: (enabled: boolean) => Promise<void>;
};

const BleContext = createContext<BleContextValue | null>(null);

function shortTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function BleProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const { store, service, manager, tofu } = useOffline();
  const engineRef = useRef(new HopBleEngine());
  const [status, setStatus] = useState<BleLinkStatus>(engineRef.current.status());
  const [peers, setPeers] = useState<BlePeer[]>([]);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<NearbyLog[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [relayConsent, setRelayConsentState] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;
  const serviceRef = useRef(service);
  serviceRef.current = service;
  const userRef = useRef(user);
  userRef.current = user;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const identityRef = useRef<IdentityKeyPair | null>(null);
  const tofuRef = useRef(tofu);
  tofuRef.current = tofu;

  useEffect(() => {
    if (tofu) engineRef.current.setTofu(tofu);
  }, [tofu]);

  useEffect(() => {
    if (!user) {
      setRelayConsentState(false);
      return;
    }
    loadRelayConsent(user.id)
      .then(setRelayConsentState)
      .catch(() => setRelayConsentState(false));
  }, [user]);

  const refresh = useCallback(() => {
    setStatus(engineRef.current.status());
    setPeers(engineRef.current.listPeers());
  }, []);

  const appendLog = useCallback((text: string) => {
    setLog((current) => [{ at: shortTime(), text }, ...current].slice(0, 12));
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    const offPeers = engine.onPeersChanged(refresh);
    const offConn = engine.onConnectionChanged((deviceId, connected) => {
      setConnectedId((current) => {
        if (connected) return deviceId;
        return current === deviceId ? null : current;
      });
      appendLog(connected ? 'Secure session: connected.' : 'Disconnected.');
      refresh();
    });
    const offInbox = engine.subscribe(async (envelope, from) => {
      const keys = identityRef.current;
      if (!keys) return false;
      try {
        const plain = await decryptApplicationMessage(
          envelope.encrypted_payload,
          keys,
          from.userId === envelope.sender_id ? from.publicKey : undefined,
          envelope.message_id,
          {
            expectedSenderId: envelope.sender_id,
            expectedRecipientId: userRef.current?.id,
            tofu: engine.tofu,
          },
        );
        if (plain.kind === 'delivery_ack') {
          const svc = serviceRef.current;
          if (svc) {
            await svc.acceptInbound({
              message_id: envelope.message_id,
              conversation_id: envelope.conversation_id,
              sender_id: envelope.sender_id,
              recipient_id: envelope.recipient_id,
              text: null,
              encrypted_payload: envelope.encrypted_payload,
              status: 'SENT',
              transport: 'bluetooth',
              created_at: envelope.created_at,
              expires_at: envelope.expires_at,
              ttl: envelope.ttl,
              hop_count: envelope.hop_count,
            });
          }
          appendLog(`Delivery acknowledgment for ${plain.ack_of ?? envelope.message_id}.`);
          return true;
        }
        appendLog(
          plain.kind === 'voice'
            ? `Received encrypted voice message from ${from.displayName}.`
            : `Received encrypted message from ${from.displayName}.`,
        );
        const stored = {
          message_id: plain.message_id,
          conversation_id: plain.conversation_id,
          sender_id: plain.sender_id,
          recipient_id: plain.recipient_id,
          text: null,
          encrypted_payload: envelope.encrypted_payload,
          status: 'DELIVERED' as const,
          transport: 'bluetooth' as const,
          created_at: plain.created_at,
          expires_at: plain.expires_at,
          ttl: plain.ttl,
          hop_count: plain.hop_count,
        };
        const svc = serviceRef.current;
        if (svc) {
          await svc.acceptInbound(stored);
        } else {
          const sqlite = storeRef.current;
          if (sqlite) await sqlite.saveMessage(stored);
        }
        return true;
      } catch {
        appendLog(`Dropped payload from ${from.displayName}: authentication failed.`);
        return false;
      }
    });
    refresh();
    return () => {
      offPeers();
      offConn();
      offInbox();
    };
  }, [appendLog, refresh]);

  useEffect(() => {
    if (!manager) return;
    const engine = engineRef.current;
    const transport = createBluetoothTransport(engine, (envelope) =>
      engine.listPeers().find((peer) => peer.userId === envelope.recipient_id)?.deviceId ?? null,
    );
    manager.register(transport);
    return () => {
      if (transport instanceof BluetoothTransport) transport.dispose();
      manager.register(createBluetoothTransport());
    };
  }, [manager]);

  const stopNearby = useCallback(async () => {
    await engineRef.current.stopSession();
    setSessionActive(false);
    setConnectedId(null);
    refresh();
  }, [refresh]);

  const startNearby = useCallback(async () => {
    const me = userRef.current;
    if (!me) {
      setError('Sign in before using Nearby.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const identity = await loadOrCreateIdentity(me.id);
      identityRef.current = identity;
      const consent = await loadRelayConsent(me.id);
      setRelayConsentState(consent);
      await engineRef.current.startSession({
        userId: me.id,
        username: me.username,
        scanMode: 'balanced',
        identityPublicKey: identity.publicKey,
        ackIdentity: identity,
        relayConsent: consent,
        resolveServerPublicKey: tokenRef.current
          ? async (userId) => {
              const peer = await api.userById(tokenRef.current!, userId);
              return peer.identity_public_key || null;
            }
          : undefined,
      });
      setSessionActive(true);
      appendLog('Nearby started. libsodium crypto_box identity published in handshake.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Nearby');
    } finally {
      setBusy(false);
      refresh();
    }
  }, [appendLog, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && sessionActive) {
        stopNearby().catch(() => undefined);
        appendLog('Nearby stopped because the app left the foreground.');
      }
    });
    return () => sub.remove();
  }, [appendLog, sessionActive, stopNearby]);

  const connectPeer = useCallback(
    async (deviceId: string) => {
      setBusy(true);
      setError(null);
      try {
        const peer = await engineRef.current.connect(deviceId, 15_000);
        setConnectedId(peer.deviceId);
        const sqlite = storeRef.current;
        if (sqlite && peer.userId) {
          const convos = await sqlite.listConversations();
          const match = convos.find((row) => row.peer_id === peer.userId);
          if (match) {
            const trust = tofuRef.current ?? engineRef.current.tofu;
            let peerKey = match.peer_public_key;
            if (peer.publicKey && peer.userId) {
              const state = trust.observe(peer.userId, peer.publicKey);
              if (state === 'KEY_CHANGED') {
                throw new Error('Peer identity key changed; re-verify before sending');
              }
              peerKey = peer.publicKey;
            }
            await sqlite.saveConversation({
              ...match,
              peer_username: peer.displayName || match.peer_username,
              peer_public_key: peerKey,
            });
          }
        }
        appendLog(
          peer.sessionEstablished
            ? `Secure session established with ${peer.displayName}.`
            : `Connected to ${peer.displayName} without a public key.`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connect timed out');
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [appendLog, refresh],
  );

  const disconnectPeer = useCallback(async () => {
    if (!connectedId) return;
    setBusy(true);
    try {
      await engineRef.current.disconnect(connectedId);
      setConnectedId(null);
    } finally {
      setBusy(false);
      refresh();
    }
  }, [connectedId, refresh]);

  const sendTestPayload = useCallback(
    async (deviceId: string) => {
      if (!__DEV__) {
        setError('Nearby debug ping is not available in production builds.');
        return;
      }
      const me = userRef.current;
      if (!me) return;
      const peer = engineRef.current.listPeers().find((item) => item.deviceId === deviceId);
      if (!peer?.userId || peer.userId === me.id) {
        setError('Cannot send without a real recipient');
        return;
      }
      if (!peer.publicKey) {
        setError('Secure session is not established.');
        return;
      }
      const svc = serviceRef.current;
      const sqlite = storeRef.current;
      if (!svc || !sqlite) {
        setError('Messaging is not ready.');
        return;
      }
      const ids = [me.id, peer.userId].sort();
      const conversationId = `ble:${ids.join(':')}`;
      await sqlite.saveConversation({
        id: conversationId,
        peer_id: peer.userId,
        peer_username: peer.displayName || 'HOP user',
        peer_public_key: peer.publicKey,
        created_at: new Date().toISOString(),
      });
      setBusy(true);
      setError(null);
      try {
        await svc.sendText({
          conversation_id: conversationId,
          sender_id: me.id,
          recipient_id: peer.userId,
          text: `nearby ping from ${me.username}`,
        });
        appendLog(`Sent encrypted debug ping to ${peer.displayName} via MessageService.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'BLE send failed');
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [appendLog, refresh],
  );

  const setRelayConsent = useCallback(
    async (enabled: boolean) => {
      setRelayConsentState(enabled);
      engineRef.current.setRelayConsent(enabled);
      const me = userRef.current;
      if (me) await saveRelayConsent(me.id, enabled);
      appendLog(
        enabled
          ? 'Relay consent on. This phone may forward encrypted envelopes.'
          : 'Relay consent off.',
      );
    },
    [appendLog],
  );

  const value = useMemo<BleContextValue>(
    () => ({
      engine: engineRef.current,
      status,
      peers,
      connectedId,
      busy,
      error,
      log,
      sessionActive,
      startNearby,
      stopNearby,
      connectPeer,
      disconnectPeer,
      sendTestPayload,
      relayConsent,
      setRelayConsent,
    }),
    [
      status,
      peers,
      connectedId,
      busy,
      error,
      log,
      sessionActive,
      startNearby,
      stopNearby,
      connectPeer,
      disconnectPeer,
      sendTestPayload,
      relayConsent,
      setRelayConsent,
    ],
  );

  return <BleContext.Provider value={value}>{children}</BleContext.Provider>;
}

export function useBle(): BleContextValue {
  const ctx = useContext(BleContext);
  if (!ctx) throw new Error('useBle must be used within BleProvider');
  return ctx;
}
