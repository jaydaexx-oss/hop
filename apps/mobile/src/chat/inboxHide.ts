import { inboxThreadClearPolicy } from '@hop/protocol';

import type { KvStore } from '@/src/nearby/types';

const PREFIX = 'hop.inbox.hidden.';

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

export async function loadHiddenInboxIds(store: KvStore, userId: string): Promise<string[]> {
  return parseIds(await store.get(`${PREFIX}${userId}`));
}

export async function hideInboxConversation(store: KvStore, userId: string, conversationId: string): Promise<void> {
  const policy = inboxThreadClearPolicy({ hasUndeliveredOutbox: true });
  if (policy.deletesSqlite) return;
  const ids = new Set(await loadHiddenInboxIds(store, userId));
  ids.add(conversationId);
  await store.set(`${PREFIX}${userId}`, JSON.stringify([...ids]));
}

export async function restoreInboxConversation(
  store: KvStore,
  userId: string,
  conversationId: string,
): Promise<void> {
  const ids = (await loadHiddenInboxIds(store, userId)).filter((id) => id !== conversationId);
  await store.set(`${PREFIX}${userId}`, JSON.stringify(ids));
}
