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
import {
  NearbyBroadcastFeed,
  mergeBroadcastFeed,
  nearbyBroadcastFanoutTargets,
  parseNearbyBroadcastWire,
  type NearbyBroadcast,
} from '@hop/protocol';

import { api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { createPersistentKv } from '@/src/nearby/kvStore';
import { useNearby } from '@/src/nearby/NearbyProvider';
import { useOffline } from '@/src/offline/OfflineProvider';

import { loadBroadcastFeed, saveBroadcastFeed } from './broadcastStore';

type BroadcastContextValue = {
  posts: NearbyBroadcast[];
  sending: boolean;
  error: string | null;
  sendBroadcast: (body: string) => Promise<void>;
  blockedIds: string[];
};

const BroadcastContext = createContext<BroadcastContextValue | null>(null);

function fromApiRow(row: {
  id: string;
  author_id: string;
  display_name: string;
  body: string;
  created_at: string;
  expires_at: string;
  ttl_ms: number;
}): NearbyBroadcast | null {
  return parseNearbyBroadcastWire(
    {
      v: 1,
      type: 'nearby_broadcast',
      id: row.id,
      author_id: row.author_id,
      display_name: row.display_name,
      body: row.body,
      created_at: row.created_at,
      expires_at: row.expires_at,
      ttl_ms: row.ttl_ms,
    },
    'internet',
  );
}

export function BroadcastProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const { engine } = useBle();
  const { peers } = useNearby();
  const { safety } = useOffline();
  const kvRef = useRef(createPersistentKv());
  const feedRef = useRef(new NearbyBroadcastFeed(() => user?.id ?? null, () => blockedRef.current));
  const [posts, setPosts] = useState<NearbyBroadcast[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const blockedRef = useRef<string[]>([]);
  blockedRef.current = blockedIds;
  const userId = user?.id ?? null;

  const publish = useCallback((next: NearbyBroadcast[]) => {
    setPosts(next);
    if (userId) saveBroadcastFeed(kvRef.current, userId, next).catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    feedRef.current = new NearbyBroadcastFeed(() => user?.id ?? null, () => blockedRef.current);
    if (!userId) {
      setPosts([]);
      return;
    }
    let cancelled = false;
    loadBroadcastFeed(kvRef.current, userId).then((stored) => {
      if (cancelled) return;
      publish(feedRef.current.replaceAll(stored));
    });
    return () => {
      cancelled = true;
    };
  }, [publish, userId, user?.id]);

  useEffect(() => {
    if (!safety) {
      setBlockedIds([]);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      safety.blockedPeerIds().then((ids) => {
        if (!cancelled) setBlockedIds([...ids]);
      });
    };
    refresh();
    const off = safety.onChange(refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, [safety]);

  useEffect(() => {
    publish(feedRef.current.list());
  }, [blockedIds, publish]);

  useEffect(() => {
    const off = engine.subscribeNearbyBroadcast((incoming, from) => {
      const accepted = feedRef.current.ingest(incoming, from.userId);
      if (accepted) publish(feedRef.current.list());
    });
    return off;
  }, [engine, publish]);

  const syncInternet = useCallback(async () => {
    if (!token) return;
    try {
      const rows = await api.listNearbyBroadcasts(token);
      const incoming = rows.map(fromApiRow).filter((row): row is NearbyBroadcast => Boolean(row));
      const next = mergeBroadcastFeed(feedRef.current.list(), incoming, {
        selfId: userId,
        blockedIds: blockedRef.current,
      });
      feedRef.current.replaceAll(next);
      publish(next);
    } catch {
      /* offline: BLE + local feed still work */
    }
  }, [publish, token, userId]);

  useEffect(() => {
    void syncInternet();
    const timer = setInterval(() => void syncInternet(), 15_000);
    return () => clearInterval(timer);
  }, [syncInternet]);

  const sendBroadcast = useCallback(
    async (body: string) => {
      if (!user) return;
      setSending(true);
      setError(null);
      try {
        const created = feedRef.current.post({
          authorId: user.id,
          displayName: user.username,
          body,
        });
        publish(feedRef.current.list());
        const targets = nearbyBroadcastFanoutTargets(
          peers.map((peer) => ({
            userId: peer.userId,
            deviceId: peer.deviceId,
            sessionEstablished: peer.encrypted,
          })),
          { selfId: user.id, blockedIds: blockedRef.current },
        );
        for (const target of targets) {
          await engine.sendNearbyBroadcast(target.deviceId, created).catch(() => undefined);
        }
        if (token) {
          await api
            .postNearbyBroadcast(token, {
              id: created.id,
              body: created.body,
              nearby_user_ids: targets.map((row) => row.userId),
              ttl_ms: created.ttlMs,
            })
            .catch(() => undefined);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send broadcast');
      } finally {
        setSending(false);
      }
    },
    [engine, peers, publish, token, user],
  );

  const value = useMemo(
    () => ({ posts, sending, error, sendBroadcast, blockedIds }),
    [blockedIds, error, posts, sendBroadcast, sending],
  );

  return <BroadcastContext.Provider value={value}>{children}</BroadcastContext.Provider>;
}

export function useBroadcast(): BroadcastContextValue {
  const ctx = useContext(BroadcastContext);
  if (!ctx) throw new Error('useBroadcast must be used within BroadcastProvider');
  return ctx;
}
