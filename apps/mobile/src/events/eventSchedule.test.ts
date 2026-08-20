import { describe, expect, it } from 'vitest';

import { localDateTimeParts, parseLocalDateTime, scheduledStartError } from './eventSchedule';

describe('event schedule parsing', () => {
  it('round-trips local date and time without inventing a timezone', () => {
    const at = new Date(2026, 7, 20, 15, 30, 0, 0);
    const parts = localDateTimeParts(at);
    expect(parts).toEqual({ date: '2026-08-20', time: '15:30' });
    expect(parseLocalDateTime(parts.date, parts.time)).toBe(at.getTime());
    expect(parseLocalDateTime('2026-08-20', '24:00')).toBeNull();
    expect(parseLocalDateTime('nope', '15:30')).toBeNull();
  });

  it('rejects past or too-far scheduled starts', () => {
    const now = Date.parse('2026-08-20T12:00:00');
    expect(scheduledStartError(now + 3_600_000, now)).toBeNull();
    expect(scheduledStartError(now - 120_000, now)).toBe('Start time must be in the future');
    expect(scheduledStartError(now + 40 * 24 * 60 * 60 * 1000, now)).toBe(
      'Start time is too far in the future',
    );
  });
});
