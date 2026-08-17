import { useCallback, useEffect, useState } from 'react';
import { messagesTabBadgeCount } from '@hop/protocol';

import { createPersistentKv } from '@/src/nearby/kvStore';
import { useAuth } from '@/src/auth/AuthProvider';
import { useOffline } from '@/src/offline/OfflineProvider';

import { loadHiddenInboxIds } from './inboxHide';

const hideKv = createPersistentKv();

/** Unread chats (minus locally hidden) + inbound message requests. */
export function useMessagesTabBadge(): number {
  const { user } = useAuth();
  const { service, safety } = useOffline();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setCount(0);
      return;
    }
    const hidden = new Set(await loadHiddenInboxIds(hideKv, user.id));
    let unread = 0;
    if (service) {
      const inbox = await service.listInbox(user.id);
      for (const row of inbox) {
        if (hidden.has(row.id)) continue;
        unread += row.unread;
      }
    }
    let pendingIncomingRequests = 0;
    if (safety) {
      const requests = await safety.listRequests();
      pendingIncomingRequests = requests.filter((row) => row.relationship === 'incoming_request').length;
    }
    setCount(messagesTabBadgeCount({ unread, pendingIncomingRequests }));
  }, [safety, service, user]);

  useEffect(() => {
    refresh().catch(() => undefined);
    if (!safety) return;
    return safety.onChange(() => {
      refresh().catch(() => undefined);
    });
  }, [refresh, safety]);

  useEffect(() => {
    const id = setInterval(() => {
      refresh().catch(() => undefined);
    }, 4_000);
    return () => clearInterval(id);
  }, [refresh]);

  return count;
}
