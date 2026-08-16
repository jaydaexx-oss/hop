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
  HopSqliteStore,
  IdentityError,
  MessageService,
  PublicKeyTofu,
  assertPublishedIdentityMatches,
  decryptApplicationMessage,
  encryptApplicationMessage,
  isCryptoBoxPayload,
  sqlitePeerTrustPersistence,
  type IdentityKeyPair,
  type MessageCrypto,
  type NetworkStatus,
  type StoredConversation,
  type StoredMessage,
  type TransportManager,
} from '@hop/protocol';

import { ApiError, api, type ChatMessage, type Conversation } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { loadOrCreateIdentity } from '@/src/crypto/identity';
import { createAppTransportManager, createHopHttp } from '@/src/hopRuntime';
import { ExpoSqliteDriver } from '@/src/offline/driver';

type OfflineState = {
  ready: boolean;
  status: NetworkStatus;
  queuedCount: number;
  service: MessageService | null;
  store: HopSqliteStore | null;
  manager: TransportManager | null;
  tofu: PublicKeyTofu | null;
  identityError: string | null;
  syncNow: () => Promise<void>;
  cacheConversation: (convo: Conversation) => Promise<void>;
  listCachedConversations: () => Promise<Conversation[]>;
};

const OfflineContext = createContext<OfflineState | null>(null);

export function storedToChat(row: StoredMessage): ChatMessage {
  return {
    message_id: row.message_id,
    sender_id: row.sender_id,
    recipient_id: row.recipient_id,
    conversation_id: row.conversation_id,
    text: row.text,
    status: row.status,
    created_at: row.created_at,
    e2ee: isCryptoBoxPayload(row.encrypted_payload),
    encrypted_payload: row.encrypted_payload,
    kind: row.kind,
    duration_ms: row.duration_ms,
    mime: row.mime,
    audio_b64: row.audio_b64,
  };
}

function toConversation(row: StoredConversation): Conversation {
  return {
    id: row.id,
    created_at: row.created_at,
    peer: {
      id: row.peer_id ?? '',
      username: row.peer_username ?? 'unknown',
      identity_public_key: row.peer_public_key ?? '',
    },
  };
}

function createAppCrypto(identity: IdentityKeyPair, store: HopSqliteStore, tofu: PublicKeyTofu): MessageCrypto {
  return {
    encrypt: async (plain) => {
      const pk = await store.peerPublicKey(plain.recipient_id);
      if (!pk) throw new Error('Peer has not published an identity public key.');
      const state = tofu.observe(plain.recipient_id, pk);
      if (state === 'KEY_CHANGED') {
        throw new Error('Peer identity key changed; re-verify before sending');
      }
      return encryptApplicationMessage(plain, tofu.requireTrustedPublicKey(plain.recipient_id), identity);
    },
    sealLocal: (plain) => encryptApplicationMessage(plain, identity.publicKey, identity),
    decrypt: (payload, expectedSenderPk, expectedMessageId, options) =>
      decryptApplicationMessage(payload, identity, expectedSenderPk, expectedMessageId, {
        ...options,
        tofu: options?.tofu ?? tofu,
      }),
  };
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const [ready, setReady] = useState(!user);
  const [status, setStatus] = useState<NetworkStatus>('Offline');
  const [queuedCount, setQueuedCount] = useState(0);
  const [service, setService] = useState<MessageService | null>(null);
  const [store, setStore] = useState<HopSqliteStore | null>(null);
  const [manager, setManager] = useState<TransportManager | null>(null);
  const [tofu, setTofu] = useState<PublicKeyTofu | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const serviceRef = useRef<MessageService | null>(null);
  const storeRef = useRef<HopSqliteStore | null>(null);
  const tofuRef = useRef<PublicKeyTofu | null>(null);

  const refresh = useCallback(async () => {
    const svc = serviceRef.current;
    const sqlite = storeRef.current;
    if (!svc || !sqlite) return;
    setQueuedCount(await sqlite.queuedCount());
    setStatus(await svc.getNetworkStatus());
  }, []);

  const syncNow = useCallback(async () => {
    const svc = serviceRef.current;
    if (!svc) return;
    await svc.sync();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        serviceRef.current = null;
        storeRef.current = null;
        tofuRef.current = null;
        setService(null);
        setStore(null);
        setManager(null);
        setTofu(null);
        setIdentityError(null);
        setReady(true);
        setStatus('Offline');
        setQueuedCount(0);
        return;
      }
      setReady(false);
      const driver = await ExpoSqliteDriver.open(`hop-${user.id}.db`);
      const sqlite = new HopSqliteStore(driver);
      await sqlite.init();
      const identity = await loadOrCreateIdentity(user.id);
      const peerTrust = new PublicKeyTofu(sqlitePeerTrustPersistence(sqlite));
      await peerTrust.hydrate();
      const token = tokenRef.current;
      if (token) {
        try {
          const me = await api.me(token);
          assertPublishedIdentityMatches(identity.publicKey, me.identity_public_key);
          if (!me.identity_public_key) {
            await api.putIdentity(token, identity.publicKey);
          }
        } catch (err) {
          if (err instanceof IdentityError && err.code === 'KEY_MISMATCH') {
            setIdentityError(err.message);
          } else if (err instanceof ApiError && err.status === 409) {
            setIdentityError(
              'Server rejected a new identity public key (409). HOP will not silently replace the published key.',
            );
          } else if (err instanceof IdentityError) {
            setIdentityError(err.message);
          }
          /* network errors stay best-effort while offline */
        }
      }
      const http = createHopHttp(() => tokenRef.current);
      const transports = createAppTransportManager(http);
      const svc = new MessageService(
        sqlite,
        transports,
        http,
        () => tokenRef.current,
        createAppCrypto(identity, sqlite, peerTrust),
        peerTrust,
      );
      if (cancelled) return;
      serviceRef.current = svc;
      storeRef.current = sqlite;
      tofuRef.current = peerTrust;
      setStore(sqlite);
      setService(svc);
      setManager(transports);
      setTofu(peerTrust);
      setReady(true);
      await svc.sync();
      if (!cancelled) await refresh();
    })().catch((err) => {
      if (!cancelled) {
        if (err instanceof IdentityError) setIdentityError(err.message);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user, refresh]);

  useEffect(() => {
    if (!service) return;
    const tick = () => {
      syncNow().catch(() => undefined);
    };
    tick();
    const id = setInterval(tick, 5_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [service, syncNow]);

  const cacheConversation = useCallback(async (convo: Conversation) => {
    const sqlite = storeRef.current;
    if (!sqlite) return;
    const peerTrust = tofuRef.current;
    let peerKey = convo.peer.identity_public_key ?? null;
    if (peerTrust && convo.peer.id && peerKey) {
      const state = peerTrust.observe(convo.peer.id, peerKey);
      if (state === 'KEY_CHANGED') {
        peerKey = peerTrust.get(convo.peer.id) ?? null;
      }
    }
    await sqlite.saveConversation({
      id: convo.id,
      peer_id: convo.peer.id,
      peer_username: convo.peer.username,
      peer_public_key: peerKey,
      created_at: convo.created_at,
    });
  }, []);

  const listCachedConversations = useCallback(async () => {
    const sqlite = storeRef.current;
    if (!sqlite) return [];
    const rows = await sqlite.listConversations();
    return rows.map(toConversation);
  }, []);

  const value = useMemo<OfflineState>(
    () => ({
      ready,
      status,
      queuedCount,
      service,
      store,
      manager,
      tofu,
      identityError,
      syncNow,
      cacheConversation,
      listCachedConversations,
    }),
    [ready, status, queuedCount, service, store, manager, tofu, identityError, syncNow, cacheConversation, listCachedConversations],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineState {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
