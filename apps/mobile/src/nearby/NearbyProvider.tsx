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
import {
  canCommitEventEnable,
  discoveryProfileFor,
  isDiscoverable,
  isEventModeAllowed,
  operatingModeFor,
  planNearbyOperatingMode,
  shouldRunNearbyDiscovery,
  survivingEventEnabled,
} from './nearbyPolicy';
import { loadLastDiscoverableMode, loadPrivacyMode, saveLastDiscoverableMode, savePrivacyMode } from './privacyStore';
import type {
  AroundUsPeer,
  AroundUsScanState,
  EventModeSnapshot,
  NearbyAudience,
  NearbyOperatingMode,
  NearbyPrivacyMode,
} from './types';
import { DEFAULT_EVENT_DURATION_MS } from './types';

const EVENT_OFF: EventModeSnapshot = {
  enabled: false,
  startedAt: null,
  expiresAt: null,
  remainingMs: 0,
  sessionId: null,
  eventCode: null,
};

type NearbyContextValue = {
  ready: boolean;
  peers: AroundUsPeer[];
  scanState: AroundUsScanState;
  privacyMode: NearbyPrivacyMode;
  setPrivacyMode: (mode: NearbyPrivacyMode) => Promise<void>;
  discoverable: boolean;
  setDiscoverable: (on: boolean) => Promise<void>;
  operatingMode: NearbyOperatingMode;
  setOperatingMode: (
    mode: NearbyOperatingMode,
    options?: { audience?: NearbyAudience | null },
  ) => Promise<void>;
  audience: NearbyAudience;
  setAudience: (audience: NearbyAudience) => Promise<void>;
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
  const { listCachedConversations, safety } = useOffline();
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
  const [lastDiscoverableMode, setLastDiscoverableMode] = useState<Exclude<NearbyPrivacyMode, 'invisible'>>('everyone');
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
  const privacyRef = useRef<NearbyPrivacyMode>(privacyMode);
  const lastOnRef = useRef<Exclude<NearbyPrivacyMode, 'invisible'>>(lastDiscoverableMode);
  const eventRef = useRef<EventModeSnapshot>(eventMode);
  const modeRequestRef = useRef(0);
  const eventDesiredRef = useRef(false);

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
      privacyRef.current = 'invisible';
      eventRef.current = EVENT_OFF;
      eventDesiredRef.current = false;
      modeRequestRef.current += 1;
      setPrivacyModeState('invisible');
      setEventMode(EVENT_OFF);
      discoveryEpochRef.current += 1;
      stopNearby().catch(() => undefined);
      return;
    }
    let cancelled = false;
    setReady(false);
    Promise.all([
      loadPrivacyMode(kvRef.current, user.id),
      loadLastDiscoverableMode(kvRef.current, user.id),
      eventServiceRef.current.load(user.id),
    ])
      .then(async ([privacy, lastOn, event]) => {
        if (cancelled) return;
        let nextEvent = event;
        if (privacy === 'invisible' && event.enabled) {
          nextEvent = await eventServiceRef.current.disable(user.id);
        }
        if (cancelled) return;
        privacyRef.current = privacy;
        lastOnRef.current = lastOn;
        eventRef.current = nextEvent;
        eventDesiredRef.current = nextEvent.enabled;
        setPrivacyModeState(privacy);
        setLastDiscoverableMode(lastOn);
        setEventMode(nextEvent);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        privacyRef.current = 'invisible';
        eventRef.current = EVENT_OFF;
        eventDesiredRef.current = false;
        setPrivacyModeState('invisible');
        setEventMode(EVENT_OFF);
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
        void (async () => {
          const accepted = safety ? await safety.acceptedPeerIds() : new Set<string>();
          const blocked = safety ? await safety.blockedPeerIds() : new Set<string>();
          service.setContactIds(accepted);
          service.setBlockedIds(blocked);
          project();
        })();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [listCachedConversations, project, safety, user]);

  const startDiscovery = useCallback(
    async (mode: NearbyPrivacyMode, eventEnabled: boolean) => {
      const liveMode = privacyRef.current;
      if (liveMode === 'invisible' || mode === 'invisible') return;
      await engine.requestPermission().catch(() => false);
      const snap = engine.status();
      if (
        !shouldRunNearbyDiscovery({
          privacyMode: liveMode,
          appActive: AppState.currentState === 'active',
          bluetoothOn: snap.bluetoothOn,
          permissionGranted: snap.permissionGranted,
        })
      ) {
        return;
      }
      const epoch = discoveryEpochRef.current;
      const profile = discoveryProfileFor(
        liveMode,
        survivingEventEnabled(liveMode, eventDesiredRef.current && eventEnabled),
      );
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
    const livePrivacy = privacyRef.current;
    if (livePrivacy === 'invisible') {
      if (sessionActive) haltDiscovery().catch(() => undefined);
      return;
    }
    const canRun = shouldRunNearbyDiscovery({
      privacyMode: livePrivacy,
      appActive: AppState.currentState === 'active',
      bluetoothOn: status.bluetoothOn,
      permissionGranted: status.permissionGranted,
    });
    if (!canRun && sessionActive) {
      haltDiscovery().catch(() => undefined);
    }
    startDiscovery(livePrivacy, survivingEventEnabled(livePrivacy, eventMode.enabled)).catch(
      () => undefined,
    );
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
        const livePrivacy = privacyRef.current;
        let next = await eventServiceRef.current.tick(user.id);
        if (livePrivacy === 'invisible' && next.enabled) {
          next = await eventServiceRef.current.disable(user.id);
        }
        eventRef.current = next;
        setEventMode(next);
        if (!next.enabled) setDiscoveryProfile('standard');
        await startDiscovery(livePrivacy, next.enabled);
      })();
    });
    return () => sub.remove();
  }, [ready, setDiscoveryProfile, startDiscovery, user]);

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
    eventServiceRef.current.tick(user.id).then(async (next) => {
      if (privacyRef.current === 'invisible' && next.enabled) {
        next = await eventServiceRef.current.disable(user.id);
      }
      eventRef.current = next;
      setEventMode(next);
      if (!next.enabled) setDiscoveryProfile('standard');
    });
  }, [eventMode.enabled, setDiscoveryProfile, tick, user]);

  useEffect(() => {
    if (!safety) return;
    const off = safety.onChange(() => {
      void (async () => {
        const service = nearbyServiceRef.current;
        service.setContactIds(await safety.acceptedPeerIds());
        service.setBlockedIds(await safety.blockedPeerIds());
        project();
      })();
    });
    return off;
  }, [project, safety]);

  const setPrivacyMode = useCallback(
    async (mode: NearbyPrivacyMode) => {
      if (!user) return;
      if (mode === 'invisible') {
        eventDesiredRef.current = false;
        modeRequestRef.current += 1;
      }
      const requestId = modeRequestRef.current;
      if (privacyRef.current === 'invisible' && mode !== 'invisible') {
        discoveryIdRef.current = createEphemeralDiscoveryId();
      }
      privacyRef.current = mode;
      setPrivacyModeState(mode);
      await savePrivacyMode(kvRef.current, user.id, mode);
      if (requestId !== modeRequestRef.current) {
        await savePrivacyMode(kvRef.current, user.id, privacyRef.current);
        return;
      }
      if (mode === 'contacts' || mode === 'everyone') {
        lastOnRef.current = mode;
        setLastDiscoverableMode(mode);
        await saveLastDiscoverableMode(kvRef.current, user.id, mode);
      }
      if (requestId !== modeRequestRef.current) {
        await savePrivacyMode(kvRef.current, user.id, privacyRef.current);
        return;
      }
      if (mode === 'invisible') {
        discoveryEpochRef.current += 1;
        if (eventRef.current.enabled) {
          const next = await eventServiceRef.current.disable(user.id);
          if (requestId !== modeRequestRef.current) {
            await savePrivacyMode(kvRef.current, user.id, privacyRef.current);
            return;
          }
          eventRef.current = next;
          setEventMode(next);
        }
        if (requestId !== modeRequestRef.current) {
          await savePrivacyMode(kvRef.current, user.id, privacyRef.current);
          return;
        }
        await stopNearby();
        setDiscoveryProfile('standard');
      }
    },
    [setDiscoveryProfile, stopNearby, user],
  );

  const setDiscoverable = useCallback(
    async (on: boolean) => {
      eventDesiredRef.current = false;
      await setPrivacyMode(on ? lastOnRef.current : 'invisible');
    },
    [setPrivacyMode],
  );

  const enableEventMode = useCallback(
    async (forPrivacy: NearbyPrivacyMode = privacyRef.current) => {
      if (!user) return;
      const requestId = modeRequestRef.current;
      if (!isEventModeAllowed(privacyRef.current) || !isEventModeAllowed(forPrivacy)) {
        if (requestId !== modeRequestRef.current) return;
        throw new Error('Turn on Contacts only or Everyone nearby before Event Mode.');
      }
      const next = await eventServiceRef.current.enable(user.id, DEFAULT_EVENT_DURATION_MS);
      if (
        !canCommitEventEnable(requestId, modeRequestRef.current, privacyRef.current) ||
        !eventDesiredRef.current
      ) {
        if (!eventDesiredRef.current || !isEventModeAllowed(privacyRef.current)) {
          const off = await eventServiceRef.current.disable(user.id);
          eventRef.current = off;
          setEventMode(off);
          setDiscoveryProfile('standard');
        }
        return;
      }
      eventRef.current = next;
      setEventMode(next);
      setDiscoveryProfile('event');
    },
    [setDiscoveryProfile, user],
  );

  const disableEventMode = useCallback(async () => {
    if (!user) return;
    const next = await eventServiceRef.current.disable(user.id);
    eventRef.current = next;
    setEventMode(next);
    setDiscoveryProfile('standard');
  }, [setDiscoveryProfile, user]);

  const setOperatingMode = useCallback(
    async (mode: NearbyOperatingMode, options?: { audience?: NearbyAudience | null }) => {
      if (!user) return;
      const requestId = ++modeRequestRef.current;
      const plan = planNearbyOperatingMode({
        target: mode,
        privacyMode: privacyRef.current,
        lastDiscoverableMode: lastOnRef.current,
        eventEnabled: eventRef.current.enabled,
        audience: options?.audience,
      });
      if (plan.blockedByInvisible) {
        throw new Error('Turn on Contacts only or Everyone nearby before Event Mode.');
      }
      lastOnRef.current = plan.lastDiscoverableMode;
      eventDesiredRef.current = plan.nextEventEnabled;
      setLastDiscoverableMode(plan.lastDiscoverableMode);
      if (plan.nextPrivacyMode !== privacyRef.current) {
        await setPrivacyMode(plan.nextPrivacyMode);
      }
      if (requestId !== modeRequestRef.current) return;
      if (plan.nextEventEnabled) {
        await enableEventMode(plan.nextPrivacyMode);
      } else if (eventRef.current.enabled) {
        await disableEventMode();
      }
      if (requestId !== modeRequestRef.current) return;
      if (privacyRef.current === 'invisible' && eventRef.current.enabled) {
        await disableEventMode();
      }
    },
    [disableEventMode, enableEventMode, setPrivacyMode, user],
  );

  const setAudience = useCallback(
    async (next: NearbyAudience) => {
      if (privacyRef.current === 'invisible') return;
      await setPrivacyMode(next);
    },
    [setPrivacyMode],
  );

  const operatingMode = operatingModeFor(privacyMode, eventMode.enabled);

  const value = useMemo<NearbyContextValue>(
    () => ({
      ready,
      peers,
      scanState,
      privacyMode,
      setPrivacyMode,
      discoverable: isDiscoverable(privacyMode),
      setDiscoverable,
      operatingMode,
      setOperatingMode,
      audience: lastDiscoverableMode,
      setAudience,
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
      lastDiscoverableMode,
      operatingMode,
      peers,
      privacyMode,
      ready,
      scanState,
      sessionActive,
      setAudience,
      setDiscoverable,
      setOperatingMode,
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
