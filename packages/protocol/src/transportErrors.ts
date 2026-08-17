export type TransportFailureCategory =
  | "unavailable"
  | "timeout"
  | "http_4xx"
  | "http_5xx"
  | "crypto_refused"
  | "identity_changed"
  | "session_stale"
  | "malformed"
  | "network"
  | "unknown";

export function categorizeTransportFailure(error: string | undefined | null): TransportFailureCategory {
  const text = (error ?? "").toLowerCase();
  if (!text) return "unknown";
  if (text.includes("key changed") || text.includes("key_changed") || text.includes("re-verify")) {
    return "identity_changed";
  }
  if (text.includes("alg:none") || text.includes("plaintext") || text.includes("crypto_box") || text.includes("unauthenticated payload")) {
    return "crypto_refused";
  }
  if (text.includes("stale") || text.includes("idle session") || text.includes("session is not established")) {
    return "session_stale";
  }
  if (text.includes("malformed") || text.includes("truncated") || text.includes("oversized")) {
    return "malformed";
  }
  if (text.includes("timed out") || text.includes("timeout")) return "timeout";
  const http = text.match(/http (\d{3})/) ?? text.match(/\b(4\d\d|5\d\d)\b/);
  if (http) {
    const code = Number(http[1]);
    if (code >= 500) return "http_5xx";
    if (code >= 400) return "http_4xx";
  }
  if (text.includes("unavailable") || text.includes("not available") || text.includes("bluetooth off")) {
    return "unavailable";
  }
  if (text.includes("network") || text.includes("fetch") || text.includes("econn") || text.includes("offline")) {
    return "network";
  }
  return "unknown";
}
