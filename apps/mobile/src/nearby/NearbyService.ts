import type { BlePeer } from '@hop/protocol';

import { projectNearbyPeers } from './proximity';
import { deriveScanState } from './scanState';
import type {
  AroundUsPeer,
  AroundUsScanState,
  NearbyIdentity,
  NearbyPrivacyMode,
  NearbyTransport,
} from './types';
import { DEFAULT_PEER_STALE_MS } from './types';

export class NearbyService {
  privacyMode: NearbyPrivacyMode = 'invisible';
  contactIds = new Set<string>();
  selfUserId: string | null = null;
  connectedId: string | null = null;
  connectionError: string | null = null;
  sessionActive = false;
  sessionStartedAt: number | null = null;
  staleMs = DEFAULT_PEER_STALE_MS;
  readonly identities = new Map<string, NearbyIdentity>();

  constructor(
    private readonly transport: NearbyTransport,
    private readonly now: () => number = () => Date.now(),
  ) {}

  setPrivacyMode(mode: NearbyPrivacyMode): void {
    this.privacyMode = mode;
  }

  setContactIds(ids: Iterable<string>): void {
    this.contactIds = new Set(ids);
  }

  setSelfUserId(id: string | null): void {
    this.selfUserId = id;
  }

  setConnectedId(id: string | null): void {
    this.connectedId = id;
  }

  setSessionActive(active: boolean, startedAt?: number | null): void {
    this.sessionActive = active;
    this.sessionStartedAt = active ? (startedAt ?? this.now()) : null;
  }

  setConnectionError(error: string | null): void {
    this.connectionError = error;
  }

  rememberIdentity(userId: string, username: string, publicKey?: string): void {
    if (!userId || !username) return;
    this.identities.set(userId, { username, publicKey });
  }

  onPeersChanged(handler: () => void): () => void {
    return this.transport.onPeersChanged(handler);
  }

  listPeers(): AroundUsPeer[] {
    for (const peer of this.transport.listPeers()) {
      if (
        peer.userId &&
        peer.sessionEstablished &&
        peer.displayName &&
        peer.displayName !== 'HOP user'
      ) {
        this.rememberIdentity(peer.userId, peer.displayName, peer.publicKey);
      }
    }
    return projectNearbyPeers({
      peers: this.transport.listPeers(),
      connectedId: this.connectedId,
      privacyMode: this.privacyMode,
      selfUserId: this.selfUserId,
      contactIds: this.contactIds,
      identities: this.identities,
      now: this.now(),
      staleMs: this.staleMs,
    });
  }

  scanState(): AroundUsScanState {
    return deriveScanState({
      privacyMode: this.privacyMode,
      status: this.transport.status(),
      sessionActive: this.sessionActive,
      peerCount: this.listPeers().length,
      connectionError: this.connectionError,
      now: this.now(),
      sessionStartedAt: this.sessionStartedAt,
    });
  }

  ingestMockPeers(peers: BlePeer[]): void {
    const mock = this.transport as NearbyTransport & { setPeers?: (next: BlePeer[]) => void };
    mock.setPeers?.(peers);
  }
}
