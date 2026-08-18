/**
 * Official CJS libsodium tries WebAssembly first, then its wasm2js backup.
 * Hermes throws ReferenceError on the identifier `WebAssembly` (it is not
 * present). That probe failure can surface as an extra unhandled rejection
 * after ready() has already fallen back. This is not a WebAssembly polyfill.
 */
function isMissingWebAssemblyProbe(reason: unknown): boolean {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  return /WebAssembly/.test(text) && /doesn['’]t exist|is not defined/i.test(text);
}

function consume(reason: unknown, event?: { preventDefault?: () => void }): boolean {
  if (!isMissingWebAssemblyProbe(reason)) return false;
  event?.preventDefault?.();
  return true;
}

export function installSodiumWasmProbeGuard(): void {
  const g = globalThis as typeof globalThis & {
    addEventListener?: (type: string, listener: (event: PromiseRejectionEvent) => void) => void;
    onunhandledrejection?: ((event: PromiseRejectionEvent) => void) | null;
  };

  if (typeof g.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (event) => {
      consume(event.reason, event);
    });
  }

  const previous = g.onunhandledrejection;
  g.onunhandledrejection = (event) => {
    if (consume(event.reason, event)) return;
    if (typeof previous === 'function') previous.call(g, event);
  };
}

installSodiumWasmProbeGuard();
