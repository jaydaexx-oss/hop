import type { HopMessage } from "./message.js";

export type TransportId = "internet" | "bluetooth" | "relay" | "local";

export type NetworkStatus =
  | "Online"
  | "Nearby"
  | "Offline"
  | "Queued"
  | "Relaying"
  | "Synchronizing";

export interface EncryptedEnvelope {
  message_id: string;
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  encrypted_payload: string;
  created_at: string;
  expires_at: string;
  ttl: number;
  hop_count: number;
  transport: TransportId;
}

export interface SendResult {
  ok: boolean;
  transport: TransportId;
  error?: string;
}

export interface TransportRuntimeStatus {
  id: TransportId;
  available: boolean;
  implemented: boolean;
  detail: string;
}

export interface Transport {
  readonly id: TransportId;
  isAvailable(): Promise<boolean>;
  send(envelope: EncryptedEnvelope): Promise<SendResult>;
  subscribe(handler: (envelope: EncryptedEnvelope) => void): () => void;
  status(): TransportRuntimeStatus;
  queuedCount?(): number;
}

export function toEnvelope(message: HopMessage): EncryptedEnvelope {
  return {
    message_id: message.message_id,
    sender_id: message.sender_id,
    recipient_id: message.recipient_id,
    conversation_id: message.conversation_id,
    encrypted_payload: message.encrypted_payload,
    created_at: message.created_at,
    expires_at: message.expires_at,
    ttl: message.ttl,
    hop_count: message.hop_count,
    transport: message.transport,
  };
}
