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
  SafetyService,
  decryptApplicationMessage,
  encryptApplicationMessage,
  publishIdentityIfAllowed,
  sqlitePeerTrustPersistence,
  type IdentityKeyPair,
  type MessageCrypto,
  type NetworkStatus,
  type StoredConversation,
  type TransportManager,
} from '@hop/protocol';

import { ApiError, api, type Conversation } from '@/src/api/hop';
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
  safety: SafetyService | null;
  identityError: string | null;
  syncNow: () => Promise<void>;
  cacheConversation: (convo: Conversation) => Promise<void>;
  listCachedConversations: () => Promise<Conversation[]>;
  conversationPreview: (conversationId: string) => Promise<string>;
};

const OfflineContext = createContext<OfflineState | null>(null);

export { storedToChat } from '@/src/chat/storedToChat';

function toConversation(row: StoredConversation): Conversation {
  return {
    id: row.id,
    created_at: row.created_at,
    peer: {
      id: row.peer_id ?? '',
      username: row.peer_username ?? 'unknown',
      identity_public_key: row.peer_public_key ?? '',
    },
    kind: row.kind === 'event' ? 'event' : 'direct',
    title: row.title ?? null,
    event_id: row.event_id ?? null,
    archived: Boolean(row.archived),
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
  const [safety, setSafety] = useState<SafetyService | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const serviceRef = useRef<MessageService | null>(null);
  const storeRef = useRef<HopSqliteStore | null>(null);
  const tofuRef = useRef<PublicKeyTofu | null>(null);
  const safetyRef = useRef<SafetyService | null>(null);

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
        safetyRef.current = null;
        setService(null);
        setStore(null);
        setManager(null);
        setTofu(null);
        setSafety(null);
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
          await publishIdentityIfAllowed({
            localPublicKey: identity.publicKey,
            serverPublicKey: me.identity_public_key,
            put: async (body) => {
              await api.putIdentity(token, body.public_key);
            },
          });
        } catch (err) {
          if (err instanceof IdentityError) {
            setIdentityError(err.message);
          } else if (err instanceof ApiError && err.status === 409) {
            setIdentityError(
              'SERVER_KEY_LOCKED: this account already published a different identity key. HOP will not replace it. Recovery is a new account — local Replace keys cannot publish a second key.',
            );
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
      const safetyService = new SafetyService(sqlite);
      await safetyService.hydrate(user.id);
      svc.attachSafety(safetyService);
      if (cancelled) return;
      serviceRef.current = svc;
      storeRef.current = sqlite;
      tofuRef.current = peerTrust;
      safetyRef.current = safetyService;
      setStore(sqlite);
      setService(svc);
      setManager(transports);
      setTofu(peerTrust);
      setSafety(safetyService);
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
    const isEvent = convo.kind === 'event';
    let peerKey = convo.peer.identity_public_key ?? null;
    if (peerTrust && convo.peer.id && peerKey) {
      const state = peerTrust.observe(convo.peer.id, peerKey);
      if (state === 'KEY_CHANGED') {
        peerKey = peerTrust.get(convo.peer.id) ?? null;
      }
    }
    if (peerTrust) {
      for (const member of convo.members ?? []) {
        if (member.id && member.identity_public_key) {
          peerTrust.observe(member.id, member.identity_public_key);
        }
      }
    }
    await sqlite.saveConversation({
      id: convo.id,
      peer_id: isEvent ? null : convo.peer.id,
      peer_username: isEvent ? (convo.title ?? convo.peer.username) : convo.peer.username,
      peer_public_key: isEvent ? null : peerKey,
      created_at: convo.created_at,
      kind: isEvent ? 'event' : 'direct',
      title: convo.title ?? (isEvent ? convo.peer.username : null),
      event_id: convo.event_id ?? null,
      archived: Boolean(convo.archived),
    });
  }, []);

  const listCachedConversations = useCallback(async () => {
    const sqlite = storeRef.current;
    if (!sqlite) return [];
    const rows = await sqlite.listConversations();
    return rows.map(toConversation);
  }, []);

  const conversationPreview = useCallback(async (conversationId: string) => {
    const svc = serviceRef.current;
    if (!svc) return 'No messages yet';
    return svc.previewForConversation(conversationId);
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
      safety,
      identityError,
      syncNow,
      cacheConversation,
      listCachedConversations,
      conversationPreview,
    }),
    [ready, status, queuedCount, service, store, manager, tofu, safety, identityError, syncNow, cacheConversation, listCachedConversations, conversationPreview],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineState {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
