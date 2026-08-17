import {
  BLE_DEFAULT_CHUNK_BYTES,
  BLE_FALLBACK_CHUNK_BYTES,
  BLE_SESSION_IDLE_MS,
  BleReassembler,
  HandshakeReplayGuard,
  HOP_BLE_ACK_UUID,
  HOP_BLE_HANDSHAKE_UUID,
  HOP_BLE_INBOX_UUID,
  HOP_BLE_SERVICE_UUID,
  ProcessedIdSet,
  advertiseLocalName,
  sanitizeAdvertisementDiscoveryId,
  bleSendRefusal,
  bleSessionStale,
  bytesToHex,
  chunkBytes,
  decodeEnvelope,
  decodeHandshakeAnnouncement,
  displayNameFromAdvertisement,
  encodeEnvelope,
  encodeAuthenticatedHandshake,
  encodeHandshakeAnnouncement,
  encodeAuthenticatedBleAck,
  hexToBytes,
  isCryptoBoxPayload,
  isUnauthenticatedBleAck,
  newAuthHandshakeNonce,
  parseCryptoBoxPayload,
  PublicKeyTofu,
  sendWithAckRetry,
  decideRelay,
  verifyAuthenticatedBleAck,
  verifyAuthenticatedHandshake,
  type AckAttempt,
  type BleDiagnosticsSnapshot,
  type BleHandshakePhase,
  type BleLink,
  type BleLinkStatus,
  type BlePeer,
  type BleScanMode,
  type BleSessionOptions,
  type EncryptedEnvelope,
  type SendResult,
} from '@hop/protocol';

import { bleRuntimeBlockedReason, loadNativeBle } from './loadNative';
import { unsubscribe, type NativeBle, type NativeDevice } from './nativeTypes';

const SCAN_ON_MS = 12_000;
const SCAN_OFF_MS = 8_000;
const EVENT_SCAN_ON_MS = 8_000;
const EVENT_SCAN_OFF_MS = 2_000;
const PEER_STALE_MS = 25_000;

export type BleDiscoveryProfile = 'standard' | 'event';

const ACK_TIMEOUT_MS = 8_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class HopBleEngine implements BleLink {
  private native: NativeBle | null = null;
  private session: BleSessionOptions | null = null;
  private permissionGranted = false;
  private bluetoothOn = false;
  private advertising = false;
  private scanning = false;
  private advertisingSupported = true;
  private scanMode: BleScanMode = 'lowPower';
  private discoveryProfile: BleDiscoveryProfile = 'standard';
  private scanOnMs = SCAN_ON_MS;
  private scanOffMs = SCAN_OFF_MS;
  private readonly peers = new Map<string, BlePeer>();
  private readonly connected = new Set<string>();
  private readonly inbound = new Set<
    (envelope: EncryptedEnvelope, from: BlePeer) => void | boolean | Promise<void | boolean>
  >();
  private readonly peerListeners = new Set<() => void>();
  private readonly connectionListeners = new Set<(deviceId: string, connected: boolean) => void>();
  private readonly processed = new ProcessedIdSet();
  tofu: PublicKeyTofu;
  private readonly serverKeyCache = new Map<string, string>();
  private readonly reassemblers = new Map<string, BleReassembler>();
  private readonly handshakeReplay = new HandshakeReplayGuard();
  private handshakeNonce = '';
  private handshakeTs = 0;
  private readonly pendingHandshake = new Map<string, { resolve: (raw: string) => void; reject: (err: Error) => void }>();
  private readonly sessionActivity = new Map<string, number>();
  private readonly pendingAcks = new Map<
    string,
    { resolve: () => void; from: string; peerPublicKey: string }
  >();
  private subscriptions: unknown[] = [];
  private scanOnTimer: ReturnType<typeof setTimeout> | null = null;
  private scanOffTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private dutyGen = 0;
  private detail = 'BLE engine is idle.';
  private gattRegistered = false;
  private lastMtu: number | null = null;
  private handshakePhase: BleHandshakePhase = 'idle';

  constructor(tofu?: PublicKeyTofu) {
    this.tofu = tofu ?? new PublicKeyTofu();
  }

  setTofu(tofu: PublicKeyTofu): void {
    this.tofu = tofu;
  }

  status(): BleLinkStatus {
    const blocked = bleRuntimeBlockedReason();
    return {
      implemented: Boolean(this.native),
      bluetoothOn: this.bluetoothOn,
      permissionGranted: this.permissionGranted,
      advertising: this.advertising,
      scanning: this.scanning,
      advertisingSupported: this.advertisingSupported,
      detail: blocked ?? this.detail,
    };
  }

  async requestPermission(): Promise<boolean> {
    const native = await this.ensureNative();
    if (!native) return false;
    this.permissionGranted = await native.requestBluetoothPermission();
    this.bluetoothOn = await native.isBluetoothEnabled();
    try {
      const caps = await native.getCapabilities?.();
      if (caps) this.advertisingSupported = caps.peripheralAdvertising !== false;
    } catch {
      /* capabilities are optional */
    }
    this.detail = this.permissionGranted
      ? this.bluetoothOn
        ? 'Bluetooth permission granted.'
        : 'Turn on Bluetooth to use Nearby.'
      : 'Bluetooth permission was denied.';
    this.emitPeers();
    return this.permissionGranted && this.bluetoothOn;
  }

  diagnosticsSnapshot(): BleDiagnosticsSnapshot {
    const blocked = bleRuntimeBlockedReason();
    const connectedPeerCount = this.connected.size;
    const authenticated = [...this.peers.values()].some(
      (peer) => peer.sessionEstablished === true && this.connected.has(peer.deviceId),
    );
    let handshakeState = this.handshakePhase;
    if (authenticated) handshakeState = 'authenticated';
    return {
      permissionGranted: this.permissionGranted,
      adapterOn: this.bluetoothOn,
      advertising: this.advertising,
      scanning: this.scanning,
      gattRegistered: this.gattRegistered,
      connected: connectedPeerCount > 0,
      connectedPeerCount,
      mtu: this.lastMtu,
      handshakeState,
      nativeImplemented: Boolean(this.native),
      blockedReason: blocked,
    };
  }

  async startSession(options: BleSessionOptions): Promise<void> {
    const native = await this.ensureNative();
    if (!native) {
      throw new Error(bleRuntimeBlockedReason() ?? 'Native BLE module is unavailable.');
    }
    const allowed = await this.requestPermission();
    if (!allowed) {
      throw new Error(this.detail);
    }
    if (!options.identityPublicKey) {
      throw new Error('Secure session requires a libsodium public key.');
    }
    await this.stopSession();
    this.session = options;
    this.scanMode = options.scanMode;
    if (this.discoveryProfile === 'event') {
      this.scanOnMs = EVENT_SCAN_ON_MS;
      this.scanOffMs = EVENT_SCAN_OFF_MS;
      if (options.scanMode === 'balanced' || options.scanMode === 'lowPower') {
        this.scanMode = 'lowLatency';
      }
    }
    this.bindNativeEvents(native);
    this.handshakeNonce = await newAuthHandshakeNonce();
    this.handshakeTs = Date.now();

    const handshake = encodeHandshakeAnnouncement({
      v: 3,
      user_id: options.userId,
      username: options.username,
      pk: options.identityPublicKey,
      n: this.handshakeNonce,
      ts: this.handshakeTs,
    });
    await native.setServices([
      {
        uuid: HOP_BLE_SERVICE_UUID,
        characteristics: [
          {
            uuid: HOP_BLE_HANDSHAKE_UUID,
            properties: ['read', 'write'],
            value: handshake,
          },
          {
            uuid: HOP_BLE_INBOX_UUID,
            properties: ['write', 'writeWithoutResponse'],
            value: '',
          },
          {
            uuid: HOP_BLE_ACK_UUID,
            properties: ['read', 'notify'],
            value: '',
          },
        ],
      },
    ]);
    this.gattRegistered = true;
    this.handshakePhase = 'announced';

    try {
      await native.startAdvertising({
        serviceUUIDs: [HOP_BLE_SERVICE_UUID],
        localName: advertiseLocalName(sanitizeAdvertisementDiscoveryId(options.discoveryId)),
      });
      this.advertising = true;
      this.advertisingSupported = true;
    } catch (err) {
      this.advertising = false;
      this.advertisingSupported = false;
      this.detail = `Advertising failed: ${err instanceof Error ? err.message : String(err)}. Scanning may still work if the other phone advertises.`;
    }

    this.startDutyCycle(native);
    this.staleTimer = setInterval(() => this.pruneStalePeers(), 5_000);
    if (this.advertising) {
      this.detail = 'Nearby is advertising and scanning in the foreground.';
    }
  }

  async stopSession(): Promise<void> {
    this.clearTimers();
    const native = this.native;
    if (native) {
      try {
        await native.stopScan();
      } catch {
        /* already stopped */
      }
      try {
        await native.stopAdvertising();
      } catch {
        /* already stopped */
      }
      for (const deviceId of [...this.connected]) {
        try {
          await native.disconnect(deviceId);
        } catch {
          /* ignore */
        }
      }
    }
    for (const handle of this.subscriptions) unsubscribe(handle);
    this.subscriptions = [];
    this.scanning = false;
    this.advertising = false;
    this.gattRegistered = false;
    this.lastMtu = null;
    this.handshakePhase = 'idle';
    this.connected.clear();
    this.session = null;
    this.peers.clear();
    this.reassemblers.clear();
    this.sessionActivity.clear();
    this.pendingHandshake.clear();
    this.detail = 'Nearby is stopped.';
    this.emitPeers();
  }

  async setScanMode(mode: BleScanMode): Promise<void> {
    this.scanMode = mode;
    if (!this.session || !this.native) return;
    this.startDutyCycle(this.native);
  }

  /**
   * Faster scan/advertise duty cycle for Event Mode UX only.
   * Does not change handshake, crypto_box, or TOFU.
   */
  setDiscoveryProfile(profile: BleDiscoveryProfile): void {
    this.discoveryProfile = profile;
    if (profile === 'event') {
      this.scanOnMs = EVENT_SCAN_ON_MS;
      this.scanOffMs = EVENT_SCAN_OFF_MS;
      this.scanMode = 'lowLatency';
    } else {
      this.scanOnMs = SCAN_ON_MS;
      this.scanOffMs = SCAN_OFF_MS;
      this.scanMode = 'balanced';
    }
    if (!this.session || !this.native) return;
    this.startDutyCycle(this.native);
  }

  listPeers(): BlePeer[] {
    return [...this.peers.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  async connect(deviceId: string, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<BlePeer> {
    const native = await this.ensureNative();
    if (!native) throw new Error('Native BLE module is unavailable.');
    await withTimeout(native.connect(deviceId), timeoutMs, 'BLE connect');
    this.connected.add(deviceId);
    this.handshakePhase = 'authenticating';
    this.emitConnection(deviceId, true);
    try {
      await native.discoverServices(deviceId);
    } catch {
      /* some stacks discover during connect */
    }
    try {
      const mtu = await native.requestMTU?.(deviceId, 512);
      if (typeof mtu === 'number' && Number.isFinite(mtu) && mtu > 0) {
        this.lastMtu = mtu;
      }
    } catch {
      /* iOS negotiates MTU internally */
    }
    try {
      await native.subscribeToCharacteristic(deviceId, HOP_BLE_SERVICE_UUID, HOP_BLE_ACK_UUID);
    } catch {
      /* ack notify is best-effort */
    }
    try {
      await native.subscribeToCharacteristic(deviceId, HOP_BLE_SERVICE_UUID, HOP_BLE_HANDSHAKE_UUID);
    } catch {
      /* handshake notify used for authenticated proof */
    }
    let peer: BlePeer;
    try {
      peer = await this.establishAuthenticatedSession(native, deviceId);
    } catch (err) {
      this.handshakePhase = 'failed';
      this.connected.delete(deviceId);
      await Promise.resolve(native.disconnect(deviceId)).catch(() => undefined);
      throw err;
    }
    if (!peer.publicKey || !peer.sessionEstablished) {
      this.handshakePhase = 'failed';
      this.connected.delete(deviceId);
      await Promise.resolve(native.disconnect(deviceId)).catch(() => undefined);
      throw new Error(peer.userId ? 'Authenticated BLE handshake failed.' : 'Secure session failed: peer did not publish a libsodium public key.');
    }
    this.handshakePhase = 'authenticated';
    this.touchSession(deviceId);
    this.peers.set(deviceId, peer);
    this.emitPeers();
    return peer;
  }

  async disconnect(deviceId: string): Promise<void> {
    if (!this.native) return;
    try {
      await this.native.disconnect(deviceId);
    } finally {
      this.connected.delete(deviceId);
      this.emitConnection(deviceId, false);
    }
  }

  async send(deviceId: string, envelope: EncryptedEnvelope): Promise<SendResult> {
    const native = this.native;
    if (!native) {
      return { ok: false, transport: 'bluetooth', error: 'Native BLE module is unavailable.' };
    }
    if (!envelope.encrypted_payload || !isCryptoBoxPayload(envelope.encrypted_payload)) {
      return { ok: false, transport: 'bluetooth', error: 'Refusing to send empty or unauthenticated payload' };
    }
    if (!this.connected.has(deviceId)) {
      try {
        await this.connect(deviceId);
      } catch (err) {
        return {
          ok: false,
          transport: 'bluetooth',
          error: err instanceof Error ? err.message : 'Connect failed',
        };
      }
    }
    const peer = this.peers.get(deviceId);
    if (!peer?.sessionEstablished || !peer.publicKey) {
      return { ok: false, transport: 'bluetooth', error: 'Secure session is not established' };
    }
    const refused = bleSendRefusal(this.tofu, peer.userId, peer.publicKey);
    if (refused) {
      return { ok: false, transport: 'bluetooth', error: refused };
    }
    if (bleSessionStale(this.sessionActivity.get(deviceId))) {
      return { ok: false, transport: 'bluetooth', error: 'BLE session is stale' };
    }
    this.touchSession(deviceId);

    const bytes = encodeEnvelope({ ...envelope, transport: 'bluetooth' });
    return sendWithAckRetry(
      async (): Promise<AckAttempt> => {
        const ack = this.waitForAck(envelope.message_id, envelope.recipient_id, peer.publicKey!);
        try {
          try {
            await this.writeChunks(native, deviceId, bytes, BLE_DEFAULT_CHUNK_BYTES);
          } catch {
            await this.writeChunks(native, deviceId, bytes, BLE_FALLBACK_CHUNK_BYTES);
          }
        } catch {
          this.pendingAcks.delete(envelope.message_id);
          return 'fail';
        }
        try {
          await withTimeout(ack, ACK_TIMEOUT_MS, 'BLE ack');
          return 'acked';
        } catch {
          this.pendingAcks.delete(envelope.message_id);
          return 'no-ack';
        }
      },
      { retry: { baseMs: 1_000, maxMs: 8_000, maxAttempts: 3 }, timeoutError: 'Delivery ack timed out' },
    );
  }

  subscribe(
    handler: (envelope: EncryptedEnvelope, from: BlePeer) => void | boolean | Promise<void | boolean>,
  ): () => void {
    this.inbound.add(handler);
    return () => this.inbound.delete(handler);
  }

  onPeersChanged(handler: () => void): () => void {
    this.peerListeners.add(handler);
    return () => this.peerListeners.delete(handler);
  }

  onConnectionChanged(handler: (deviceId: string, connected: boolean) => void): () => void {
    this.connectionListeners.add(handler);
    return () => this.connectionListeners.delete(handler);
  }

  isConnected(deviceId: string): boolean {
    return this.connected.has(deviceId);
  }

  setRelayConsent(enabled: boolean): void {
    if (this.session) this.session.relayConsent = enabled;
  }

  private async writeChunks(native: NativeBle, deviceId: string, bytes: Uint8Array, size: number): Promise<void> {
    const frames = chunkBytes(bytes, size);
    for (const frame of frames) {
      await native.writeCharacteristic(
        deviceId,
        HOP_BLE_SERVICE_UUID,
        HOP_BLE_INBOX_UUID,
        bytesToHex(frame),
        'write',
      );
    }
  }

  private waitForAck(messageId: string, from: string, peerPublicKey: string): Promise<void> {
    return new Promise((resolve) => {
      this.pendingAcks.set(messageId, { resolve, from, peerPublicKey });
    });
  }

  private async establishAuthenticatedSession(native: NativeBle, deviceId: string): Promise<BlePeer> {
    const existing = this.peers.get(deviceId);
    const identity = this.session?.ackIdentity;
    if (!identity || !this.session) {
      throw new Error('Secure session requires a local identity secret.');
    }
    const raw = await native.readCharacteristic(deviceId, HOP_BLE_SERVICE_UUID, HOP_BLE_HANDSHAKE_UUID);
    const value = typeof raw === 'string' ? raw : raw.value;
    const announcement = decodeHandshakeAnnouncement(value);
    if (!announcement) {
      throw new Error('Peer BLE handshake is missing authenticated v3 identity.');
    }
    if (!this.tofu.bind(announcement.user_id, announcement.pk)) {
      throw new Error('Peer identity key changed; re-verify before sending');
    }
    await this.verifyServerIdentity(announcement.user_id, announcement.pk);

    const proof = await encodeAuthenticatedHandshake({
      local: identity,
      userId: this.session.userId,
      username: this.session.username,
      nonce: this.handshakeNonce,
      ts: Date.now(),
      peerPublicKey: announcement.pk,
    });
    const inbound = this.waitForHandshakeProof(deviceId);
    await native.writeCharacteristic(
      deviceId,
      HOP_BLE_SERVICE_UUID,
      HOP_BLE_HANDSHAKE_UUID,
      proof,
      'write',
    );
    const peerRaw = await withTimeout(inbound, DEFAULT_CONNECT_TIMEOUT_MS, 'BLE handshake auth');
    const verified = await verifyAuthenticatedHandshake({
      raw: peerRaw,
      local: identity,
      replay: this.handshakeReplay,
      tofu: this.tofu,
    });
    if (!verified.ok) {
      throw new Error(`Authenticated BLE handshake rejected (${verified.reason}).`);
    }
    if (verified.handshake.pk !== announcement.pk || verified.handshake.user_id !== announcement.user_id) {
      throw new Error('Authenticated BLE handshake identity does not match the announcement.');
    }
    return {
      deviceId,
      displayName: verified.handshake.username,
      userId: verified.handshake.user_id,
      publicKey: verified.handshake.pk,
      sessionEstablished: true,
      rssi: existing?.rssi,
      lastSeenAt: Date.now(),
    };
  }

  private waitForHandshakeProof(deviceId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingHandshake.set(deviceId, { resolve, reject });
    });
  }

  private async handleHandshakeWrite(centralId: string, raw: string): Promise<void> {
    const identity = this.session?.ackIdentity;
    const native = this.native;
    if (!identity || !this.session || !native) return;
    const verified = await verifyAuthenticatedHandshake({
      raw,
      local: identity,
      replay: this.handshakeReplay,
      tofu: this.tofu,
    });
    if (!verified.ok) return;
    const existing = this.peers.get(centralId);
    this.peers.set(centralId, {
      deviceId: centralId,
      displayName: verified.handshake.username,
      userId: verified.handshake.user_id,
      publicKey: verified.handshake.pk,
      sessionEstablished: true,
      rssi: existing?.rssi,
      lastSeenAt: Date.now(),
    });
    this.touchSession(centralId);
    this.emitPeers();
    const reply = await encodeAuthenticatedHandshake({
      local: identity,
      userId: this.session.userId,
      username: this.session.username,
      nonce: this.handshakeNonce,
      ts: Date.now(),
      peerPublicKey: verified.handshake.pk,
    });
    await native.updateCharacteristicValue?.(HOP_BLE_SERVICE_UUID, HOP_BLE_HANDSHAKE_UUID, reply, true);
  }

  private async verifyServerIdentity(userId: string, handshakePk: string): Promise<void> {
    const resolver = this.session?.resolveServerPublicKey;
    if (!resolver) return;
    let serverPk = this.serverKeyCache.get(userId);
    if (!serverPk) {
      const fetched = await resolver(userId);
      if (!fetched) {
        throw new Error('Peer has not published an identity key on the server.');
      }
      serverPk = fetched;
      this.serverKeyCache.set(userId, serverPk);
    }
    if (serverPk !== handshakePk) {
      throw new Error('BLE handshake public key does not match the server-published identity key.');
    }
  }

  private bindNativeEvents(native: NativeBle): void {
    const onDevice = (device: NativeDevice) => this.handleDeviceFound(device);
    if (native.addDeviceFoundListener) {
      this.subscriptions.push(native.addDeviceFoundListener(onDevice));
    }
    this.subscriptions.push(
      native.addEventListener('deviceFound', (payload) => onDevice(payload as unknown as NativeDevice)),
    );
    this.subscriptions.push(
      native.addEventListener('deviceDisconnected', (payload) => {
        const deviceId = String(payload.deviceId ?? payload.id ?? '');
        if (!deviceId) return;
        this.connected.delete(deviceId);
        this.emitConnection(deviceId, false);
      }),
    );
    this.subscriptions.push(
      native.addEventListener('peripheralWriteRequest', (payload) => {
        const characteristicUUID = String(payload.characteristicUUID ?? '').toLowerCase();
        const centralId = String(payload.centralId ?? 'unknown');
        const value = String(payload.value ?? '');
        if (characteristicUUID === HOP_BLE_HANDSHAKE_UUID) {
          this.handleHandshakeWrite(centralId, value).catch(() => undefined);
          return;
        }
        if (characteristicUUID !== HOP_BLE_INBOX_UUID) return;
        this.handleInboxWrite(centralId, value).catch(() => undefined);
      }),
    );
    this.subscriptions.push(
      native.addEventListener('characteristicValueChanged', (payload) => {
        const characteristicUUID = String(payload.characteristicUUID ?? '').toLowerCase();
        const hex = String(payload.value ?? '');
        const deviceId = String(payload.deviceId ?? payload.id ?? '');
        if (characteristicUUID === HOP_BLE_HANDSHAKE_UUID) {
          const pending = this.pendingHandshake.get(deviceId) ?? [...this.pendingHandshake.values()][0];
          if (pending) {
            this.pendingHandshake.delete(deviceId);
            pending.resolve(hex);
          }
          return;
        }
        if (characteristicUUID !== HOP_BLE_ACK_UUID) return;
        void this.handleAckNotify(hex);
      }),
    );
    this.subscriptions.push(
      native.addEventListener('advertisingStartFailed', (payload) => {
        this.advertising = false;
        this.advertisingSupported = false;
        this.detail = `Advertising failed: ${String(payload.message ?? payload.error ?? 'platform rejected advertising')}`;
      }),
    );
    this.subscriptions.push(
      native.addEventListener('scanFailed', (payload) => {
        this.scanning = false;
        this.detail = `Scan failed: ${String(payload.message ?? 'unknown')}`;
      }),
    );
  }

  private handleDeviceFound(device: NativeDevice): void {
    try {
      if (!device?.id || typeof device.id !== 'string') return;
      const uuids = (device.serviceUUIDs ?? []).map((uuid) => String(uuid).toLowerCase());
      if (uuids.length > 0 && !uuids.includes(HOP_BLE_SERVICE_UUID)) return;
      const existing = this.peers.get(device.id);
      const displayName = displayNameFromAdvertisement(
        typeof device.localName === 'string' ? device.localName : null,
        typeof device.name === 'string' ? device.name : null,
      );
      const rssi = typeof device.rssi === 'number' && Number.isFinite(device.rssi) ? device.rssi : existing?.rssi;
      this.peers.set(device.id, {
        deviceId: device.id,
        displayName: existing?.sessionEstablished ? existing.displayName : displayName,
        userId: existing?.sessionEstablished ? existing.userId : undefined,
        publicKey: existing?.sessionEstablished ? existing.publicKey : undefined,
        sessionEstablished: existing?.sessionEstablished,
        rssi,
        lastSeenAt: Date.now(),
      });
      this.emitPeers();
    } catch {
      /* malformed native payloads must not crash discovery */
    }
  }

  private async handleInboxWrite(centralId: string, hex: string): Promise<void> {
    const native = this.native;
    if (!native) return;
    let frame: Uint8Array;
    try {
      frame = hexToBytes(hex);
    } catch {
      return;
    }
    let assembler = this.reassemblers.get(centralId);
    if (!assembler) {
      assembler = new BleReassembler();
      this.reassemblers.set(centralId, assembler);
    }
    const complete = assembler.push(frame);
    if (!complete) return;
    const envelope = decodeEnvelope(complete);
    if (!envelope?.encrypted_payload) return;
    if (!isCryptoBoxPayload(envelope.encrypted_payload)) return;
    this.touchSession(centralId);

    const peer: BlePeer = this.peers.get(centralId) ?? {
      deviceId: centralId,
      displayName: 'HOP user',
      lastSeenAt: Date.now(),
    };
    if (this.processed.has(envelope.message_id)) {
      await this.notifyAck(native, envelope);
      return;
    }

    const selfId = this.session?.userId;
    if (selfId && envelope.recipient_id === selfId) {
      let accepted = true;
      for (const handler of this.inbound) {
        try {
          const result = await handler(envelope, peer);
          if (result === false) accepted = false;
        } catch {
          accepted = false;
        }
      }
      if (!accepted) return;
      this.processed.remember(envelope.message_id);
      await this.notifyAck(native, envelope);
      return;
    }

    if (!selfId || !this.session?.relayConsent) return;
    const decision = decideRelay({
      selfId,
      envelope,
      neighbors: this.neighborUserIds(),
      consent: true,
      duplicate: false,
    });
    if (decision.action !== 'relay') return;
    const nextDeviceId = this.deviceIdForUser(decision.nextHop);
    if (!nextDeviceId) return;
    const forwarded = await this.send(nextDeviceId, decision.envelope);
    if (!forwarded.ok) return;
    this.processed.remember(envelope.message_id);
    await this.notifyAck(native, envelope);
  }

  private neighborUserIds(): string[] {
    const ids: string[] = [];
    for (const peer of this.peers.values()) {
      if (peer.userId) ids.push(peer.userId);
    }
    return ids;
  }

  private deviceIdForUser(userId: string): string | null {
    for (const [deviceId, peer] of this.peers) {
      if (peer.userId === userId) return deviceId;
    }
    return null;
  }

  private async handleAckNotify(hex: string): Promise<void> {
    const identity = this.session?.ackIdentity;
    if (!identity) return;
    if (isUnauthenticatedBleAck(hex)) return;
    for (const [messageId, pending] of this.pendingAcks) {
      const ok = await verifyAuthenticatedBleAck(
        hex,
        { message_id: messageId, from: pending.from },
        identity,
        pending.peerPublicKey,
      );
      if (!ok) continue;
      this.pendingAcks.delete(messageId);
      pending.resolve();
      return;
    }
  }

  private async notifyAck(native: NativeBle, envelope: EncryptedEnvelope): Promise<void> {
    const identity = this.session?.ackIdentity;
    const selfId = this.session?.userId;
    const peerPk = parseCryptoBoxPayload(envelope.encrypted_payload)?.sender_pk;
    if (!identity || !selfId || !peerPk) return;
    if (envelope.sender_id && !this.tofu.canEncryptTo(envelope.sender_id, peerPk)) return;
    try {
      const hex = await encodeAuthenticatedBleAck({
        message_id: envelope.message_id,
        from: selfId,
        local: identity,
        peerPublicKey: peerPk,
      });
      await native.updateCharacteristicValue?.(HOP_BLE_SERVICE_UUID, HOP_BLE_ACK_UUID, hex, true);
    } catch {
      /* ack notify is best-effort */
    }
  }

  private startDutyCycle(native: NativeBle): void {
    this.clearScanTimers();
    const gen = ++this.dutyGen;
    try {
      native.stopScan?.();
    } catch {
      /* previous scan may already be stopped */
    }
    this.scanning = false;
    const pulse = async () => {
      if (!this.session || this.dutyGen !== gen) return;
      try {
        await native.startScan({
          serviceUUIDs: [HOP_BLE_SERVICE_UUID],
          allowDuplicates: true,
          scanMode: this.scanMode,
        });
        if (!this.session || this.dutyGen !== gen) {
          try {
            await native.stopScan?.();
          } catch {
            /* ignore */
          }
          this.scanning = false;
          return;
        }
        this.scanning = true;
      } catch (err) {
        if (this.dutyGen !== gen) return;
        this.scanning = false;
        this.detail = `Scan failed: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }
      this.scanOnTimer = setTimeout(() => {
        if (this.dutyGen !== gen) return;
        native.stopScan?.();
        this.scanning = false;
        this.scanOffTimer = setTimeout(() => {
          pulse().catch(() => undefined);
        }, this.scanOffMs);
      }, this.scanOnMs);
    };
    pulse().catch(() => undefined);
  }

  private pruneStalePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (this.connected.has(id)) {
        const last = this.sessionActivity.get(id) ?? peer.lastSeenAt;
        if (now - last > BLE_SESSION_IDLE_MS) {
          this.connected.delete(id);
          this.sessionActivity.delete(id);
          this.reassemblers.delete(id);
          this.emitConnection(id, false);
          void Promise.resolve(this.native?.disconnect(id)).catch(() => undefined);
          changed = true;
        }
        continue;
      }
      if (now - peer.lastSeenAt > PEER_STALE_MS) {
        this.peers.delete(id);
        this.reassemblers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
  }

  private touchSession(deviceId: string): void {
    this.sessionActivity.set(deviceId, Date.now());
  }

  private emitPeers(): void {
    for (const listener of this.peerListeners) listener();
  }

  private emitConnection(deviceId: string, connected: boolean): void {
    for (const listener of this.connectionListeners) listener(deviceId, connected);
  }

  private clearScanTimers(): void {
    if (this.scanOnTimer) clearTimeout(this.scanOnTimer);
    if (this.scanOffTimer) clearTimeout(this.scanOffTimer);
    this.scanOnTimer = null;
    this.scanOffTimer = null;
  }

  private clearTimers(): void {
    this.dutyGen += 1;
    this.clearScanTimers();
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = null;
  }

  private async ensureNative(): Promise<NativeBle | null> {
    if (this.native) return this.native;
    this.native = await loadNativeBle();
    if (!this.native) {
      this.detail = bleRuntimeBlockedReason() ?? 'Native BLE module is missing. Build a development client.';
    }
    return this.native;
  }
}
