import { describe, expect, it } from "vitest";

import {
  formatPersistedFingerprint,
  generateIdentityKeyPair,
  identityFingerprint,
  isEphemeralVoicePlaybackName,
  microphoneDeniedMessage,
  shouldSendVoiceClip,
  voiceMicAllowed,
} from "../src/index.js";

describe("identity fingerprint display helper", () => {
  it("formats a persisted public key without claiming attestation", async () => {
    const pair = await generateIdentityKeyPair();
    const hint = formatPersistedFingerprint(pair.publicKey);
    expect(hint).toMatch(/^[A-Za-z0-9+/]{4}( [A-Za-z0-9+/]{1,4})+$/);
    const hashed = await identityFingerprint(pair.publicKey);
    expect(hashed).toMatch(/^\d{5}( \d{5}){5} \/ \d{5}( \d{5}){5}$/);
    expect(hashed).not.toContain(pair.secretKey);
  });
});

describe("PTT helpers", () => {
  it("returns mic-denied copy only when access is denied", () => {
    expect(microphoneDeniedMessage(false)).toMatch(/Microphone access denied/);
    expect(microphoneDeniedMessage(true)).toBeNull();
    expect(microphoneDeniedMessage(null)).toBeNull();
  });

  it("identifies ephemeral playback files for cleanup", () => {
    expect(isEphemeralVoicePlaybackName("hop-voice-play-1.m4a")).toBe(true);
    expect(isEphemeralVoicePlaybackName("hop-voice-rec-deadbeef.m4a")).toBe(true);
    expect(isEphemeralVoicePlaybackName("hop-voice")).toBe(true);
    expect(isEphemeralVoicePlaybackName("messages.db")).toBe(false);
  });

  it("does not put a mic on Broadcast", () => {
    expect(voiceMicAllowed("broadcast")).toBe(false);
    expect(shouldSendVoiceClip({ durationMs: 200, cancelled: false })).toBe(false);
  });
});
