import { SafetyError, type PeerSafetyRecord, type SafetyService } from '@hop/protocol';

import { openOrCreatePeerConversation, type ConversationCache } from '@/src/chat/openPeerConversation';
import { buildChatRoute } from '@/src/chat/chatRoute';
import type { Conversation } from '@/src/api/hop';

export type PeerThreadKind = 'chat' | 'request';

export async function openPeerThread(input: {
  token: string | null;
  myId: string;
  peerUserId: string;
  peerUsername: string;
  peerPublicKey?: string;
  cache: ConversationCache;
  safety: SafetyService | null;
}): Promise<{ conversation: Conversation; kind: PeerThreadKind; record: PeerSafetyRecord | null }> {
  if (input.safety && (await input.safety.isBlocked(input.peerUserId))) {
    throw new SafetyError('blocked');
  }
  const conversation = await openOrCreatePeerConversation({
    token: input.token,
    myId: input.myId,
    peerUserId: input.peerUserId,
    peerUsername: input.peerUsername,
    peerPublicKey: input.peerPublicKey,
    cache: input.cache,
  });
  const record = input.safety ? await input.safety.get(input.peerUserId) : null;
  const kind: PeerThreadKind = record?.relationship === 'accepted' ? 'chat' : 'request';
  return { conversation, kind, record };
}

export function chatRoute(conversation: Conversation, extra?: { broadcastId?: string }): string {
  return buildChatRoute(conversation.id, conversation.peer, extra);
}
