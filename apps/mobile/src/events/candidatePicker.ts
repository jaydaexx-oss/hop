import type { AroundUsPeer } from '@/src/nearby/types';
import type { Conversation } from '@/src/api/hop';

export type EventPickerCandidate = {
  userId: string;
  username: string;
  source: 'nearby' | 'contacts' | 'recent';
  hasAvatar?: boolean;
};

export function eventPickerCandidates(input: {
  selfId: string;
  nearby: AroundUsPeer[];
  acceptedIds: Iterable<string>;
  conversations: Conversation[];
}): EventPickerCandidate[] {
  const out = new Map<string, EventPickerCandidate>();
  for (const peer of input.nearby) {
    if (!peer.userId || peer.userId === input.selfId) continue;
    const username = peer.displayName.trim();
    if (!username || username === 'HOP user') continue;
    out.set(peer.userId, { userId: peer.userId, username, source: 'nearby' });
  }
  const accepted = new Set(input.acceptedIds);
  for (const convo of input.conversations) {
    if (convo.kind === 'event') continue;
    const id = convo.peer.id;
    const username = convo.peer.username.trim();
    if (!id || id === input.selfId || !username || username === 'HOP user') continue;
    const source = accepted.has(id) ? 'contacts' : 'recent';
    if (!out.has(id) || source === 'contacts') {
      out.set(id, {
        userId: id,
        username,
        source,
        hasAvatar: convo.peer.has_avatar,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.username.localeCompare(b.username));
}

export function filterEventPickerCandidates(
  candidates: EventPickerCandidate[],
  query: string,
): EventPickerCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((row) => row.username.toLowerCase().includes(q));
}
