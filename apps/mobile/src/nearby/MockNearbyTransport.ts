import type { BleLinkStatus, BlePeer, BleScanMode, BleSessionOptions } from '@hop/protocol';

import type { BleDiscoveryProfile, NearbyTransport } from './types';

export class MockNearbyTransport implements NearbyTransport {
  peers: BlePeer[] = [];
  currentStatus: BleLinkStatus = {
    implemented: true,
    bluetoothOn: true,
    permissionGranted: true,
    advertising: false,
    scanning: false,
    advertisingSupported: true,
    detail: 'mock nearby transport',
  };
  started: BleSessionOptions | null = null;
  scanMode: BleScanMode = 'balanced';
  profile: BleDiscoveryProfile = 'standard';
  private readonly peerListeners = new Set<() => void>();

  status(): BleLinkStatus {
    return this.currentStatus;
  }

  listPeers(): BlePeer[] {
    return this.peers;
  }

  onPeersChanged(handler: () => void): () => void {
    this.peerListeners.add(handler);
    return () => this.peerListeners.delete(handler);
  }

  onConnectionChanged(): () => void {
    return () => undefined;
  }

  async startSession(options: BleSessionOptions): Promise<void> {
    this.started = options;
    this.scanMode = options.scanMode;
    this.currentStatus = {
      ...this.currentStatus,
      advertising: true,
      scanning: true,
      detail: 'mock advertising and scanning',
    };
    this.emit();
  }

  async stopSession(): Promise<void> {
    this.started = null;
    this.currentStatus = {
      ...this.currentStatus,
      advertising: false,
      scanning: false,
      detail: 'mock stopped',
    };
    this.emit();
  }

  async setScanMode(mode: BleScanMode): Promise<void> {
    this.scanMode = mode;
  }

  setDiscoveryProfile(profile: BleDiscoveryProfile): void {
    this.profile = profile;
    if (profile === 'event') this.scanMode = 'lowLatency';
    else this.scanMode = 'balanced';
  }

  async requestPermission(): Promise<boolean> {
    return this.currentStatus.permissionGranted && this.currentStatus.bluetoothOn;
  }

  async connect(deviceId: string): Promise<BlePeer> {
    const existing = this.peers.find((peer) => peer.deviceId === deviceId);
    if (!existing) throw new Error('mock peer not found');
    const connected: BlePeer = {
      ...existing,
      sessionEstablished: true,
      lastSeenAt: Date.now(),
    };
    this.peers = this.peers.map((peer) => (peer.deviceId === deviceId ? connected : peer));
    this.emit();
    return connected;
  }

  setPeers(peers: BlePeer[]): void {
    this.peers = peers;
    this.emit();
  }

  emit(): void {
    for (const listener of this.peerListeners) listener();
  }
}

export function mockBlePeer(overrides: Partial<BlePeer> & Pick<BlePeer, 'deviceId'>): BlePeer {
  return {
    displayName: 'HOP user',
    lastSeenAt: Date.now(),
    ...overrides,
  };
}
