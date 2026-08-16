import { api, type Conversation } from '@/src/api/hop';
import { localDirectConversationId } from '@hop/protocol';

export type ConversationCache = {
  listCached: () => Promise<Conversation[]>;
  cache: (conversation: Conversation) => Promise<void>;
};

function withPeerKey(conversation: Conversation, peerPublicKey?: string): Conversation {
  if (!peerPublicKey) return conversation;
  return {
    ...conversation,
    peer: {
      ...conversation.peer,
      identity_public_key: peerPublicKey || conversation.peer.identity_public_key,
    },
  };
}

/**
 * Open the normal HOP 1:1 conversation for a Nearby peer.
 * Prefers the internet conversation API when reachable so BLE and internet share one thread.
 */
export async function openOrCreatePeerConversation(input: {
  token: string | null;
  myId: string;
  peerUserId: string;
  peerUsername: string;
  peerPublicKey?: string;
  cache: ConversationCache;
}): Promise<Conversation> {
  const username = input.peerUsername.trim();
  const canCreateByUsername = Boolean(username) && username !== 'HOP user';

  if (input.token && canCreateByUsername) {
    try {
      const remote = await api.createConversation(input.token, username);
      const merged = withPeerKey(
        {
          ...remote,
          peer: { ...remote.peer, id: remote.peer.id || input.peerUserId },
        },
        input.peerPublicKey,
      );
      await input.cache.cache(merged);
      return merged;
    } catch {
      /* offline or the username is not on the server yet */
    }
  }

  const cached = await input.cache.listCached();
  const existing =
    cached.find((row) => row.peer.id === input.peerUserId) ??
    (canCreateByUsername ? cached.find((row) => row.peer.username === username) : undefined);
  if (existing) {
    const merged = withPeerKey(
      {
        ...existing,
        peer: {
          ...existing.peer,
          id: existing.peer.id || input.peerUserId,
          username: canCreateByUsername ? username : existing.peer.username,
        },
      },
      input.peerPublicKey,
    );
    await input.cache.cache(merged);
    return merged;
  }

  const local: Conversation = {
    id: localDirectConversationId(input.myId, input.peerUserId),
    created_at: new Date().toISOString(),
    peer: {
      id: input.peerUserId,
      username: canCreateByUsername ? username : 'HOP user',
      identity_public_key: input.peerPublicKey ?? '',
    },
  };
  await input.cache.cache(local);
  return local;
}
