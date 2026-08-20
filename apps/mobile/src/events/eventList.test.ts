import { describe, expect, it } from 'vitest';

import { eventStatusLabel, eventWhenLabel, groupEvents } from './eventList';
import type { HopEvent } from '@/src/api/hop';

function event(partial: Partial<HopEvent> & Pick<HopEvent, 'id' | 'row_status' | 'status'>): HopEvent {
  return {
    name: 'Mixer',
    host: { id: 'h', username: 'host', role: 'host' },
    starts_at: new Date(Date.now() + 3_600_000).toISOString(),
    ends_at: new Date(Date.now() + 7_200_000).toISOString(),
    visibility: 'invite_only',
    my_role: 'host',
    participant_count: 1,
    conversation_id: 'c',
    conversation_archived: false,
    members: [],
    pending_invites: [],
    ...partial,
  };
}

describe('events list grouping', () => {
  it('splits created/invited events into Active, Upcoming, and Past', () => {
    const grouped = groupEvents([
      event({ id: 'a', row_status: 'active', status: 'active' }),
      event({ id: 'b', row_status: 'invited', status: 'upcoming' }),
      event({ id: 'c', row_status: 'ended', status: 'ended' }),
    ]);
    expect(grouped.active.map((row) => row.id)).toEqual(['a']);
    expect(grouped.upcoming.map((row) => row.id)).toEqual(['b']);
    expect(grouped.past.map((row) => row.id)).toEqual(['c']);
    expect(eventStatusLabel('invited')).toBe('Invited');
    expect(eventWhenLabel(event({ id: 'd', row_status: 'ended', status: 'ended' }))).toBe('Ended');
  });
});
