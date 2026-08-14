import { describe, expect, it } from "vitest";
import { encodeUnencryptedText } from "../src/payload.js";
import { decideRelay, forwardedEnvelope, visitedPath } from "../src/relayPolicy.js";
import { createMessage } from "../src/message.js";
import { toEnvelope } from "../src/transport.js";
import { CRYPTO_BOX_ALG } from "../src/cryptoBox.js";

function boxed(overrides: Record<string, unknown> = {}) {
  const message = createMessage({ sender_id: "A", recipient_id: "C", conversation_id: "c" });
  return toEnvelope({
    ...message,
    encrypted_payload: JSON.stringify({
      v: 1,
      alg: CRYPTO_BOX_ALG,
      sender_pk: "pk",
      nonce: "n",
      ciphertext: "c",
    }),
    path: ["A"],
    ...overrides,
  });
}

describe("relay policy", () => {
  it("delivers when this node is the recipient", () => {
    const decision = decideRelay({
      selfId: "C",
      envelope: boxed({ recipient_id: "C" }),
      neighbors: ["B"],
      consent: false,
      duplicate: false,
    });
    expect(decision.action).toBe("deliver");
  });

  it("acks duplicates without forwarding again", () => {
    const decision = decideRelay({
      selfId: "B",
      envelope: boxed(),
      neighbors: ["C"],
      consent: true,
      duplicate: true,
    });
    expect(decision.action).toBe("ack_duplicate");
  });

  it("requires consent to relay", () => {
    const decision = decideRelay({
      selfId: "B",
      envelope: boxed(),
      neighbors: ["C"],
      consent: false,
      duplicate: false,
    });
    expect(decision).toMatchObject({ action: "drop", reason: "no_consent" });
  });

  it("prevents loops using the visited path", () => {
    const decision = decideRelay({
      selfId: "B",
      envelope: boxed({ path: ["A", "B"] }),
      neighbors: ["A", "C"],
      consent: true,
      duplicate: false,
    });
    expect(decision).toMatchObject({ action: "drop", reason: "loop" });
  });

  it("stops at max hops and expiration", () => {
    const hops = decideRelay({
      selfId: "B",
      envelope: boxed({ hop_count: 8 }),
      neighbors: ["C"],
      consent: true,
      duplicate: false,
    });
    expect(hops).toMatchObject({ action: "drop", reason: "max_hops" });

    const expired = decideRelay({
      selfId: "B",
      envelope: boxed({ expires_at: "2000-01-01T00:00:00.000Z" }),
      neighbors: ["C"],
      consent: true,
      duplicate: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(expired).toMatchObject({ action: "drop", reason: "expired" });
  });

  it("drops alg:none so a relay cannot be used to carry plaintext", () => {
    const envelope = boxed({ encrypted_payload: encodeUnencryptedText("secret") });
    const decision = decideRelay({
      selfId: "B",
      envelope,
      neighbors: ["C"],
      consent: true,
      duplicate: false,
    });
    expect(decision).toMatchObject({ action: "drop", reason: "unauthenticated" });
  });

  it("forwards to the recipient if neighboring, else another unused hop", () => {
    const toRecipient = decideRelay({
      selfId: "B",
      envelope: boxed(),
      neighbors: ["A", "C"],
      consent: true,
      duplicate: false,
    });
    expect(toRecipient.action).toBe("relay");
    if (toRecipient.action === "relay") {
      expect(toRecipient.nextHop).toBe("C");
      expect(toRecipient.envelope.hop_count).toBe(1);
      expect(visitedPath(toRecipient.envelope)).toEqual(["A", "B"]);
    }

    const broken = decideRelay({
      selfId: "B",
      envelope: boxed(),
      neighbors: ["A"],
      consent: true,
      duplicate: false,
    });
    expect(broken).toMatchObject({ action: "drop", reason: "broken_route" });
  });

  it("drops when the visited path is longer than MAX_HOPS even if hop_count is low", () => {
    const padded = boxed({ hop_count: 0, path: ["A", "X1", "X2", "X3", "X4", "X5", "X6", "X7"] });
    const decision = decideRelay({
      selfId: "B",
      envelope: padded,
      neighbors: ["C"],
      consent: true,
      duplicate: false,
    });
    expect(decision).toMatchObject({ action: "drop", reason: "max_hops" });
  });

  it("increments hop_count on forward", () => {
    const next = forwardedEnvelope(boxed({ hop_count: 2, path: ["A", "B"] }), "C");
    expect(next.hop_count).toBe(3);
    expect(next.path).toEqual(["A", "B", "C"]);
    expect(next.transport).toBe("relay");
  });
});
