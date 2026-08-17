import { describe, expect, it } from "vitest";
import { assertSafeApiUrl, resolveApiUrl } from "../src/apiUrlPolicy.js";

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
    expect(() => assertSafeApiUrl("http://api.example.com", { isDev: false })).toThrow(/HTTPS/);
    assertSafeApiUrl("https://api.example.com", { isDev: false });
  });

  it("allows staging cleartext HTTP only with the flag and never localhost", () => {
    assertSafeApiUrl("http://api.staging.example", { isDev: false, allowCleartextHttp: true });
    expect(() =>
      assertSafeApiUrl("http://127.0.0.1:8000", { isDev: false, allowCleartextHttp: true }),
    ).toThrow(/localhost/);
  });
});
