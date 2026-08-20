export const EVENT_DURATION_PRESET_MS = {
  '1h': 1 * 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
} as const;

export type EventDurationPresetKey = keyof typeof EVENT_DURATION_PRESET_MS;

export const EVENT_DURATION_PRESET_KEYS: EventDurationPresetKey[] = ['1h', '2h', '4h', '6h', '8h'];

export const MIN_EVENT_DURATION_MS = 60_000;
export const MAX_EVENT_DURATION_MS = 24 * 60 * 60 * 1000;
export const MAX_EVENT_NAME_LENGTH = 48;

export function clampEventDurationMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return MIN_EVENT_DURATION_MS;
  return Math.min(MAX_EVENT_DURATION_MS, Math.round(ms));
}

export function customEventDurationMs(hours: number, minutes: number): number {
  const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0;
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  return clampEventDurationMs((h * 60 + m) * 60_000);
}

export function normalizeEventName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_EVENT_NAME_LENGTH);
  return name.length > 0 ? name : null;
}

export function eventDurationLabel(ms: number): string {
  const clamped = clampEventDurationMs(ms);
  const totalMinutes = Math.round(clamped / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
