import { useEffect, useRef } from 'react';

import { wsUrl, type ChatMessage } from '@/src/api/hop';

export function useHopSocket(
  token: string | null,
  onEvent: (event: { type: string; message?: ChatMessage; event_id?: string }) => void,
) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!token) return;
    const socket = new WebSocket(wsUrl());
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token }));
    };
    socket.onmessage = (event) => {
      try {
        handler.current(JSON.parse(String(event.data)));
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => socket.close();
  }, [token]);
}
