import { describe, expect, it } from "vitest";

describe("HopSodium Expo native module", () => {
  it.skipIf(process.env.EXPO_OS !== "ios" && process.env.EXPO_OS !== "android")(
    "loads official libsodium C via requireNativeModule on a device/simulator",
    async () => {
      const { getHopSodiumNativeModule } = await import("../../modules/hop-sodium/src/HopSodiumModule");
      const native = getHopSodiumNativeModule();
      expect(native).not.toBeNull();
      expect(native?.crypto_box_NONCEBYTES).toBe(24);
      expect(native?.cryptoBoxBeforenm).toBeTypeOf("function");
      expect(native?.version).toBe("1.0.20");
    },
  );

  it("is not linked in Node Vitest", () => {
    expect(process.env.EXPO_OS === "ios" || process.env.EXPO_OS === "android").toBe(false);
  });
});
