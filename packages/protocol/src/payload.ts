const UNENCRYPTED_ALG = "none";

function utf8ToB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64ToUtf8(payload: string): string {
  const binary = atob(payload);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeUnencryptedText(text: string): string {
  return utf8ToB64(JSON.stringify({ v: 0, alg: UNENCRYPTED_ALG, text }));
}

export function decodeUnencryptedText(payload: string): string | null {
  try {
    const data = JSON.parse(b64ToUtf8(payload)) as { alg?: string; text?: unknown };
    if (data.alg !== UNENCRYPTED_ALG || typeof data.text !== "string") return null;
    return data.text;
  } catch {
    return null;
  }
}
