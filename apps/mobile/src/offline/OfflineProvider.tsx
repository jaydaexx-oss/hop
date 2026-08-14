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
  MessageService,
  type NetworkStatus,
  type StoredMessage,
  type TransportManager,
} from '@hop/protocol';

import { type ChatMessage, type Conversation } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { createAppTransportManager, createHopHttp } from '@/src/hopRuntime';
import { ExpoSqliteDriver } from '@/src/offline/driver';

type OfflineState = {
  ready: boolean;
  status: NetworkStatus;
  queuedCount: number;
  service: MessageService | null;
  store: HopSqliteStore | null;
  manager: TransportManager | null;
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
    e2ee: false,
  };
}

function toConversation(row: { id: string; peer_id: string | null; peer_username: string | null; created_at: string }): Conversation {
  return {
    id: row.id,
    created_at: row.created_at,
    peer: {
      id: row.peer_id ?? '',
      username: row.peer_username ?? 'unknown',
    },
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
  const serviceRef = useRef<MessageService | null>(null);
  const storeRef = useRef<HopSqliteStore | null>(null);

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
        setService(null);
        setStore(null);
        setManager(null);
        setReady(true);
        setStatus('Offline');
        setQueuedCount(0);
        return;
      }
      setReady(false);
      const driver = await ExpoSqliteDriver.open(`hop-${user.id}.db`);
      const sqlite = new HopSqliteStore(driver);
      await sqlite.init();
      const http = createHopHttp(() => tokenRef.current);
      const transports = createAppTransportManager(http);
      const svc = new MessageService(sqlite, transports, http, () => tokenRef.current);
      if (cancelled) return;
      serviceRef.current = svc;
      storeRef.current = sqlite;
      setStore(sqlite);
      setService(svc);
      setManager(transports);
      setReady(true);
      await svc.sync();
      if (!cancelled) await refresh();
    })().catch(() => {
      if (!cancelled) setReady(true);
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
    await sqlite.saveConversation({
      id: convo.id,
      peer_id: convo.peer.id,
      peer_username: convo.peer.username,
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
      syncNow,
      cacheConversation,
      listCachedConversations,
    }),
    [ready, status, queuedCount, service, store, manager, syncNow, cacheConversation, listCachedConversations],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineState {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
