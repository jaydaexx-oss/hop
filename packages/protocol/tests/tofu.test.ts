import { describe, expect, it } from "vitest";

import { PublicKeyTofu, type PeerTrustRecord } from "../src/tofu.js";

describe("persistent peer TOFU", () => {
  it("trusts the first public key and detects a later change without overwriting", () => {
    const tofu = new PublicKeyTofu();
    expect(tofu.state("blake")).toBe("UNKNOWN");
    expect(tofu.observe("blake", "pk-1")).toBe("TOFU_TRUSTED");
    expect(tofu.bind("blake", "pk-1")).toBe(true);
    expect(tofu.observe("blake", "pk-1")).toBe("TOFU_TRUSTED");
    expect(tofu.observe("blake", "pk-2")).toBe("KEY_CHANGED");
    expect(tofu.bind("blake", "pk-2")).toBe(false);
    expect(tofu.get("blake")).toBe("pk-1");
    expect(tofu.state("blake")).toBe("KEY_CHANGED");
    expect(tofu.canEncryptTo("blake", "pk-2")).toBe(false);
    expect(() => tofu.requireTrustedPublicKey("blake")).toThrow(/key changed/i);
  });

  it("does not auto-trust KEY_CHANGED; acceptChangedKey is explicit", () => {
    const tofu = new PublicKeyTofu();
    tofu.observe("blake", "pk-1");
    tofu.observe("blake", "pk-2");
    expect(tofu.state("blake")).toBe("KEY_CHANGED");
    expect(tofu.markVerified("blake")).toBe(false);
    tofu.acceptChangedKey("blake", "pk-2");
    expect(tofu.state("blake")).toBe("TOFU_TRUSTED");
    expect(tofu.get("blake")).toBe("pk-2");
    expect(tofu.markVerified("blake")).toBe(true);
    expect(tofu.state("blake")).toBe("VERIFIED");
    expect(tofu.observe("blake", "pk-2")).toBe("VERIFIED");
  });

  it("hydrates from a persistence adapter across instances", async () => {
    const saved = new Map<string, PeerTrustRecord>();
    const persist = {
      async loadAll() {
        return [...saved.values()];
      },
      async save(record: PeerTrustRecord) {
        saved.set(record.userId, record);
      },
    };
    const first = new PublicKeyTofu(persist);
    first.observe("blake", "pk-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    first.observe("blake", "pk-evil");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = new PublicKeyTofu(persist);
    await second.hydrate();
    expect(second.state("blake")).toBe("KEY_CHANGED");
    expect(second.get("blake")).toBe("pk-1");
    expect(second.bind("blake", "pk-evil")).toBe(false);
  });
});
