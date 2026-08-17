import { isEphemeralVoicePlaybackName, newEphemeralVoiceFileId } from '@hop/protocol';
import * as FileSystem from 'expo-file-system/legacy';

const PLAYBACK_PREFIX = 'hop-voice-play-';
const LEGACY_DIR_NAME = 'hop-voice';

function cacheRoot(): string | null {
  const dir = FileSystem.cacheDirectory;
  return dir || null;
}

function extensionFor(mime?: string): string {
  if (mime?.includes('webm')) return 'webm';
  if (mime?.includes('wav')) return 'wav';
  if (mime?.includes('mpeg') || mime?.includes('mp3')) return 'mp3';
  return 'm4a';
}

export function voiceDataUri(audioB64: string, mime = 'audio/mp4'): string {
  return `data:${mime};base64,${audioB64}`;
}

/**
 * Write decrypted audio to an ephemeral temp file for one playback.
 * Callers MUST delete the returned path after playback ends and on unmount.
 * Ciphertext in SQLite remains the durable representation.
 */
export async function writeEphemeralPlaybackFile(audioB64: string, mime?: string): Promise<string> {
  const dir = cacheRoot();
  if (!dir) return voiceDataUri(audioB64, mime);
  const id = await newEphemeralVoiceFileId();
  const path = `${dir}${PLAYBACK_PREFIX}${id}.${extensionFor(mime)}`;
  await FileSystem.writeAsStringAsync(path, audioB64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

export async function deleteEphemeralPlaybackFile(uri: string | null | undefined): Promise<void> {
  if (!uri || uri.startsWith('data:')) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

/** Delete leftover hop-voice temps (playback, crash leftovers, legacy plaintext dir). */
export async function clearVoicePlaybackTemps(): Promise<void> {
  const dir = cacheRoot();
  if (!dir) return;
  await FileSystem.deleteAsync(`${dir}${LEGACY_DIR_NAME}`, { idempotent: true }).catch(() => undefined);
  const listing = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  await Promise.all(
    listing
      .filter((name) => isEphemeralVoicePlaybackName(name))
      .map((name) => FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => undefined)),
  );
}

/** @deprecated Use clearVoicePlaybackTemps. Kept so chat unmount cleanup stays a single call. */
export async function clearVoiceCache(): Promise<void> {
  await clearVoicePlaybackTemps();
}
