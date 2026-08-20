import { describe, expect, it } from 'vitest';

import { eventPickerCandidates, filterEventPickerCandidates } from './candidatePicker';

describe('event member picker sources', () => {
  it('merges nearby, contacts, and recent chats without inventing people', () => {
    const rows = eventPickerCandidates({
      selfId: 'me',
      nearby: [
        {
          token: 't1',
          ephemeralId: 'e1',
          deviceId: 'd1',
          displayName: 'blake',
          avatarInitials: 'BL',
          userId: 'blake',
          proximity: 'nearby',
          rssi: -60,
          lastSeenAt: 1,
          discovered: true,
          encrypted: true,
          connected: false,
          canMessage: true,
        },
      ],
      acceptedIds: ['cara'],
      conversations: [
        {
          id: 'c1',
          created_at: '2026-01-01',
          peer: { id: 'cara', username: 'cara' },
          kind: 'direct',
        },
        {
          id: 'c2',
          created_at: '2026-01-01',
          peer: { id: 'drew', username: 'drew' },
          kind: 'direct',
        },
        {
          id: 'event',
          created_at: '2026-01-01',
          peer: { id: 'host', username: 'Campus mixer' },
          kind: 'event',
          title: 'Campus mixer',
        },
      ],
    });
    expect(rows.map((row) => row.username).sort()).toEqual(['blake', 'cara', 'drew']);
    expect(rows.find((row) => row.username === 'cara')?.source).toBe('contacts');
    expect(rows.find((row) => row.username === 'drew')?.source).toBe('recent');
    expect(filterEventPickerCandidates(rows, 'bl')).toEqual([
      expect.objectContaining({ username: 'blake' }),
    ]);
  });

  it('omits blocked user ids from invite candidates', () => {
    const rows = eventPickerCandidates({
      selfId: 'me',
      blockedIds: ['blake', 'drew'],
      nearby: [
        {
          token: 't1',
          ephemeralId: 'e1',
          deviceId: 'd1',
          displayName: 'blake',
          avatarInitials: 'BL',
          userId: 'blake',
          proximity: 'nearby',
          rssi: -60,
          lastSeenAt: 1,
          discovered: true,
          encrypted: true,
          connected: false,
          canMessage: true,
        },
      ],
      acceptedIds: ['cara'],
      conversations: [
        { id: 'c1', created_at: '2026-01-01', peer: { id: 'cara', username: 'cara' }, kind: 'direct' },
        { id: 'c2', created_at: '2026-01-01', peer: { id: 'drew', username: 'drew' }, kind: 'direct' },
      ],
    });
    expect(rows.map((row) => row.username)).toEqual(['cara']);
  });
});
