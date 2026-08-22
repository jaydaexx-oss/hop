import { describe, expect, it } from 'vitest';

import { activeVoicePlaybackId, claimVoicePlayback, releaseVoicePlayback } from '@/src/voice/playback';

describe('voice playback lock', () => {
  it('stops the previous clip when another starts', () => {
    const stopped: string[] = [];
    claimVoicePlayback('a', () => {
      stopped.push('a');
    });
    expect(activeVoicePlaybackId()).toBe('a');
    claimVoicePlayback('b', () => {
      stopped.push('b');
    });
    expect(stopped).toEqual(['a']);
    expect(activeVoicePlaybackId()).toBe('b');
    releaseVoicePlayback('b');
    expect(activeVoicePlaybackId()).toBeNull();
    releaseVoicePlayback('a');
    expect(activeVoicePlaybackId()).toBeNull();
  });
});
