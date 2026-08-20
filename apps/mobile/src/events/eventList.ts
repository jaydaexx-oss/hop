import { eventListSection, type EventRowStatus } from '@hop/protocol';

import type { HopEvent } from '@/src/api/hop';

export type EventListBucket = 'active' | 'upcoming' | 'past';

export function remainingMs(event: Pick<HopEvent, 'ends_at'>, now = Date.now()): number {
  const ends = Date.parse(event.ends_at);
  if (!Number.isFinite(ends)) return 0;
  return Math.max(0, ends - now);
}

export function eventWhenLabel(event: HopEvent, now = Date.now()): string {
  if (event.status === 'ended' || event.row_status === 'ended') return 'Ended';
  if (event.status === 'upcoming') {
    const starts = Date.parse(event.starts_at);
    if (!Number.isFinite(starts)) return 'Upcoming';
    const delta = starts - now;
    if (delta <= 0) return 'Starting';
    const minutes = Math.ceil(delta / 60_000);
    if (minutes < 60) return `Starts in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `Starts in ${hours}h`;
  }
  const left = remainingMs(event, now);
  if (left <= 0) return 'Ending';
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m left` : `${hours}h left`;
}

export function eventStatusLabel(status: EventRowStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'upcoming') return 'Upcoming';
  if (status === 'invited') return 'Invited';
  return 'Ended';
}

export function groupEvents(events: HopEvent[]): Record<EventListBucket, HopEvent[]> {
  const out: Record<EventListBucket, HopEvent[]> = { active: [], upcoming: [], past: [] };
  for (const event of events) {
    out[eventListSection(event.row_status)].push(event);
  }
  return out;
}

export function eventChatRoute(event: HopEvent): string {
  return `/chat/${event.conversation_id}?peer=${encodeURIComponent(event.name)}&peerId=${encodeURIComponent(event.host.id)}&kind=event&eventId=${encodeURIComponent(event.id)}&archived=${event.conversation_archived ? '1' : '0'}`;
}
