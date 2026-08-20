import { requirePeerRecipient, type MessageService, type StoredMessage } from '@hop/protocol';

/**
 * Production send path for Chat and Nearby: always MessageService (crypto_box + TransportManager).
 * Nearby must call this after openOrCreatePeerConversation — never engine.send / sendTestPayload.
 */
export async function sendChatText(
  service: MessageService,
  input: {
    conversation_id: string;
    sender_id: string;
    recipient_id: string;
    text: string;
    message_id?: string;
    send_seq?: number;
    onAllocated?: (row: StoredMessage) => void;
  },
): Promise<StoredMessage> {
  const recipient_id = requirePeerRecipient(input.sender_id, input.recipient_id);
  return service.sendText({ ...input, recipient_id });
}

export async function sendEventChatText(
  service: MessageService,
  input: {
    conversation_id: string;
    sender_id: string;
    recipient_ids: readonly string[];
    text: string;
    archived?: boolean;
    onAllocated?: (row: StoredMessage) => void;
  },
): Promise<StoredMessage> {
  return service.sendEventText(input);
}

export async function sendChatVoice(
  service: MessageService,
  input: {
    conversation_id: string;
    sender_id: string;
    recipient_id: string;
    audio_b64: string;
    duration_ms: number;
    mime?: string;
  },
): Promise<StoredMessage> {
  const recipient_id = requirePeerRecipient(input.sender_id, input.recipient_id);
  return service.sendVoice({ ...input, recipient_id });
}
