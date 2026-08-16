import { IdentityError, type SecretBackend } from "./identityLifecycle.js";

export function shouldFailClosedSecretStore(env: {
  isDev?: boolean;
  nodeEnv?: string;
  forceFailClosed?: boolean;
  allowMemoryFallback?: boolean;
}): boolean {
  if (env.allowMemoryFallback) return false;
  if (env.forceFailClosed) return true;
  if (env.isDev === false) return true;
  if (env.nodeEnv === "production") return true;
  return false;
}

export async function readWithSecretPolicy(input: {
  backend: SecretBackend | null;
  memory: Map<string, string>;
  key: string;
  failClosed: boolean;
}): Promise<string | null> {
  if (!input.backend) {
    if (input.failClosed) {
      throw new IdentityError(
        "SECRET_STORE_UNAVAILABLE",
        "Secure identity storage is unavailable. HOP will not keep private keys in volatile memory on a production build.",
      );
    }
    return input.memory.get(input.key) ?? null;
  }
  try {
    return await input.backend.read(input.key);
  } catch {
    if (input.failClosed) {
      throw new IdentityError(
        "SECRET_STORE_UNAVAILABLE",
        "Secure identity storage failed. HOP will not fall back to volatile memory on a production build.",
      );
    }
    return input.memory.get(input.key) ?? null;
  }
}

export async function writeWithSecretPolicy(input: {
  backend: SecretBackend | null;
  memory: Map<string, string>;
  key: string;
  value: string | null;
  failClosed: boolean;
}): Promise<void> {
  if (!input.backend) {
    if (input.failClosed) {
      throw new IdentityError(
        "SECRET_STORE_UNAVAILABLE",
        "Secure identity storage is unavailable. HOP will not keep private keys in volatile memory on a production build.",
      );
    }
    if (input.value) input.memory.set(input.key, input.value);
    else input.memory.delete(input.key);
    return;
  }
  try {
    await input.backend.write(input.key, input.value);
  } catch (err) {
    if (input.failClosed) {
      throw new IdentityError(
        "SECRET_STORE_UNAVAILABLE",
        "Secure identity storage failed. HOP will not fall back to volatile memory on a production build.",
      );
    }
    if (input.value) input.memory.set(input.key, input.value);
    else input.memory.delete(input.key);
    return;
  }
  if (input.value) input.memory.set(input.key, input.value);
  else input.memory.delete(input.key);
}
