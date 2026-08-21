import {
  clearHandleHint,
  readHandleHint,
  type NonSecretStore,
} from '@hop/protocol';

import { createPersistentKv } from '@/src/nearby/kvStore';

const kv = createPersistentKv();

/** Non-SecureStore persistence for the last-used handle hint. Not a secret. */
export const handleHintStore: NonSecretStore = {
  async read(key) {
    return kv.get(key);
  },
  async write(key, value) {
    if (value) await kv.set(key, value);
    else await kv.remove(key);
  },
};

export async function loadPersistedHandleHint(): Promise<string | null> {
  return readHandleHint(handleHintStore);
}

export async function forgetPersistedHandleHint(): Promise<void> {
  await clearHandleHint(handleHintStore);
}
