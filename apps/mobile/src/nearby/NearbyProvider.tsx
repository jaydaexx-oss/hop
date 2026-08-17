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

import { useAuth } from '@/src/auth/AuthProvider';
import { useBle, type StartNearbyOptions } from '@/src/ble/BleProvider';
import { useOffline } from '@/src/offline/OfflineProvider';

import { EventModeService, formatEventRemaining } from './EventModeService';
import { NearbyService } from './NearbyService';
import { createEphemeralDiscoveryId } from './ephemeralId';
import { createPersistentKv } from './kvStore';
import { discoveryProfileFor, isEventModeAllowed, shouldRunNearbyDiscovery } from './nearbyPolicy';
import { loadPrivacyMode, savePrivacyMode } from './privacyStore';
import type { AroundUsPeer, AroundUsScanState, EventModeSnapshot, NearbyPrivacyMode } from './types';
import { DEFAULT_EVENT_DURATION_MS } from './types';

type NearbyContextValue = {
  ready: boolean;
  peers: AroundUsPeer[];
  scanState: AroundUsScanState;
  privacyMode: NearbyPrivacyMode;
  setPrivacyMode: (mode: NearbyPrivacyMode) => Promise<void>;
  eventMode: EventModeSnapshot;
  eventRemainingLabel: string;
  enableEventMode: () => Promise<void>;
  disableEventMode: () => Promise<void>;
  sessionActive: boolean;
  busy: boolean;
  error: string | null;
  nearbyCount: number;
  statusDetail: string;
  connectPeer: (deviceId: string) => Promise<void>;
  disconnectPeer: () => Promise<void>;
};

const NearbyContext = createContext<NearbyContextValue | null>(null);

export function NearbyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { listCachedConversations } = useOffline();
  const {
    engine,
    status,
    connectedId,
    busy,
    error,
    sessionActive,
    startNearby,
    stopNearby,
    connectPeer,
    disconnectPeer,
    setDiscoveryProfile,
  } = useBle();

  const kvRef = useRef(createPersistentKv());
  const eventServiceRef = useRef(new EventModeService(kvRef.current));
  const nearbyServiceRef = useRef(
    new NearbyService({
      status: () => engine.status(),
      listPeers: () => engine.listPeers(),
      onPeersChanged: (handler) => engine.onPeersChanged(handler),
    }),
  );
  const discoveryIdRef = useRef(createEphemeralDiscoveryId());
  const discoveryEpochRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [privacyMode, setPrivacyModeState] = useState<NearbyPrivacyMode>('invisible');
  const [eventMode, setEventMode] = useState<EventModeSnapshot>({
    enabled: false,
    startedAt: null,
    expiresAt: null,
    remainingMs: 0,
    sessionId: null,
    eventCode: null,
  });
  const [peers, setPeers] = useState<AroundUsPeer[]>([]);
  const [scanState, setScanState] = useState<AroundUsScanState>('invisible');
  const [tick, setTick] = useState(0);

  const project = useCallback(() => {
    const service = nearbyServiceRef.current;
    service.setPrivacyMode(privacyMode);
    service.setSelfUserId(user?.id ?? null);
    service.setConnectedId(connectedId);
    service.setSessionActive(sessionActive);
    service.setConnectionError(error);
    const next = service.listPeers();
    setPeers(next);
    setScanState(service.scanState());
  }, [connectedId, error, privacyMode, sessionActive, user?.id]);

  useEffect(() => {
    const service = nearbyServiceRef.current;
    const off = service.onPeersChanged(project);
    project();
    return off;
  }, [project]);

  useEffect(() => {
    project();
  }, [project, status.bluetoothOn, status.permissionGranted, status.scanning, status.advertising]);

  useEffect(() => {
    if (!user) {
      setReady(false);
      setPrivacyModeState('invisible');
      setEventMode({
        enabled: false,
        startedAt: null,
        expiresAt: null,
        remainingMs: 0,
        sessionId: null,
        eventCode: null,
      });
      discoveryEpochRef.current += 1;
      stopNearby().catch(() => undefined);
      return;
    }
    let cancelled = false;
    setReady(false);
    Promise.all([loadPrivacyMode(kvRef.current, user.id), eventServiceRef.current.load(user.id)])
      .then(async ([privacy, event]) => {
        if (cancelled) return;
        let nextEvent = event;
        if (privacy === 'invisible' && event.enabled) {
          nextEvent = await eventServiceRef.current.disable(user.id);
        }
        if (cancelled) return;
        setPrivacyModeState(privacy);
        setEventMode(nextEvent);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPrivacyModeState('invisible');
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [stopNearby, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listCachedConversations()
      .then((convos) => {
        if (cancelled) return;
        const ids = new Set<string>();
        const service = nearbyServiceRef.current;
        for (const convo of convos) {
          if (convo.peer.id) {
            ids.add(convo.peer.id);
            service.rememberIdentity(
              convo.peer.id,
              convo.peer.username,
              convo.peer.identity_public_key || undefined,
            );
          }
        }
        service.setContactIds(ids);
        project();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [listCachedConversations, project, user]);

  const startDiscovery = useCallback(
    async (mode: NearbyPrivacyMode, eventEnabled: boolean) => {
      const snap = engine.status();
      if (
        !shouldRunNearbyDiscovery({
          privacyMode: mode,
          appActive: AppState.currentState === 'active',
          bluetoothOn: snap.bluetoothOn,
          permissionGranted: snap.permissionGranted,
        })
      ) {
        return;
      }
      const epoch = discoveryEpochRef.current;
      const profile = discoveryProfileFor(mode, eventEnabled);
      const options: StartNearbyOptions = {
        discoveryId: discoveryIdRef.current,
        scanMode: profile === 'event' ? 'lowLatency' : 'balanced',
        discoveryProfile: profile,
      };
      if (sessionActive) {
        setDiscoveryProfile(options.discoveryProfile!);
        return;
      }
      await startNearby(options);
      if (discoveryEpochRef.current !== epoch) {
        await stopNearby();
      }
    },
    [engine, sessionActive, setDiscoveryProfile, startNearby, stopNearby],
  );

  const haltDiscovery = useCallback(async () => {
    discoveryEpochRef.current += 1;
    await stopNearby();
    setDiscoveryProfile('standard');
  }, [setDiscoveryProfile, stopNearby]);

  useEffect(() => {
    if (!ready) return;
    if (
      !shouldRunNearbyDiscovery({
        privacyMode,
        appActive: AppState.currentState === 'active',
        bluetoothOn: status.bluetoothOn,
        permissionGranted: status.permissionGranted,
      })
    ) {
      if (sessionActive) haltDiscovery().catch(() => undefined);
      return;
    }
    startDiscovery(privacyMode, eventMode.enabled).catch(() => undefined);
  }, [
    eventMode.enabled,
    haltDiscovery,
    privacyMode,
    ready,
    sessionActive,
    startDiscovery,
    status.bluetoothOn,
    status.permissionGranted,
  ]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !ready || !user) return;
      void (async () => {
        const next = await eventServiceRef.current.tick(user.id);
        setEventMode(next);
        if (!next.enabled) setDiscoveryProfile('standard');
        await startDiscovery(privacyMode, next.enabled);
      })();
    });
    return () => sub.remove();
  }, [privacyMode, ready, setDiscoveryProfile, startDiscovery, user]);

  useEffect(() => {
    return () => {
      discoveryEpochRef.current += 1;
      stopNearby().catch(() => undefined);
    };
  }, [stopNearby]);

  useEffect(() => {
    if (!eventMode.enabled) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [eventMode.enabled]);

  useEffect(() => {
    if (!user || !eventMode.enabled) return;
    eventServiceRef.current.tick(user.id).then((next) => {
      setEventMode(next);
      if (!next.enabled) setDiscoveryProfile('standard');
    });
  }, [eventMode.enabled, setDiscoveryProfile, tick, user]);

  const setPrivacyMode = useCallback(
    async (mode: NearbyPrivacyMode) => {
      if (!user) return;
      if (privacyMode === 'invisible' && mode !== 'invisible') {
        discoveryIdRef.current = createEphemeralDiscoveryId();
      }
      setPrivacyModeState(mode);
      await savePrivacyMode(kvRef.current, user.id, mode);
      if (mode === 'invisible') {
        discoveryEpochRef.current += 1;
        if (eventMode.enabled) {
          const next = await eventServiceRef.current.disable(user.id);
          setEventMode(next);
        }
        await stopNearby();
        setDiscoveryProfile('standard');
      }
    },
    [eventMode.enabled, privacyMode, setDiscoveryProfile, stopNearby, user],
  );

  const enableEventMode = useCallback(async () => {
    if (!user) return;
    if (!isEventModeAllowed(privacyMode)) {
      throw new Error('Turn on Contacts only or Everyone nearby before Event Mode.');
    }
    const next = await eventServiceRef.current.enable(user.id, DEFAULT_EVENT_DURATION_MS);
    setEventMode(next);
    setDiscoveryProfile('event');
  }, [privacyMode, setDiscoveryProfile, user]);

  const disableEventMode = useCallback(async () => {
    if (!user) return;
    const next = await eventServiceRef.current.disable(user.id);
    setEventMode(next);
    setDiscoveryProfile('standard');
  }, [setDiscoveryProfile, user]);

  const value = useMemo<NearbyContextValue>(
    () => ({
      ready,
      peers,
      scanState,
      privacyMode,
      setPrivacyMode,
      eventMode,
      eventRemainingLabel: formatEventRemaining(eventMode.remainingMs),
      enableEventMode,
      disableEventMode,
      sessionActive,
      busy,
      error,
      nearbyCount: peers.length,
      statusDetail: status.detail,
      connectPeer,
      disconnectPeer,
    }),
    [
      busy,
      connectPeer,
      disableEventMode,
      disconnectPeer,
      enableEventMode,
      error,
      eventMode,
      peers,
      privacyMode,
      ready,
      scanState,
      sessionActive,
      setPrivacyMode,
      status.detail,
    ],
  );

  return <NearbyContext.Provider value={value}>{children}</NearbyContext.Provider>;
}

export function useNearby(): NearbyContextValue {
  const ctx = useContext(NearbyContext);
  if (!ctx) throw new Error('useNearby must be used within NearbyProvider');
  return ctx;
}

export function useNearbyPeers() {
  return useNearby();
}
