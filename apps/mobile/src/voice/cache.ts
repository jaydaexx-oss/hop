import * as FileSystem from 'expo-file-system/legacy';

function voiceDir(): string {
  return `${FileSystem.cacheDirectory ?? ''}hop-voice/`;
}

function extensionFor(mime?: string): string {
  if (mime?.includes('webm')) return 'webm';
  if (mime?.includes('wav')) return 'wav';
  if (mime?.includes('mpeg') || mime?.includes('mp3')) return 'mp3';
  return 'm4a';
}

export async function cacheVoiceClip(messageId: string, audioB64: string, mime?: string): Promise<string> {
  const dir = voiceDir();
  if (!dir || dir === 'hop-voice/') {
    return voiceDataUri(audioB64, mime);
  }
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const path = `${dir}${messageId}.${extensionFor(mime)}`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.writeAsStringAsync(path, audioB64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  return path;
}

export function voiceDataUri(audioB64: string, mime = 'audio/mp4'): string {
  return `data:${mime};base64,${audioB64}`;
}

export async function clearVoiceCache(): Promise<void> {
  const dir = voiceDir();
  if (!dir || dir === 'hop-voice/') return;
  await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => undefined);
}
