import { describe, expect, it } from "vitest";
import { InternetTransport } from "../src/internetTransport.js";
import { createMessage } from "../src/message.js";
import { encodeUnencryptedText } from "../src/payload.js";
import { toEnvelope } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";
import { LocalTransport } from "../src/localTransport.js";
import { CRYPTO_BOX_ALG } from "../src/cryptoBox.js";
import type { HopHttpClient } from "../src/http.js";

function boxedEnvelope() {
  const message = createMessage({
    sender_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    recipient_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    conversation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
  return toEnvelope({
    ...message,
    encrypted_payload: JSON.stringify({
      v: 1,
      alg: CRYPTO_BOX_ALG,
      sender_pk: "pk",
      nonce: "n",
      ciphertext: "ct",
    }),
  });
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

  it("POSTs an opaque crypto_box payload and refuses alg:none", async () => {
    const seen: unknown[] = [];
    const transport = new InternetTransport(
      mockHttp(async (path, init) => {
        if (path === "/health") return { ok: true, status: 200, data: { status: "ok" } };
        seen.push({ path, init });
        return { ok: true, status: 200, data: { status: "SENT" } };
      }),
    );
    const envelope = boxedEnvelope();
    const result = await transport.send(envelope);
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("internet");
    expect(seen[0]).toMatchObject({
      path: `/conversations/${envelope.conversation_id}/messages`,
      init: {
        method: "POST",
        body: { encrypted_payload: envelope.encrypted_payload, message_id: envelope.message_id },
      },
    });
    const plaintext = toEnvelope({
      ...createMessage({
        sender_id: envelope.sender_id,
        recipient_id: envelope.recipient_id,
        conversation_id: envelope.conversation_id,
      }),
      encrypted_payload: encodeUnencryptedText("hello"),
    });
    const refused = await transport.send(plaintext);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/crypto_box/i);
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
    const result = await manager.enqueue(boxedEnvelope());
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("local");
    expect(local.length).toBe(1);
  });
});
