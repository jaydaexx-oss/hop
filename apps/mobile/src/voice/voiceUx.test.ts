import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { voiceMicAllowed } from '@hop/protocol';

describe('voice composer surfaces', () => {
  it('keeps the mic off Broadcast, Event Chat, and non-chat tabs', () => {
    expect(voiceMicAllowed('private_chat')).toBe(true);
    expect(voiceMicAllowed('broadcast')).toBe(false);
    expect(voiceMicAllowed('event_chat')).toBe(false);
  });

  it('Broadcast screen source has no microphone or PTT control', () => {
    const src = readFileSync(path.join(__dirname, '../../app/(tabs)/broadcast.tsx'), 'utf8');
    expect(src).not.toMatch(/PTTButton|useAudioRecorder|requestRecordingPermissions/);
  });

  it('private chat composer mounts a hold-to-record mic beside the text field', () => {
    const src = readFileSync(path.join(__dirname, '../../app/chat/[id].tsx'), 'utf8');
    expect(src).toMatch(/voiceMicAllowed\(isEventChat \? 'event_chat' : 'private_chat'\)/);
    expect(src).toMatch(/<PTTButton/);
    expect(src).toMatch(/<TextInput/);
    expect(src).not.toMatch(/HOLD TO HOP/);
    expect(src).not.toMatch(/inputMode/);
  });
});
