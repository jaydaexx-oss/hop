import type { KvStore } from './types';

export class MemoryKvStore implements KvStore {
  private readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const memoryFallback = new MemoryKvStore();
const FILE_NAME = 'hop-nearby-flags.json';

async function readFileMap(): Promise<Record<string, string>> {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const dir = FileSystem.documentDirectory;
    if (!dir) return {};
    const path = `${dir}${FILE_NAME}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeFileMap(map: Record<string, string>): Promise<void> {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const dir = FileSystem.documentDirectory;
    if (!dir) return;
    await FileSystem.writeAsStringAsync(`${dir}${FILE_NAME}`, JSON.stringify(map));
  } catch {
    /* optional on web / tests */
  }
}

function localStorageGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localStorageSet(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Non-secret flags (privacy, Event Mode expiry). Not SecureStore. */
export function createPersistentKv(): KvStore {
  return {
    async get(key: string) {
      const fromLs = localStorageGet(key);
      if (fromLs !== null) return fromLs;
      const mem = await memoryFallback.get(key);
      if (mem !== null) return mem;
      const file = await readFileMap();
      return file[key] ?? null;
    },
    async set(key: string, value: string) {
      await memoryFallback.set(key, value);
      localStorageSet(key, value);
      const file = await readFileMap();
      file[key] = value;
      await writeFileMap(file);
    },
    async remove(key: string) {
      await memoryFallback.remove(key);
      localStorageSet(key, null);
      const file = await readFileMap();
      delete file[key];
      await writeFileMap(file);
    },
  };
}
