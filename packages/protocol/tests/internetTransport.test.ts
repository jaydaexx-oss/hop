import { describe, expect, it } from "vitest";
import { InternetTransport } from "../src/internetTransport.js";
import { createMessage } from "../src/message.js";
import { encodeUnencryptedText } from "../src/payload.js";
import { toEnvelope } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";
import { LocalTransport } from "../src/localTransport.js";
import type { HopHttpClient } from "../src/http.js";

function encryptedEnvelope() {
  const message = createMessage({
    sender_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    recipient_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    conversation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
  return toEnvelope({ ...message, encrypted_payload: encodeUnencryptedText("hello") });
}

function mockHttp(handler: HopHttpClient["request"]): HopHttpClient {
  return { request: handler };
}

describe("InternetTransport", () => {
  it("is available when /health returns ok", async () => {
    const transport = new InternetTransport(
      mockHttp(async (path) => {
        expect(path).toBe("/health");
        return { ok: true, status: 200, data: { status: "ok", service: "hop-api" } };
      }),
    );
    expect(await transport.isAvailable()).toBe(true);
    expect(await new TransportManager().getNetworkStatus()).toBe("Offline");
    const manager = new TransportManager();
    manager.register(transport);
    expect(await manager.getNetworkStatus()).toBe("Online");
  });

  it("POSTs plaintext to the conversation messages endpoint", async () => {
    const seen: unknown[] = [];
    const transport = new InternetTransport(
      mockHttp(async (path, init) => {
        if (path === "/health") return { ok: true, status: 200, data: { status: "ok" } };
        seen.push({ path, init });
        return { ok: true, status: 200, data: { status: "SENT" } };
      }),
    );
    const envelope = encryptedEnvelope();
    const result = await transport.send(envelope);
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("internet");
    expect(seen[0]).toMatchObject({
      path: `/conversations/${envelope.conversation_id}/messages`,
      init: { method: "POST", body: { text: "hello", message_id: envelope.message_id } },
    });
  });

  it("falls through to local queue when internet HTTP fails", async () => {
    const local = new LocalTransport();
    const manager = new TransportManager();
    manager.register(
      new InternetTransport(
        mockHttp(async () => {
          throw new Error("network down");
        }),
      ),
    );
    manager.register(local);
    const result = await manager.enqueue(encryptedEnvelope());
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("local");
    expect(local.length).toBe(1);
  });
});
