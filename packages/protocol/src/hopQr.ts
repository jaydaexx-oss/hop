import { looksLikeHardwareId } from "./bleCodec.js";
import { looksLikeSecretDump } from "./redact.js";

export const HOP_QR_KIND = "hop-contact" as const;
export const HOP_USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

const FORBIDDEN_QR_KEY =
  /^(secret|private.?key|public.?key|identity_public_key|crypto_box|ciphertext|nonce|mac|deviceid|device_id|uuid|sk|seed|token|password|encrypted_payload)$/i;

const FORBIDDEN_QR_TEXT =
  /secret|private.?key|identity_public_key|crypto_box|ciphertext|encrypted_payload|aa:bb:cc|deviceid|mac address/i;

export type HopQrPayload = {
  v: 1;
  kind: typeof HOP_QR_KIND;
  username: string;
  invite: string;
};

function randomInvite(): string {
  const bytes = new Uint8Array(5);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (Date.now() + i * 17) & 0xff;
  }
  const body = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `h${body}`;
}

export function createHopInviteToken(): string {
  return randomInvite();
}

export function normalizeHopUsername(username: string): string {
  return username.trim().toLowerCase();
}

const INVITE_RE = /^h[a-f0-9]{8,16}$/;

function isHopInviteToken(value: string): boolean {
  return INVITE_RE.test(value);
}

export function hopQrUri(payload: HopQrPayload): string {
  return `hop://u/${payload.username}?i=${payload.invite}`;
}

export function encodeHopQrPayload(input: { username: string; invite?: string }): HopQrPayload {
  const username = normalizeHopUsername(input.username);
  if (!HOP_USERNAME_RE.test(username)) {
    throw new Error("Enter a valid HOP username.");
  }
  const invite = (input.invite ?? createHopInviteToken()).toLowerCase();
  if (!isHopInviteToken(invite)) {
    throw new Error("Invalid invite token");
  }
  const payload: HopQrPayload = { v: 1, kind: HOP_QR_KIND, username, invite };
  assertHopQrHasNoSecrets(payload);
  return payload;
}

export function hopQrContainsSecrets(raw: string): boolean {
  if (!raw) return false;
  if (looksLikeSecretDump(raw)) return true;
  if (FORBIDDEN_QR_TEXT.test(raw)) return true;
  if (looksLikeHardwareId(raw.trim())) return true;
  return false;
}

export function assertHopQrHasNoSecrets(value: unknown): void {
  if (value == null) return;
  if (typeof value === "string") {
    if (hopQrContainsSecrets(value)) throw new Error("HOP codes cannot include secrets or device IDs.");
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_QR_KEY.test(key)) {
      throw new Error("HOP codes cannot include secrets or device IDs.");
    }
    if (typeof nested === "string") {
      if (key === "invite" && isHopInviteToken(nested)) continue;
      if (key === "username" && HOP_USERNAME_RE.test(nested)) continue;
      if (looksLikeHardwareId(nested) || hopQrContainsSecrets(nested)) {
        throw new Error("HOP codes cannot include secrets or device IDs.");
      }
    }
  }
}

export function decodeHopQrPayload(raw: string): HopQrPayload | null {
  const text = raw.trim();
  if (!text || hopQrContainsSecrets(text)) return null;
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      assertHopQrHasNoSecrets(parsed);
      if (parsed.v !== 1 || parsed.kind !== HOP_QR_KIND) return null;
      if (typeof parsed.username !== "string" || typeof parsed.invite !== "string") return null;
      return encodeHopQrPayload({ username: parsed.username, invite: parsed.invite });
    } catch {
      return null;
    }
  }
  const uri = text.match(/^hop:\/\/u\/([a-zA-Z][a-zA-Z0-9_]{2,19})(?:\?i=(h[a-fA-F0-9]{8,16}))?$/);
  if (uri) {
    try {
      return encodeHopQrPayload({ username: uri[1]!, invite: uri[2] });
    } catch {
      return null;
    }
  }
  if (HOP_USERNAME_RE.test(normalizeHopUsername(text))) {
    try {
      return encodeHopQrPayload({ username: text });
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Byte-mode QR modules (versions 1–4, ECC L). No keys or hardware IDs are encoded —
 * callers must pass a hop:// URI from encodeHopQrPayload.
 */
export function hopQrModules(text: string): boolean[][] {
  if (hopQrContainsSecrets(text)) {
    throw new Error("HOP codes cannot include secrets or device IDs.");
  }
  return encodeQrModules(text);
}

/* --- compact QR encoder (byte mode, ECC L, versions 1–4) --- */

const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  EXP[255] = EXP[0];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

function rsGenerator(ecCount: number): Uint8Array {
  const gen = new Uint8Array(ecCount + 1);
  gen[0] = 1;
  for (let i = 0; i < ecCount; i++) {
    for (let j = i + 1; j > 0; j--) {
      gen[j] ^= gfMul(gen[j - 1], EXP[i]);
    }
  }
  return gen;
}

function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGenerator(ecCount);
  const out = new Uint8Array(ecCount);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[ecCount - 1] = 0;
    if (factor === 0) continue;
    for (let i = 0; i < ecCount; i++) {
      out[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return out;
}

type VersionSpec = { version: number; size: number; data: number; ec: number; align: number[] };

const VERSIONS: VersionSpec[] = [
  { version: 1, size: 21, data: 19, ec: 7, align: [] },
  { version: 2, size: 25, data: 34, ec: 10, align: [6, 18] },
  { version: 3, size: 29, data: 55, ec: 15, align: [6, 22] },
  { version: 4, size: 33, data: 80, ec: 20, align: [6, 26] },
];

function chooseVersion(byteLen: number): VersionSpec {
  const needed = 1 + 1 + byteLen + 1;
  const spec = VERSIONS.find((row) => row.data >= needed);
  if (!spec) throw new Error("HOP code is too long for a QR");
  return spec;
}

function setModule(grid: Uint8Array, size: number, x: number, y: number, dark: boolean): void {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  grid[y * size + x] = dark ? 1 : 0;
}

function finder(grid: Uint8Array, size: number, ox: number, oy: number): void {
  for (let y = -1; y <= 7; y++) {
    for (let x = -1; x <= 7; x++) {
      const dark = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
      const xx = ox + x;
      const yy = oy + y;
      if (xx >= 0 && yy >= 0 && xx < size && yy < size) setModule(grid, size, xx, yy, dark);
    }
  }
}

function alignment(grid: Uint8Array, size: number, cx: number, cy: number): void {
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
      setModule(grid, size, cx + x, cy + y, dark);
    }
  }
}

function reserved(mask: Uint8Array, size: number, spec: VersionSpec): void {
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) mask[y * size + x] = 1;
  };
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      mark(i, j);
      mark(size - 8 + i - 1, j);
      mark(i, size - 8 + j - 1);
    }
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 8 + i, 8);
    mark(8, size - 8 + i);
  }
  for (let i = 0; i < size; i++) {
    mark(i, 6);
    mark(6, i);
    mark(i, 8);
    mark(8, i);
  }
  for (const y of spec.align) {
    for (const x of spec.align) {
      if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) mark(x + dx, y + dy);
      }
    }
  }
}

function applyMask(x: number, y: number, pattern: number): boolean {
  switch (pattern) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

const FORMAT_MASK = 0x5412;
const ECC_L_FORMAT = [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976];

function drawFormat(grid: Uint8Array, size: number, maskPattern: number): void {
  const bits = ECC_L_FORMAT[maskPattern] ^ FORMAT_MASK;
  const bit = (i: number) => ((bits >> (14 - i)) & 1) === 1;
  const positions = [
    [0, 8],
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    [7, 8],
    [8, 8],
    [8, 7],
    [8, 5],
    [8, 4],
    [8, 3],
    [8, 2],
    [8, 1],
    [8, 0],
  ];
  positions.forEach(([x, y], i) => setModule(grid, size, x, y, bit(i)));
  const other = [
    [8, size - 1],
    [8, size - 2],
    [8, size - 3],
    [8, size - 4],
    [8, size - 5],
    [8, size - 6],
    [8, size - 7],
    [size - 8, 8],
    [size - 7, 8],
    [size - 6, 8],
    [size - 5, 8],
    [size - 4, 8],
    [size - 3, 8],
    [size - 2, 8],
    [size - 1, 8],
  ];
  other.forEach(([x, y], i) => setModule(grid, size, x, y, bit(i)));
  setModule(grid, size, 8, size - 8, true);
}

function encodeQrModules(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec = chooseVersion(bytes.length);
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, spec.data * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data = new Uint8Array(spec.data);
  for (let i = 0; i < spec.data; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | (bits[i * 8 + b] ?? 0);
    data[i] = v;
  }
  const pads = [0xec, 0x11];
  let pad = 0;
  const used = Math.ceil(bits.length / 8);
  for (let i = used; i < spec.data; i++) {
    data[i] = pads[pad % 2]!;
    pad += 1;
  }
  const ec = rsEncode(data, spec.ec);
  const codewords = new Uint8Array(spec.data + spec.ec);
  codewords.set(data, 0);
  codewords.set(ec, spec.data);

  const size = spec.size;
  const grid = new Uint8Array(size * size);
  const func = new Uint8Array(size * size);
  finder(grid, size, 0, 0);
  finder(grid, size, size - 7, 0);
  finder(grid, size, 0, size - 7);
  for (const y of spec.align) {
    for (const x of spec.align) {
      if ((x <= 8 && y <= 8) || (x >= size - 8 && y <= 8) || (x <= 8 && y >= size - 8)) continue;
      alignment(grid, size, x, y);
    }
  }
  for (let i = 0; i < size; i++) {
    setModule(grid, size, i, 6, i % 2 === 0);
    setModule(grid, size, 6, i, i % 2 === 0);
  }
  reserved(func, size, spec);
  for (let i = 0; i < size * size; i++) {
    if (grid[i]) func[i] = 1;
  }
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      func[j * size + i] = 1;
      if (size - 8 + i >= 0) func[j * size + (size - 8 + i)] = 1;
      func[(size - 8 + j) * size + i] = 1;
    }
  }
  for (let i = 0; i < size; i++) {
    func[6 * size + i] = 1;
    func[i * size + 6] = 1;
    func[8 * size + i] = 1;
    func[i * size + 8] = 1;
  }

  const stream: number[] = [];
  for (const cw of codewords) {
    for (let b = 7; b >= 0; b--) stream.push((cw >> b) & 1);
  }

  const maskPattern = 0;
  let bit = 0;
  let goingUp = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let i = 0; i < size; i++) {
      const y = goingUp ? size - 1 - i : i;
      for (let dx = 0; dx < 2; dx++) {
        const x = col - dx;
        if (func[y * size + x]) continue;
        let dark = stream[bit] === 1;
        bit += 1;
        if (applyMask(x, y, maskPattern)) dark = !dark;
        setModule(grid, size, x, y, dark);
      }
    }
    goingUp = !goingUp;
  }
  drawFormat(grid, size, maskPattern);

  const modules: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(grid[y * size + x] === 1);
    modules.push(row);
  }
  return modules;
}
