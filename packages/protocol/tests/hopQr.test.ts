import { describe, expect, it } from "vitest";

import {
  assertHopQrHasNoSecrets,
  createHopInviteToken,
  decodeHopQrPayload,
  encodeHopQrPayload,
  hopQrContainsSecrets,
  hopQrModules,
  hopQrUri,
} from "../src/hopQr.js";

describe("HOP QR payload", () => {
  it("encodes a username plus ephemeral invite and no secrets, keys, or MACs", () => {
    const payload = encodeHopQrPayload({ username: "JayDae" });
    expect(payload.v).toBe(1);
    expect(payload.kind).toBe("hop-contact");
    expect(payload.username).toBe("jaydae");
    expect(payload.invite).toMatch(/^h[a-f0-9]{10}$/);
    const uri = hopQrUri(payload);
    expect(uri).toBe(`hop://u/jaydae?i=${payload.invite}`);
    expect(hopQrContainsSecrets(uri)).toBe(false);
    expect(uri).not.toMatch(/crypto_box|secret|private|AA:BB:CC|identity_public_key/i);
    expect(JSON.stringify(payload)).not.toMatch(/mac|deviceId|uuid/i);
  });

  it("parses hop URIs, JSON, and bare usernames into a message-request identity", () => {
    const encoded = encodeHopQrPayload({ username: "rio_hop", invite: "habcdabcdabcd" });
    expect(decodeHopQrPayload(hopQrUri(encoded))).toEqual(encoded);
    expect(decodeHopQrPayload(JSON.stringify(encoded))?.username).toBe("rio_hop");
    expect(decodeHopQrPayload("Sam_1")?.username).toBe("sam_1");
    expect(decodeHopQrPayload("hop://u/bad user")).toBeNull();
  });

  it("refuses QR payloads that smuggle keys, MACs, or device UUIDs", () => {
    expect(hopQrContainsSecrets('{"username":"a","secret":"s"}')).toBe(true);
    expect(() =>
      assertHopQrHasNoSecrets({
        username: "jaydae",
        identity_public_key: "pk",
      }),
    ).toThrow(/secrets or device IDs/);
    expect(decodeHopQrPayload(JSON.stringify({ v: 1, kind: "hop-contact", username: "jaydae", invite: "aa", secret: "x" }))).toBeNull();
    expect(decodeHopQrPayload("AA:BB:CC:DD:EE:FF")).toBeNull();
    expect(decodeHopQrPayload("11111111-2222-3333-4444-555555555555")).toBeNull();
    expect(createHopInviteToken()).not.toMatch(/-/);
  });

  it("renders QR modules for the hop URI without embedding secrets", () => {
    const payload = encodeHopQrPayload({ username: "hopuser", invite: "h0123456789" });
    const modules = hopQrModules(hopQrUri(payload));
    expect(modules.length).toBeGreaterThanOrEqual(21);
    expect(modules[0]?.length).toBe(modules.length);
    expect(modules.some((row) => row.some(Boolean))).toBe(true);
    expect(() => hopQrModules("secret-key AA:BB:CC:DD:EE:FF")).toThrow(/secrets or device IDs/);
  });
});
