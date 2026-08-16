export { createMessageId } from "./ids.js";
export {
  DEFAULT_TTL_MS,
  MAX_HOPS,
  MessageStatus,
  createMessage,
  formatMessageStatus,
  isExpired,
  shouldStopForwarding,
  type CreateMessageInput,
  type HopMessage,
} from "./message.js";
export {
  ALLOWED_TRANSITIONS,
  IllegalStateTransitionError,
  canTransition,
  transition,
} from "./stateMachine.js";
export { ProcessedIdSet } from "./duplicates.js";
export { DEFAULT_RETRY_POLICY, nextBackoffMs, type RetryPolicy } from "./retry.js";
export {
  toEnvelope,
  type EncryptedEnvelope,
  type NetworkStatus,
  type SendResult,
  type Transport,
  type TransportId,
  type TransportRuntimeStatus,
} from "./transport.js";
export { LocalTransport } from "./localTransport.js";
export { InternetTransport, createInternetTransport } from "./internetTransport.js";
export type { HopHttpClient } from "./http.js";
export { createRelayTransport } from "./stubTransports.js";
export { createBluetoothTransport, BluetoothTransport, type BlePayloadPreparer } from "./bluetoothTransport.js";
export type { BleLink, BleLinkStatus, BlePeer, BleScanMode, BleSessionOptions } from "./bleLink.js";
export {
  BLE_DEFAULT_CHUNK_BYTES,
  BLE_FALLBACK_CHUNK_BYTES,
  HOP_BLE_ACK_UUID,
  HOP_BLE_HANDSHAKE_UUID,
  HOP_BLE_INBOX_UUID,
  HOP_BLE_SERVICE_UUID,
  BleReassembler,
  advertiseLocalName,
  bytesToHex,
  chunkBytes,
  decodeEnvelope,
  decodeHandshake,
  displayNameFromAdvertisement,
  encodeEnvelope,
  encodeHandshake,
  hexToBytes,
  type BleHandshake,
} from "./bleCodec.js";
export { TransportManager, defaultTransportManager, LIVE_TRANSPORT_PRIORITY, type QueueItem } from "./transportManager.js";
export {
  HopSqliteStore,
  SCHEMA_SQL,
  type OutboundRow,
  type SqliteDriver,
  type StoredConversation,
  type StoredMessage,
} from "./store.js";
export { MessageService, type MessageCrypto, type SendTextInput, type SendVoiceInput } from "./messageService.js";
export {
  DEFAULT_VOICE_CAPTION,
  DEFAULT_VOICE_CODEC,
  DEFAULT_VOICE_MIME,
  MAX_ENCRYPTED_PAYLOAD_BYTES,
  MAX_VOICE_AUDIO_B64_CHARS,
  MAX_VOICE_DURATION_MS,
  assertEncryptedPayloadSize,
  assertVoiceFitsBudget,
  estimateBoxedPayloadBytes,
  voiceAudioB64,
  withDecryptedPlain,
} from "./voice.js";
export { PublicKeyTofu } from "./tofu.js";
export { encodeUnencryptedText, decodeUnencryptedText } from "./payload.js";
export {
  CRYPTO_BOX_ALG,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  isCryptoBoxPayload,
  parseCryptoBoxPayload,
  readySodium,
  type ApplicationKind,
  type ApplicationPlaintext,
  type CryptoBoxPayload,
  type DecryptOptions,
  type IdentityKeyPair,
} from "./cryptoBox.js";
export { sendWithAckRetry, type AckAttempt } from "./ackRetry.js";
export {
  chooseNextHop,
  decideRelay,
  forwardedEnvelope,
  visitedPath,
  type RelayDecision,
  type RelayDropReason,
} from "./relayPolicy.js";
export { SimulatedNetwork, type SimEvent, type SimulatedNode } from "./simulatedNetwork.js";
