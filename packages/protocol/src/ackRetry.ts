import { DEFAULT_RETRY_POLICY, nextBackoffMs, type RetryPolicy } from "./retry.js";
import type { SendResult } from "./transport.js";

export type AckAttempt = "acked" | "no-ack" | "fail";

export async function sendWithAckRetry(
  sendOnce: () => Promise<AckAttempt>,
  options: {
    retry?: RetryPolicy;
    sleep?: (ms: number) => Promise<void>;
    timeoutError?: string;
  } = {},
): Promise<SendResult> {
  const retry = options.retry ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastFail = options.timeoutError ?? "BLE send failed";

  for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
    const result = await sendOnce();
    if (result === "acked") {
      return { ok: true, transport: "bluetooth" };
    }
    if (result === "fail") {
      lastFail = options.timeoutError ?? "BLE write failed";
    } else {
      lastFail = options.timeoutError ?? "Delivery ack timed out";
    }
    if (attempt + 1 >= retry.maxAttempts) break;
    const wait = nextBackoffMs(attempt, retry);
    if (wait === null) break;
    await sleep(wait);
  }
  return { ok: false, transport: "bluetooth", error: lastFail };
}
