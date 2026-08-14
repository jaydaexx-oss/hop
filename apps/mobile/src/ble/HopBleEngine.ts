import {
  BLE_DEFAULT_CHUNK_BYTES,
  BLE_FALLBACK_CHUNK_BYTES,
  BleReassembler,
  HOP_BLE_ACK_UUID,
  HOP_BLE_HANDSHAKE_UUID,
  HOP_BLE_INBOX_UUID,
  HOP_BLE_SERVICE_UUID,
  ProcessedIdSet,
  advertiseLocalName,
  bytesToHex,
  chunkBytes,
  decodeEnvelope,
  decodeHandshake,
  displayNameFromAdvertisement,
  encodeEnvelope,
  encodeHandshake,
  hexToBytes,
  isCryptoBoxPayload,
  PublicKeyTofu,
  sendWithAckRetry,
  decideRelay,
  type AckAttempt,
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
const PEER_STALE_MS = 25_000;
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
  private readonly peers = new Map<string, BlePeer>();
  private readonly connected = new Set<string>();
  private readonly inbound = new Set<
    (envelope: EncryptedEnvelope, from: BlePeer) => void | boolean | Promise<void | boolean>
  >();
  private readonly peerListeners = new Set<() => void>();
  private readonly connectionListeners = new Set<(deviceId: string, connected: boolean) => void>();
  private readonly processed = new ProcessedIdSet();
  readonly tofu = new PublicKeyTofu();
  private readonly reassemblers = new Map<string, BleReassembler>();
  private readonly pendingAcks = new Map<string, () => void>();
  private subscriptions: unknown[] = [];
  private scanOnTimer: ReturnType<typeof setTimeout> | null = null;
  private scanOffTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private detail = 'BLE engine is idle.';

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
    this.bindNativeEvents(native);

    const handshake = encodeHandshake({
      v: 2,
      user_id: options.userId,
      username: options.username,
      pk: options.identityPublicKey,
    });
    await native.setServices([
      {
        uuid: HOP_BLE_SERVICE_UUID,
        characteristics: [
          {
            uuid: HOP_BLE_HANDSHAKE_UUID,
            properties: ['read'],
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

    try {
      await native.startAdvertising({
        serviceUUIDs: [HOP_BLE_SERVICE_UUID],
        localName: advertiseLocalName(options.username),
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
    this.connected.clear();
    this.session = null;
    this.detail = 'Nearby is stopped.';
    this.emitPeers();
  }

  async setScanMode(mode: BleScanMode): Promise<void> {
    this.scanMode = mode;
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
    this.emitConnection(deviceId, true);
    try {
      await native.discoverServices(deviceId);
    } catch {
      /* some stacks discover during connect */
    }
    try {
      await native.requestMTU?.(deviceId, 512);
    } catch {
      /* iOS negotiates MTU internally */
    }
    try {
      await native.subscribeToCharacteristic(deviceId, HOP_BLE_SERVICE_UUID, HOP_BLE_ACK_UUID);
    } catch {
      /* ack notify is best-effort */
    }
    const peer = await this.readHandshake(native, deviceId);
    if (!peer.publicKey) {
      this.connected.delete(deviceId);
      await Promise.resolve(native.disconnect(deviceId)).catch(() => undefined);
      throw new Error('Secure session failed: peer did not publish a libsodium public key.');
    }
    peer.sessionEstablished = true;
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

    const bytes = encodeEnvelope({ ...envelope, transport: 'bluetooth' });
    return sendWithAckRetry(
      async (): Promise<AckAttempt> => {
        const ack = this.waitForAck(envelope.message_id);
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

  private waitForAck(messageId: string): Promise<void> {
    return new Promise((resolve) => {
      this.pendingAcks.set(messageId, resolve);
    });
  }

  private async readHandshake(native: NativeBle, deviceId: string): Promise<BlePeer> {
    const existing = this.peers.get(deviceId);
    try {
      const raw = await native.readCharacteristic(deviceId, HOP_BLE_SERVICE_UUID, HOP_BLE_HANDSHAKE_UUID);
      const hex = typeof raw === 'string' ? raw : raw.value;
      const handshake = decodeHandshake(hex);
      if (handshake) {
        if (handshake.user_id && handshake.pk && !this.tofu.bind(handshake.user_id, handshake.pk)) {
          throw new Error('Peer identity key does not match the key already bound to this user.');
        }
        return {
          deviceId,
          displayName: handshake.username,
          userId: handshake.user_id,
          publicKey: handshake.pk,
          sessionEstablished: true,
          rssi: existing?.rssi,
          lastSeenAt: Date.now(),
        };
      }
    } catch {
      /* fall through to advertisement name */
    }
    return {
      deviceId,
      displayName: existing?.displayName ?? 'HOP user',
      userId: existing?.userId,
      rssi: existing?.rssi,
      lastSeenAt: Date.now(),
    };
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
        if (characteristicUUID !== HOP_BLE_INBOX_UUID) return;
        const centralId = String(payload.centralId ?? 'unknown');
        const value = String(payload.value ?? '');
        this.handleInboxWrite(centralId, value).catch(() => undefined);
      }),
    );
    this.subscriptions.push(
      native.addEventListener('characteristicValueChanged', (payload) => {
        const characteristicUUID = String(payload.characteristicUUID ?? '').toLowerCase();
        if (characteristicUUID !== HOP_BLE_ACK_UUID) return;
        const hex = String(payload.value ?? '');
        try {
          const messageId = new TextDecoder().decode(hexToBytes(hex));
          const pending = this.pendingAcks.get(messageId);
          if (pending) {
            this.pendingAcks.delete(messageId);
            pending();
          }
        } catch {
          /* ignore malformed ack */
        }
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
    if (!device?.id) return;
    const uuids = (device.serviceUUIDs ?? []).map((uuid) => uuid.toLowerCase());
    if (uuids.length > 0 && !uuids.includes(HOP_BLE_SERVICE_UUID)) return;
    const existing = this.peers.get(device.id);
    const displayName = displayNameFromAdvertisement(device.localName, device.name);
    this.peers.set(device.id, {
      deviceId: device.id,
      displayName: existing?.userId ? existing.displayName : displayName,
      userId: existing?.userId,
      publicKey: existing?.publicKey,
      sessionEstablished: existing?.sessionEstablished,
      rssi: typeof device.rssi === 'number' ? device.rssi : existing?.rssi,
      lastSeenAt: Date.now(),
    });
    this.emitPeers();
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

    const peer: BlePeer = this.peers.get(centralId) ?? {
      deviceId: centralId,
      displayName: 'HOP user',
      lastSeenAt: Date.now(),
    };
    if (this.processed.has(envelope.message_id)) {
      await this.notifyAck(native, envelope.message_id);
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
      await this.notifyAck(native, envelope.message_id);
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
    await this.notifyAck(native, envelope.message_id);
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

  private async notifyAck(native: NativeBle, messageId: string): Promise<void> {
    try {
      await native.updateCharacteristicValue?.(
        HOP_BLE_SERVICE_UUID,
        HOP_BLE_ACK_UUID,
        bytesToHex(new TextEncoder().encode(messageId)),
        true,
      );
    } catch {
      /* ack notify is best-effort */
    }
  }

  private startDutyCycle(native: NativeBle): void {
    this.clearScanTimers();
    const pulse = async () => {
      if (!this.session) return;
      try {
        await native.startScan({
          serviceUUIDs: [HOP_BLE_SERVICE_UUID],
          allowDuplicates: true,
          scanMode: this.scanMode,
        });
        this.scanning = true;
      } catch (err) {
        this.scanning = false;
        this.detail = `Scan failed: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }
      this.scanOnTimer = setTimeout(() => {
        native.stopScan?.();
        this.scanning = false;
        this.scanOffTimer = setTimeout(() => {
          pulse().catch(() => undefined);
        }, SCAN_OFF_MS);
      }, SCAN_ON_MS);
    };
    pulse().catch(() => undefined);
  }

  private pruneStalePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (this.connected.has(id)) continue;
      if (now - peer.lastSeenAt > PEER_STALE_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
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
