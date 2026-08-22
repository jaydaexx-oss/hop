import {
  SafetyError,
  planBroadcastReply,
  viewBroadcastCreatesConversation,
  type NearbyBroadcast,
  type SafetyService,
} from '@hop/protocol';

import { buildChatRoute } from '@/src/chat/chatRoute';
import { openPeerThread, type PeerThreadKind } from '@/src/chat/openPeerThread';
import type { Conversation } from '@/src/api/hop';
import type { ConversationCache } from '@/src/chat/openPeerConversation';

export { viewBroadcastCreatesConversation };

export async function replyToBroadcast(input: {
  post: NearbyBroadcast;
  selfId: string;
  blockedIds: Iterable<string>;
  token: string | null;
  peerPublicKey?: string;
  cache: ConversationCache;
  safety: SafetyService | null;
}): Promise<{ conversation: Conversation; kind: PeerThreadKind; broadcastId: string; publicPost: false }> {
  const plan = planBroadcastReply(input.post, { selfId: input.selfId, blockedIds: input.blockedIds });
  if (plan.action !== 'open_private_chat') {
    if (plan.reason === 'blocked') throw new SafetyError('blocked');
    throw new Error(plan.reason === 'own_post' ? 'That is your broadcast.' : 'Cannot reply to this broadcast.');
  }
  const thread = await openPeerThread({
    token: input.token,
    myId: input.selfId,
    peerUserId: plan.authorId,
    peerUsername: plan.displayName,
    peerPublicKey: input.peerPublicKey,
    cache: input.cache,
    safety: input.safety,
  });
  return {
    conversation: thread.conversation,
    kind: thread.kind,
    broadcastId: plan.broadcastId,
    publicPost: false,
  };
}

export function broadcastReplyRoute(conversation: Conversation, broadcastId: string): string {
  return buildChatRoute(conversation.id, conversation.peer, { broadcastId });
}
