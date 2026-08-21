import { describe, expect, it } from "vitest";
import {
  PRODUCTION_API_HOST,
  assertSafeApiUrl,
  classifyApiDeployment,
  kindFromApiUrl,
  kindFromVersionEnv,
  resolveApiUrl,
} from "../src/apiUrlPolicy.js";

describe("API URL policy", () => {
  it("defaults localhost only in development", () => {
    expect(resolveApiUrl(undefined, true)).toBe("http://127.0.0.1:8000");
    expect(() => resolveApiUrl(undefined, false)).toThrow(/EXPO_PUBLIC_API_URL is required/);
    expect(resolveApiUrl("https://api.hop.example", false)).toBe("https://api.hop.example");
  });

  it("allows localhost and LAN HTTP in development", () => {
    assertSafeApiUrl("http://127.0.0.1:8000", { isDev: true });
    assertSafeApiUrl("http://192.168.1.20:8000", { isDev: true });
    assertSafeApiUrl("https://api.example.com", { isDev: true });
  });

  it("refuses localhost and cleartext HTTP in release", () => {
    expect(() => assertSafeApiUrl("http://127.0.0.1:8000", { isDev: false })).toThrow(/localhost/);
    expect(() => assertSafeApiUrl("https://localhost:8000", { isDev: false })).toThrow(/localhost/);
    expect(() => assertSafeApiUrl("http://10.0.2.2:8000", { isDev: false })).toThrow(/localhost/);
    expect(() => assertSafeApiUrl("http://api.example.com", { isDev: false })).toThrow(/HTTPS/);
    assertSafeApiUrl("https://api.example.com", { isDev: false });
  });

  it("allows staging cleartext HTTP only with the flag and never localhost", () => {
    assertSafeApiUrl("http://api.staging.example", { isDev: false, allowCleartextHttp: true });
    expect(() =>
      assertSafeApiUrl("http://127.0.0.1:8000", { isDev: false, allowCleartextHttp: true }),
    ).toThrow(/localhost/);
  });

  it("labels hop-uokqmg.fly.dev as PRODUCTION from the URL, not a fake flag", () => {
    expect(PRODUCTION_API_HOST).toBe("hop-uokqmg.fly.dev");
    expect(kindFromApiUrl("https://hop-uokqmg.fly.dev")).toBe("production");
    expect(classifyApiDeployment("https://hop-uokqmg.fly.dev").label).toBe("PRODUCTION");
    expect(classifyApiDeployment("https://hop-uokqmg.fly.dev", "production").label).toBe("PRODUCTION");
  });

  it("labels loopback and RFC1918 LAN as DEV", () => {
    expect(kindFromApiUrl("http://127.0.0.1:8000")).toBe("development");
    expect(kindFromApiUrl("http://localhost:8000")).toBe("development");
    expect(kindFromApiUrl("http://192.168.1.170:8000")).toBe("development");
    expect(classifyApiDeployment("http://192.168.1.170:8000", "development").label).toBe("DEV");
  });

  it("uses /version env when the URL is not local and not hop-uokqmg", () => {
    expect(kindFromApiUrl("https://api.example.com")).toBeNull();
    expect(kindFromVersionEnv("development")).toBe("development");
    expect(classifyApiDeployment("https://api.example.com", "development").label).toBe("DEV");
    expect(classifyApiDeployment("https://api.example.com", "production").label).toBe("PRODUCTION");
  });

  it("flags a mismatch when URL and /version env disagree", () => {
    const mismatch = classifyApiDeployment("https://hop-uokqmg.fly.dev", "development");
    expect(mismatch.label).toBe("PRODUCTION");
    expect(mismatch.mismatch).toBe(true);
    const localMismatch = classifyApiDeployment("http://127.0.0.1:8000", "production");
    expect(localMismatch.label).toBe("DEV");
    expect(localMismatch.mismatch).toBe(true);
  });

  it("fails closed to PRODUCTION for an unknown remote URL before /version loads", () => {
    expect(classifyApiDeployment("https://api.example.com").label).toBe("PRODUCTION");
  });
});
