import {
  generateIdentityKeyPair,
  type IdentityKeyPair,
} from '@hop/protocol';

import { readSecret, writeSecret } from '@/src/crypto/secretStore';

const PREFIX = 'hop.box.';

export async function loadOrCreateIdentity(userId: string): Promise<IdentityKeyPair> {
  const stored = await readSecret(`${PREFIX}${userId}`);
  if (stored) {
    const parsed = JSON.parse(stored) as IdentityKeyPair;
    if (parsed.publicKey && parsed.secretKey) return parsed;
  }
  const pair = await generateIdentityKeyPair();
  await writeSecret(`${PREFIX}${userId}`, JSON.stringify(pair));
  return pair;
}
