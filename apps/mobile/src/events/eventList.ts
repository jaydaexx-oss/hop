import { eventListSection, type EventRowStatus } from '@hop/protocol';

import type { HopEvent } from '@/src/api/hop';

export type EventListBucket = 'active' | 'upcoming' | 'past';

export function remainingMs(event: Pick<HopEvent, 'ends_at'>, now = Date.now()): number {
  const ends = Date.parse(event.ends_at);
  if (!Number.isFinite(ends)) return 0;
  return Math.max(0, ends - now);
}

export function formatEventClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function eventWhenLabel(event: HopEvent, now = Date.now()): string {
  if (event.status === 'ended' || event.row_status === 'ended') return 'Ended';
  const clock = formatEventClock(event.starts_at);
  if (event.status === 'upcoming') {
    const starts = Date.parse(event.starts_at);
    if (!Number.isFinite(starts)) return clock || 'Upcoming';
    const delta = starts - now;
    if (delta <= 0) return clock ? `${clock} · Starting` : 'Starting';
    const minutes = Math.ceil(delta / 60_000);
    const relative = minutes < 60 ? `Starts in ${minutes}m` : `Starts in ${Math.floor(minutes / 60)}h`;
    return clock ? `${clock} · ${relative}` : relative;
  }
  const left = remainingMs(event, now);
  if (left <= 0) return clock ? `${clock} · Ending` : 'Ending';
  const minutes = Math.ceil(left / 60_000);
  const relative =
    minutes < 60
      ? `${minutes}m left`
      : (() => {
          const hours = Math.floor(minutes / 60);
          const mins = minutes % 60;
          return mins ? `${hours}h ${mins}m left` : `${hours}h left`;
        })();
  return clock ? `${clock} · ${relative}` : relative;
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
