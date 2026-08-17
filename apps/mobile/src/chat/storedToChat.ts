import { isCryptoBoxPayload, type StoredMessage } from '@hop/protocol';

import type { ChatMessage } from '@/src/api/hop';

export function storedToChat(row: StoredMessage): ChatMessage {
  return {
    message_id: row.message_id,
    sender_id: row.sender_id,
    recipient_id: row.recipient_id,
    conversation_id: row.conversation_id,
    text: row.text,
    status: row.status,
    created_at: row.created_at,
    e2ee: isCryptoBoxPayload(row.encrypted_payload),
    encrypted_payload: row.encrypted_payload,
    kind: row.kind ?? undefined,
    duration_ms: row.duration_ms,
    mime: row.mime,
    audio_b64: row.audio_b64,
    retry_attempts: row.retry_attempts,
    send_seq: row.send_seq ?? null,
  };
}
