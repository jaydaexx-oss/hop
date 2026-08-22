export function buildChatRoute(
  conversationId: string,
  peer: { username: string; id: string },
  extra?: { broadcastId?: string },
): string {
  const qs = new URLSearchParams({
    peer: peer.username,
    peerId: peer.id,
  });
  if (extra?.broadcastId) qs.set('broadcastId', extra.broadcastId);
  return `/chat/${conversationId}?${qs.toString()}`;
}
