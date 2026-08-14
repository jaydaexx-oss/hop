export interface HopHttpClient {
  request(
    path: string,
    init?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; headers?: Record<string, string> },
  ): Promise<{ ok: boolean; status: number; data: unknown }>;
}
