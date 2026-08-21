import { afterEach, describe, expect, it, vi } from "vitest";

import { createCsprngUuid, createMessageId } from "../src/ids.js";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("CSPRNG UUID", () => {
  const cryptoObj = globalThis.crypto;
  const originalRandomUUID = cryptoObj.randomUUID;
  const originalGetRandomValues = cryptoObj.getRandomValues;

  afterEach(() => {
    Object.defineProperty(cryptoObj, "randomUUID", {
      value: originalRandomUUID,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(cryptoObj, "getRandomValues", {
      value: originalGetRandomValues,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("uses crypto.randomUUID when the runtime provides it", () => {
    expect(createMessageId()).toMatch(UUID_V4);
    expect(createCsprngUuid()).toMatch(UUID_V4);
  });

  it("mints RFC 4122 UUID v4 from getRandomValues when randomUUID is missing (Hermes)", () => {
    Object.defineProperty(cryptoObj, "randomUUID", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(typeof globalThis.crypto.randomUUID).not.toBe("function");
    expect(typeof globalThis.crypto.getRandomValues).toBe("function");

    const first = createMessageId();
    const second = createCsprngUuid();
    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });

  it("throws when CSPRNG is missing and does not call Math.random", () => {
    Object.defineProperty(cryptoObj, "randomUUID", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(cryptoObj, "getRandomValues", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const spy = vi.spyOn(Math, "random");
    expect(() => createCsprngUuid()).toThrow(/CSPRNG UUID is unavailable on this runtime/);
    expect(() => createMessageId()).toThrow(/CSPRNG UUID is unavailable on this runtime/);
    expect(spy).not.toHaveBeenCalled();
  });
});
