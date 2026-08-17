const SENSITIVE_KEY =
  /^(password|token|secret|secret_key|secretkey|private_key|privatekey|ciphertext|encrypted_payload|crypto_box|audio_b64|audio|voice|authorization|cookie)$/i;

const LONG_B64 = /[A-Za-z0-9+/]{48,}={0,2}/g;

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactForLog(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactForLog(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function redactString(message: string): string {
  return message.replace(LONG_B64, "[redacted-b64]");
}

export function looksLikeSecretDump(message: string): boolean {
  if (!message) return false;
  if (/secretKey|privateKey|encrypted_payload|audio_b64/i.test(message) && LONG_B64.test(message)) {
    return true;
  }
  return false;
}
