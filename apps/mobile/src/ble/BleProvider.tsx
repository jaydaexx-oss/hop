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
  DEFAULT_TTL_MS,
  BluetoothTransport,
  createBluetoothTransport,
  createMessage,
  decryptApplicationMessage,
  decodeUnencryptedText,
  encryptApplicationMessage,
  toEnvelope,
  type BleLinkStatus,
  type BlePeer,
  type EncryptedEnvelope,
  type IdentityKeyPair,
} from '@hop/protocol';

import { useAuth } from '@/src/auth/AuthProvider';
import { api } from '@/src/api/hop';
import { useOffline } from '@/src/offline/OfflineProvider';
import { HopBleEngine, type BleEngineStats } from '@/src/ble/HopBleEngine';
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
  stats: BleEngineStats;
  sessionActive: boolean;
  startNearby: () => Promise<void>;
  stopNearby: () => Promise<void>;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  startAdvertising: () => Promise<void>;
  stopAdvertising: () => Promise<void>;
  connectPeer: (deviceId: string) => Promise<void>;
  disconnectPeer: () => Promise<void>;
  sendTestPayload: (deviceId: string) => Promise<void>;
  clearLogs: () => void;
  relayConsent: boolean;
  setRelayConsent: (enabled: boolean) => Promise<void>;
};

const BleContext = createContext<BleContextValue | null>(null);

function shortTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function BleProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const { store, service, manager } = useOffline();
  const engineRef = useRef(new HopBleEngine());
  const [status, setStatus] = useState<BleLinkStatus>(engineRef.current.status());
  const [peers, setPeers] = useState<BlePeer[]>([]);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<NearbyLog[]>([]);
  const [stats, setStats] = useState<BleEngineStats>(engineRef.current.stats());
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
    setStats(engineRef.current.stats());
  }, []);

  const appendLog = useCallback((text: string) => {
    setLog((current) => [{ at: shortTime(), text }, ...current].slice(0, 100));
  }, []);

  const clearLogs = useCallback(() => {
    setLog([]);
    engineRef.current.clearStatsAndErrors();
    setStats(engineRef.current.stats());
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
          appendLog(`Delivery acknowledgment for ${plain.ack_of ?? envelope.message_id}.`);
          return true;
        }
        appendLog(`Received encrypted message from ${from.displayName}.`);
        const stored = {
          message_id: plain.message_id,
          conversation_id: plain.conversation_id,
          sender_id: plain.sender_id,
          recipient_id: plain.recipient_id,
          text: plain.text,
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
    const offStats = engine.onStatsChanged(() => {
      setStats(engine.stats());
    });
    refresh();
    return () => {
      offPeers();
      offConn();
      offInbox();
      offStats();
    };
  }, [appendLog, refresh]);

  useEffect(() => {
    if (!manager) return;
    const engine = engineRef.current;
    const transport = createBluetoothTransport(
      engine,
      (envelope) =>
        engine.listPeers().find((peer) => peer.userId === envelope.recipient_id)?.deviceId ?? null,
      async (envelope) => {
        const me = userRef.current;
        if (!me) throw new Error('Sign in before sending nearby.');
        const identity = identityRef.current ?? (await loadOrCreateIdentity(me.id));
        identityRef.current = identity;
        const peer = engine.listPeers().find((item) => item.userId === envelope.recipient_id);
        if (!peer?.publicKey) throw new Error('Secure session is not established.');
        const text = decodeUnencryptedText(envelope.encrypted_payload);
        if (!text) throw new Error('No plaintext to seal for BLE.');
        return encryptApplicationMessage(
          {
            message_id: envelope.message_id,
            sender_id: envelope.sender_id,
            recipient_id: envelope.recipient_id,
            conversation_id: envelope.conversation_id,
            text,
            created_at: envelope.created_at,
            expires_at: envelope.expires_at,
            ttl: envelope.ttl,
            hop_count: 0,
          },
          peer.publicKey,
          identity,
        );
      },
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

  const startScan = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await engineRef.current.startScanManual();
      appendLog('Scan started.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start scan');
    } finally {
      setBusy(false);
      refresh();
    }
  }, [appendLog, refresh]);

  const stopScan = useCallback(async () => {
    setBusy(true);
    try {
      await engineRef.current.stopScanManual();
      appendLog('Scan stopped.');
    } finally {
      setBusy(false);
      refresh();
    }
  }, [appendLog, refresh]);

  const startAdvertising = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await engineRef.current.startAdvertisingManual();
      appendLog('Advertising started.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start advertising');
    } finally {
      setBusy(false);
      refresh();
    }
  }, [appendLog, refresh]);

  const stopAdvertising = useCallback(async () => {
    setBusy(true);
    try {
      await engineRef.current.stopAdvertisingManual();
      appendLog('Advertising stopped.');
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
      const me = userRef.current;
      if (!me) return;
      const peer = engineRef.current.listPeers().find((item) => item.deviceId === deviceId);
      const recipient = peer?.userId ?? me.id;
      const identity = identityRef.current;
      if (!identity) {
        setError('Identity keys are not ready.');
        return;
      }
      if (!peer?.publicKey) {
        setError('Secure session is not established.');
        return;
      }
      const message = createMessage({
        sender_id: me.id,
        recipient_id: recipient,
        conversation_id: `ble:${[me.id, recipient].sort().join(':')}`,
      });
      const text = `nearby ping from ${me.username}`;
      const encrypted_payload = await encryptApplicationMessage(
        {
          message_id: message.message_id,
          sender_id: message.sender_id,
          recipient_id: message.recipient_id,
          conversation_id: message.conversation_id,
          text,
          created_at: message.created_at,
          expires_at: message.expires_at,
          ttl: message.ttl,
          hop_count: 0,
        },
        peer.publicKey,
        identity,
      );
      const envelope: EncryptedEnvelope = toEnvelope({
        ...message,
        encrypted_payload,
        transport: 'bluetooth',
      });
      setBusy(true);
      setError(null);
      try {
        const result = await engineRef.current.send(deviceId, envelope);
        if (!result.ok) {
          setError(result.error ?? 'BLE send failed');
          return;
        }
        appendLog(`Sent encrypted message to ${peer?.displayName ?? 'peer'}.`);
        const sqlite = storeRef.current;
        if (sqlite) {
          await sqlite.saveMessage({
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
            ttl: envelope.ttl ?? DEFAULT_TTL_MS,
            hop_count: 0,
          });
        }
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
      stats,
      sessionActive,
      startNearby,
      stopNearby,
      startScan,
      stopScan,
      startAdvertising,
      stopAdvertising,
      connectPeer,
      disconnectPeer,
      sendTestPayload,
      clearLogs,
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
      stats,
      sessionActive,
      startNearby,
      stopNearby,
      startScan,
      stopScan,
      startAdvertising,
      stopAdvertising,
      connectPeer,
      disconnectPeer,
      sendTestPayload,
      clearLogs,
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
