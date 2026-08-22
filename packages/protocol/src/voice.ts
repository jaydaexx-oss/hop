import { MAX_ENCRYPTED_PAYLOAD_BYTES, type ApplicationPlaintext } from "./cryptoBox.js";
import type { StoredMessage } from "./store.js";

export { MAX_ENCRYPTED_PAYLOAD_BYTES };

/** Client recording cap. 2 minutes of 16 kHz / 32 kbps AAC stays under the 1 MiB box. */
export const MAX_VOICE_DURATION_MS = 120_000;
/** Ignore accidental taps. Hold-to-send clips shorter than this are dropped, not queued. */
export const MIN_VOICE_DURATION_MS = 500;
/** Horizontal drag from the mic that cancels an in-progress recording. */
export const SLIDE_CANCEL_DISTANCE_PX = 72;
export const DEFAULT_VOICE_CAPTION = "Voice message";
export const DEFAULT_VOICE_MIME = "audio/mp4";
export const DEFAULT_VOICE_CODEC = "aac";
/**
 * Conservative audio_b64 budget so JSON.stringify + crypto_box + outer base64
 * stays under MAX_ENCRYPTED_PAYLOAD_BYTES without needing the microphone.
 * 32 kbps × 120 s ≈ 480 KiB raw → ~640k base64; leave headroom for JSON + MAC.
 */
export const MAX_VOICE_AUDIO_B64_CHARS = 780_000;

export function voiceAudioB64(plain: Pick<ApplicationPlaintext, "audio_b64" | "audio">): string {
  const value = plain.audio_b64 ?? plain.audio ?? "";
  return typeof value === "string" ? value : "";
}

export function estimateBoxedPayloadBytes(plain: ApplicationPlaintext): number {
  const inner = JSON.stringify(plain).length;
  return Math.ceil((inner + 16) * (4 / 3)) + 256;
}

export function assertVoiceFitsBudget(input: { audio_b64: string; duration_ms: number }): void {
  if (!(input.duration_ms >= 0) || input.duration_ms > MAX_VOICE_DURATION_MS) {
    throw new Error("Voice recording exceeds the 2 minute limit");
  }
  if (!input.audio_b64) {
    throw new Error("Refusing to encrypt voice with no audio");
  }
  if (input.audio_b64.length > MAX_VOICE_AUDIO_B64_CHARS) {
    throw new Error("Voice payload exceeds maximum size");
  }
}

export function assertEncryptedPayloadSize(payload: string): void {
  if (payload.length > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new Error("Voice payload exceeds maximum size");
  }
}

export const MICROPHONE_DENIED_MESSAGE =
  "Microphone access denied. Enable it in Settings to send voice notes.";

export type VoiceMicSurface = "private_chat" | "event_chat" | "broadcast" | "nearby" | "contacts" | "settings";

/** Phase 1 voice is private 1:1 only. Broadcast and Event Chat have no mic. */
export function voiceMicAllowed(surface: VoiceMicSurface): boolean {
  return surface === "private_chat";
}

export function shouldSendVoiceClip(input: { durationMs: number; cancelled: boolean }): boolean {
  if (input.cancelled) return false;
  return input.durationMs >= MIN_VOICE_DURATION_MS;
}

export function slideLeftCancelsRecording(
  startX: number,
  currentX: number,
  thresholdPx = SLIDE_CANCEL_DISTANCE_PX,
): boolean {
  return startX - currentX >= thresholdPx;
}

export function microphoneDeniedMessage(granted: boolean | null): string | null {
  if (granted === false) return MICROPHONE_DENIED_MESSAGE;
  return null;
}

export function isEphemeralVoicePlaybackName(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  return (
    base.startsWith("hop-voice-play-") ||
    base.startsWith("hop-voice-rec-") ||
    base === "hop-voice" ||
    base.startsWith("hop-voice.")
  );
}

/** Crypto-safe id for ephemeral voice temp files. Not Math.random. */
export async function newEphemeralVoiceFileId(): Promise<string> {
  const { readySodium } = await import("./cryptoBox.js");
  const s = await readySodium();
  return s.to_hex(s.randombytes_buf(16));
}

export function withDecryptedPlain(message: StoredMessage, plain: ApplicationPlaintext): StoredMessage {
  const audio = plain.kind === "voice" ? voiceAudioB64(plain) : "";
  return {
    ...message,
    text: plain.text,
    kind: plain.kind,
    duration_ms: plain.duration_ms,
    mime: plain.mime,
    audio_b64: audio || undefined,
    codec: plain.codec,
    seq: plain.seq,
    total: plain.total,
    part_of: plain.part_of,
    send_seq: plain.send_seq ?? message.send_seq,
    created_at: plain.created_at || message.created_at,
    expires_at: plain.expires_at || message.expires_at,
  };
}
