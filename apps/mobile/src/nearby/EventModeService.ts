import { createEventSessionId } from './ephemeralId';
import { clampEventDurationMs, normalizeEventName } from './eventDuration';
import type { EventModeSnapshot, KvStore } from './types';
import { DEFAULT_EVENT_DURATION_MS } from './types';

const PREFIX = 'hop.eventMode.';

type StoredEventMode = {
  enabled: boolean;
  startedAt: number | null;
  expiresAt: number | null;
  sessionId: string | null;
  eventCode: string | null;
  name: string | null;
};

const OFF: StoredEventMode = {
  enabled: false,
  startedAt: null,
  expiresAt: null,
  sessionId: null,
  eventCode: null,
  name: null,
};

function snapshot(stored: StoredEventMode, now: number): EventModeSnapshot {
  const remainingMs =
    stored.enabled && stored.expiresAt !== null ? Math.max(0, stored.expiresAt - now) : 0;
  const live = stored.enabled && remainingMs > 0;
  return {
    enabled: live,
    startedAt: live ? stored.startedAt : null,
    expiresAt: live ? stored.expiresAt : null,
    remainingMs: live ? remainingMs : 0,
    sessionId: live ? stored.sessionId : null,
    eventCode: live ? stored.eventCode : null,
    name: live ? stored.name : null,
  };
}

function parseStored(raw: string | null): StoredEventMode {
  if (!raw) return { ...OFF };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredEventMode>;
    return {
      enabled: parsed.enabled === true,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : null,
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : null,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      eventCode: typeof parsed.eventCode === 'string' ? parsed.eventCode : null,
      name: normalizeEventName(typeof parsed.name === 'string' ? parsed.name : null),
    };
  } catch {
    return { ...OFF };
  }
}

export function formatEventRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalMinutes = Math.ceil(ms / 60_000);
  if (totalMinutes < 1) return '<1m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export class EventModeService {
  constructor(
    private readonly store: KvStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async load(userId: string): Promise<EventModeSnapshot> {
    const stored = parseStored(await this.store.get(`${PREFIX}${userId}`));
    const now = this.now();
    if (stored.enabled && (stored.expiresAt === null || stored.expiresAt <= now)) {
      await this.persist(userId, OFF);
      return snapshot(OFF, now);
    }
    return snapshot(stored, now);
  }

  async enable(
    userId: string,
    durationMs = DEFAULT_EVENT_DURATION_MS,
    eventCode: string | null = null,
    name: string | null = null,
  ): Promise<EventModeSnapshot> {
    const now = this.now();
    const next: StoredEventMode = {
      enabled: true,
      startedAt: now,
      expiresAt: now + clampEventDurationMs(durationMs),
      sessionId: createEventSessionId(),
      eventCode,
      name: normalizeEventName(name),
    };
    await this.persist(userId, next);
    return snapshot(next, now);
  }

  async disable(userId: string): Promise<EventModeSnapshot> {
    await this.persist(userId, OFF);
    return snapshot(OFF, this.now());
  }

  async tick(userId: string): Promise<EventModeSnapshot> {
    return this.load(userId);
  }

  private async persist(userId: string, value: StoredEventMode): Promise<void> {
    await this.store.set(`${PREFIX}${userId}`, JSON.stringify(value));
  }
}
