const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "10.0.2.2", "::1"]);

export type ApiUrlPolicyOptions = {
  /** Metro / Expo development client. Localhost and RFC1918 HTTP are allowed. */
  isDev: boolean;
  /**
   * Staging flag (EXPO_PUBLIC_ALLOW_CLEARTEXT_HTTP=1).
   * Release builds may use HTTP to a non-loopback host only when this is true.
   * Localhost is never allowed in release.
   */
  allowCleartextHttp?: boolean;
};

function ipv4Octets(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

export function isLoopbackApiHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** RFC1918 only. Physical phones in __DEV__ can reach the Mac LAN API over HTTP. */
export function isPrivateLanIpv4(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** Live Fly production API. Metro/EAS pointing here is PRODUCTION, not local DEV. */
export const PRODUCTION_API_HOST = "hop-uokqmg.fly.dev";

export type ApiDeploymentKind = "development" | "production";

export type ApiDeploymentClassification = {
  kind: ApiDeploymentKind;
  label: "DEV" | "PRODUCTION";
  host: string;
  versionEnv: string | null;
  mismatch: boolean;
};

export function hostnameFromApiUrl(apiUrl: string): string {
  try {
    return new URL(apiUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function kindFromVersionEnv(env: string | null | undefined): ApiDeploymentKind | null {
  if (!env) return null;
  const normalized = env.trim().toLowerCase();
  if (normalized === "production" || normalized === "prod") return "production";
  if (normalized === "development" || normalized === "dev" || normalized === "test" || normalized === "local") {
    return "development";
  }
  return null;
}

/**
 * Classify from the API origin only — not a client-side fake flag.
 * hop-uokqmg.fly.dev is PRODUCTION. Loopback and RFC1918 LAN are DEV.
 */
export function kindFromApiUrl(apiUrl: string): ApiDeploymentKind | null {
  const host = hostnameFromApiUrl(apiUrl);
  if (!host) return null;
  if (host === PRODUCTION_API_HOST || host.includes("hop-uokqmg")) return "production";
  if (isLoopbackApiHost(host) || isPrivateLanIpv4(host)) return "development";
  return null;
}

export function classifyApiDeployment(
  apiUrl: string,
  versionEnv?: string | null,
): ApiDeploymentClassification {
  const host = hostnameFromApiUrl(apiUrl) || "(invalid API URL)";
  const fromUrl = kindFromApiUrl(apiUrl);
  const fromVersion = kindFromVersionEnv(versionEnv);
  const mismatch = fromUrl != null && fromVersion != null && fromUrl !== fromVersion;
  // URL wins for hop-uokqmg vs local/LAN. Unknown remote hosts fail closed to PRODUCTION
  // until /version env is known, so we never silently treat Fly as DEV.
  const kind: ApiDeploymentKind = fromUrl ?? fromVersion ?? "production";
  return {
    kind,
    label: kind === "production" ? "PRODUCTION" : "DEV",
    host,
    versionEnv: versionEnv ?? null,
    mismatch,
  };
}

export function resolveApiUrl(envUrl: string | undefined, isDev: boolean): string {
  const trimmed = envUrl?.trim();
  if (trimmed) return trimmed;
  if (isDev) return "http://127.0.0.1:8000";
  throw new Error("EXPO_PUBLIC_API_URL is required in release builds");
}

/**
 * Development: HTTPS, localhost HTTP, and RFC1918 HTTP.
 * Release: HTTPS required unless the staging cleartext flag is set.
 * Release never accepts localhost / loopback, including https://localhost.
 */
export function assertSafeApiUrl(url: string, options: ApiUrlPolicyOptions): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid API URL");
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid API URL");
  }
  if (!options.isDev && isLoopbackApiHost(host)) {
    throw new Error("Release builds cannot use a localhost / loopback API URL");
  }
  if (parsed.protocol === "https:") return;
  if (options.isDev && (isLoopbackApiHost(host) || isPrivateLanIpv4(host))) return;
  if (!options.isDev && options.allowCleartextHttp && !isLoopbackApiHost(host)) return;
  if (options.isDev) {
    throw new Error("Refusing cleartext HTTP API URL outside localhost or private LAN");
  }
  throw new Error("Release builds require HTTPS (set EXPO_PUBLIC_ALLOW_CLEARTEXT_HTTP=1 only for staging)");
}
