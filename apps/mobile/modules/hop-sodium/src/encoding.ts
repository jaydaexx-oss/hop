const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_REV = new Int32Array(256).fill(-1);
for (let i = 0; i < B64.length; i += 1) {
  B64_REV[B64.charCodeAt(i)] = i;
}

export function toU8(value: ArrayBuffer | ArrayBufferView | number[] | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

/** libsodium sodium_base64_VARIANT_ORIGINAL: standard padded base64. */
export function toOriginalBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const a = bytes[i]!;
    const b = remaining > 1 ? bytes[i + 1]! : 0;
    const c = remaining > 2 ? bytes[i + 2]! : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += remaining > 1 ? B64[((b & 15) << 2) | (c >> 6)] : "=";
    out += remaining > 2 ? B64[c & 63] : "=";
  }
  return out;
}

export function fromOriginalBase64(input: string): Uint8Array {
  if (typeof input !== "string" || /[\s]/.test(input)) {
    throw new Error("Invalid ORIGINAL base64");
  }
  if (input.length % 4 !== 0) {
    throw new Error("Invalid ORIGINAL base64");
  }
  const pad = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((input.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < input.length; i += 4) {
    const a = B64_REV[input.charCodeAt(i)] ?? -1;
    const b = B64_REV[input.charCodeAt(i + 1)] ?? -1;
    const cChar = input[i + 2];
    const dChar = input[i + 3];
    const c = cChar === "=" ? 0 : B64_REV[input.charCodeAt(i + 2)] ?? -1;
    const d = dChar === "=" ? 0 : B64_REV[input.charCodeAt(i + 3)] ?? -1;
    if (a < 0 || b < 0 || (cChar !== "=" && c < 0) || (dChar !== "=" && d < 0)) {
      throw new Error("Invalid ORIGINAL base64");
    }
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (triple >> 16) & 255;
    if (o < out.length) out[o++] = (triple >> 8) & 255;
    if (o < out.length) out[o++] = triple & 255;
  }
  return out;
}

export function fromUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function toUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
