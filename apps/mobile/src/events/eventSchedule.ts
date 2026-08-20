import { MAX_EVENT_START_AHEAD_MS } from '@hop/protocol';

export type EventStartParts = { date: string; time: string };

export function localDateTimeParts(at: Date): EventStartParts {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  const hour = String(at.getHours()).padStart(2, '0');
  const minute = String(at.getMinutes()).padStart(2, '0');
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

export function parseLocalDateTime(date: string, time: string): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const clock = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!day || !clock) return null;
  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  if (hours > 23 || minutes > 59) return null;
  const ms = new Date(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    hours,
    minutes,
    0,
    0,
  ).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function scheduledStartError(startsAt: number, now = Date.now()): string | null {
  if (!Number.isFinite(startsAt)) return 'Enter a valid date and time';
  if (startsAt < now - 60_000) return 'Start time must be in the future';
  if (startsAt > now + MAX_EVENT_START_AHEAD_MS) return 'Start time is too far in the future';
  return null;
}
