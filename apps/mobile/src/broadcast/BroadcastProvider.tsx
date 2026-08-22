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
  isOwnBroadcast,
  nearbyBroadcastFanoutTargets,
  parseNearbyBroadcastWire,
  type NearbyBroadcast,
} from '@hop/protocol';

import { ApiError, api } from '@/src/api/hop';
import { useAuth } from '@/src/auth/AuthProvider';
import { useBle } from '@/src/ble/BleProvider';
import { createPersistentKv } from '@/src/nearby/kvStore';
import { useNearby } from '@/src/nearby/NearbyProvider';
import { useOffline } from '@/src/offline/OfflineProvider';

import { loadBroadcastFeed, saveBroadcastFeed } from './broadcastStore';
import {
  applyBroadcastDiscovery,
  applyPersistedBroadcasts,
  applyServerBroadcastAck,
  discoveryErrorKeepsLocalFeed,
} from './broadcastFeedSync';

type BroadcastContextValue = {
  posts: NearbyBroadcast[];
  sending: boolean;
  error: string | null;
  sendBroadcast: (body: string) => Promise<void>;
  deleteBroadcast: (id: string) => Promise<void>;
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
  const boundUserIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const [posts, setPosts] = useState<NearbyBroadcast[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const blockedRef = useRef<string[]>([]);
  blockedRef.current = blockedIds;
  const userId = user?.id ?? null;

  const persistFeed = useCallback((next: NearbyBroadcast[]) => {
    if (userId) saveBroadcastFeed(kvRef.current, userId, next).catch(() => undefined);
  }, [userId]);

  const publish = useCallback((next: NearbyBroadcast[], persist = true) => {
    setPosts(next);
    if (persist) persistFeed(next);
  }, [persistFeed]);

  useEffect(() => {
    if (!userId) {
      setPosts([]);
      return;
    }
    if (boundUserIdRef.current !== userId) {
      feedRef.current = new NearbyBroadcastFeed(() => userId, () => blockedRef.current);
      boundUserIdRef.current = userId;
      hydratedRef.current = false;
    }
    let cancelled = false;
    loadBroadcastFeed(kvRef.current, userId).then((stored) => {
      if (cancelled) return;
      const next = applyPersistedBroadcasts(feedRef.current.list(), stored, {
        selfId: userId,
        blockedIds: blockedRef.current,
      });
      feedRef.current.replaceAll(next);
      hydratedRef.current = true;
      publish(next);
    });
    return () => {
      cancelled = true;
    };
  }, [publish, userId]);

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
    setPosts(feedRef.current.list());
  }, [blockedIds]);

  useEffect(() => {
    const offPost = engine.subscribeNearbyBroadcast((incoming, from) => {
      const accepted = feedRef.current.ingest(incoming, from.userId);
      if (accepted) publish(feedRef.current.list());
    });
    const offRetract = engine.subscribeNearbyBroadcastRetract((retract, from) => {
      if (feedRef.current.ingestRetract(retract, from.userId)) {
        publish(feedRef.current.list());
      }
    });
    return () => {
      offPost();
      offRetract();
    };
  }, [engine, publish]);

  const syncInternet = useCallback(async () => {
    if (!token) return;
    try {
      const rows = await api.listNearbyBroadcasts(token);
      if (!Array.isArray(rows)) return;
      const incoming = rows.map(fromApiRow).filter((row): row is NearbyBroadcast => Boolean(row));
      const next = applyBroadcastDiscovery(feedRef.current.list(), incoming, {
        selfId: userId,
        blockedIds: blockedRef.current,
      });
      feedRef.current.replaceAll(next);
      setPosts(next);
      if (hydratedRef.current || next.length > 0) persistFeed(next);
    } catch (err) {
      if (err instanceof ApiError && discoveryErrorKeepsLocalFeed(err.status)) return;
      /* any fetch failure keeps BLE + locally sent posts */
    }
  }, [persistFeed, token, userId]);

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
          try {
            const row = await api.postNearbyBroadcast(token, {
              id: created.id,
              body: created.body,
              nearby_user_ids: targets.map((row) => row.userId),
              ttl_ms: created.ttlMs,
            });
            const server = fromApiRow(row);
            if (server) {
              const next = applyServerBroadcastAck(feedRef.current.list(), created.id, server, {
                selfId: user.id,
                blockedIds: blockedRef.current,
              });
              feedRef.current.replaceAll(next);
              publish(next);
            }
          } catch {
            /* keep the optimistic local post */
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send broadcast');
      } finally {
        setSending(false);
      }
    },
    [engine, peers, publish, token, user],
  );

  const deleteBroadcast = useCallback(
    async (id: string) => {
      if (!user) return;
      const snapshot = feedRef.current.list();
      const target = snapshot.find((post) => post.id === id);
      if (!target || !isOwnBroadcast(target, user.id)) return;
      setError(null);
      feedRef.current.remove(id);
      publish(feedRef.current.list());
      try {
        const targets = nearbyBroadcastFanoutTargets(
          peers.map((peer) => ({
            userId: peer.userId,
            deviceId: peer.deviceId,
            sessionEstablished: peer.encrypted,
          })),
          { selfId: user.id, blockedIds: blockedRef.current },
        );
        for (const peer of targets) {
          await engine.sendNearbyBroadcastRetract(peer.deviceId, {
            id,
            authorId: user.id,
          }).catch(() => undefined);
        }
        if (token) {
          try {
            await api.deleteNearbyBroadcast(token, id);
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 404)) throw err;
          }
        } else if (target.source === 'internet') {
          throw new Error('Could not delete broadcast');
        }
      } catch (err) {
        feedRef.current.restore(target);
        publish(feedRef.current.list());
        setError(err instanceof Error ? err.message : 'Could not delete broadcast');
      }
    },
    [engine, peers, publish, token, user],
  );

  const value = useMemo(
    () => ({ posts, sending, error, sendBroadcast, deleteBroadcast, blockedIds }),
    [blockedIds, deleteBroadcast, error, posts, sendBroadcast, sending],
  );

  return <BroadcastContext.Provider value={value}>{children}</BroadcastContext.Provider>;
}

export function useBroadcast(): BroadcastContextValue {
  const ctx = useContext(BroadcastContext);
  if (!ctx) throw new Error('useBroadcast must be used within BroadcastProvider');
  return ctx;
}
