import type {
  BleLinkStatus,
  BlePeer,
  BleScanMode,
  BleSessionOptions,
  NearbyAudience,
  NearbyOperatingMode,
} from '@hop/protocol';

export type { NearbyAudience, NearbyOperatingMode };

export type NearbyPrivacyMode = 'invisible' | 'contacts' | 'everyone';

export type ProximityBand = 'very_close' | 'nearby' | 'farther';

export type AroundUsScanState =
  | 'invisible'
  | 'bluetooth_off'
  | 'permission_needed'
  | 'searching'
  | 'nobody_nearby'
  | 'peers_found'
  | 'connection_failure';

export type BleDiscoveryProfile = 'standard' | 'event';

/** UI-facing nearby person. `deviceId` is for connect only — never render it. */
export type AroundUsPeer = {
  /** Opaque session token derived from the OS id. Safe as a React key; never show it. */
  token: string;
  /** Rotating advertisement discovery id. Not a user UUID or MAC. */
  ephemeralId: string;
  /** OS BLE identifier used to connect. May be a MAC on Android — never display. */
  deviceId: string;
  displayName: string;
  avatarInitials: string;
  userId?: string;
  publicKey?: string;
  proximity: ProximityBand;
  /** Real advertised RSSI when the OS provided one. Never invented. */
  rssi: number | null;
  lastSeenAt: number;
  discovered: boolean;
  encrypted: boolean;
  connected: boolean;
  canMessage: boolean;
};

export type NearbyIdentity = {
  username: string;
  publicKey?: string;
};

export type EventModeSnapshot = {
  enabled: boolean;
  startedAt: number | null;
  expiresAt: number | null;
  remainingMs: number;
  /** Local stub so a future venue QR / event code can scope discovery. */
  sessionId: string | null;
  /** Unused. Event Mode does not mint public event codes. */
  eventCode: string | null;
  /** Local display name for this Event Mode session. Not a public event code. */
  name: string | null;
};

export type KvStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

/** Discovery-facing subset of BLE transport. Mockable without hardware. */
export type NearbyTransport = {
  status(): BleLinkStatus;
  listPeers(): BlePeer[];
  onPeersChanged(handler: () => void): () => void;
  onConnectionChanged?(handler: (deviceId: string, connected: boolean) => void): () => void;
  startSession?(options: BleSessionOptions): Promise<void>;
  stopSession?(): Promise<void>;
  setScanMode?(mode: BleScanMode): Promise<void>;
  setDiscoveryProfile?(profile: BleDiscoveryProfile): void;
  requestPermission?(): Promise<boolean>;
  connect?(deviceId: string, timeoutMs?: number): Promise<BlePeer>;
};

export const DEFAULT_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_PEER_STALE_MS = 25_000;
export const SEARCHING_GRACE_MS = 12_000;

export const PRIVACY_LABELS: Record<NearbyPrivacyMode, string> = {
  invisible: 'Invisible',
  contacts: 'Contacts only',
  everyone: 'Everyone nearby',
};

export const OPERATING_MODE_LABELS: Record<NearbyOperatingMode, string> = {
  around_us: 'Around Us',
  event: 'Event Mode',
  invisible: 'Invisible',
};

export const AUDIENCE_LABELS: Record<NearbyAudience, string> = {
  contacts: 'Contacts only',
  everyone: 'Everyone nearby',
};

export const PROXIMITY_LABELS: Record<ProximityBand, string> = {
  very_close: 'Very Close',
  nearby: 'Nearby',
  farther: 'Farther Away',
};
