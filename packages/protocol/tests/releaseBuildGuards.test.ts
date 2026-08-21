import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_PRODUCTION_TRANSPORT_IDS,
  PRODUCTION_APP_TRANSPORT_IDS,
  assertProductionTransportSet,
  createProductionAppTransportManager,
  describeProofRoute,
  describeTransportSelection,
  isSafeDiagnosticsText,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function readRepo(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

const http: HopHttpClient = {
  async request() {
    return { ok: false, status: 0, data: null };
  },
};

describe("production app transport registration", () => {
  it("registers internet, bluetooth, and local only", () => {
    const manager = createProductionAppTransportManager(http);
    const ids = manager.registeredIds();
    expect(ids).toEqual([...PRODUCTION_APP_TRANSPORT_IDS]);
    expect(ids).not.toContain("relay");
    expect(manager.getTransport("relay")).toBeUndefined();
    assertProductionTransportSet(ids);
  });

  it("refuses a relay id in the production set", () => {
    expect(() => assertProductionTransportSet(["internet", "bluetooth", "relay", "local"])).toThrow(
      /relay/,
    );
    expect(FORBIDDEN_PRODUCTION_TRANSPORT_IDS).toEqual(["relay"]);
  });
});

describe("mobile production send path source", () => {
  it("hopRuntime uses the production helper and does not register mocks", () => {
    const src = readRepo("apps/mobile/src/hopRuntime.ts");
    expect(src).toContain("createProductionAppTransportManager");
    expect(src).not.toMatch(/SimulatedNetwork/);
    expect(src).not.toMatch(/createRelayTransport/);
    expect(src).not.toMatch(/defaultTransportManager/);
  });

  it("release builds gate debug BLE ping, diagnostics, and secret fallback", () => {
    const ble = readRepo("apps/mobile/src/ble/BleProvider.tsx");
    expect(ble).toMatch(/if \(!__DEV__\) \{[\s\S]*Nearby debug ping is not available in production builds/);
    const diagnostics = readRepo("apps/mobile/app/device-diagnostics.tsx");
    expect(diagnostics).toContain("isDeveloperScreenEnabled(__DEV__)");
    expect(diagnostics).toContain('Redirect href="/(tabs)/settings"');
    expect(diagnostics).not.toContain("Diagnostics are not available in this build");
    expect(diagnostics).toContain("Replace local identity keys");
    expect(diagnostics).toContain("BLE debug");
    const settings = readRepo("apps/mobile/app/(tabs)/settings.tsx");
    expect(settings).not.toContain("Replace local identity keys");
    expect(settings).not.toContain("Device diagnostics");
    expect(settings).not.toContain("BLE debug");
    expect(settings).not.toMatch(/buttonLabel[\s\S]*Replace local identity keys/);
    expect(settings).toContain("Reset HOP on this device");
    expect(settings).not.toMatch(/Log out/);
    expect(settings).toMatch(/if \(!__DEV__\) return;[\s\S]*router\.push\('\/device-diagnostics'\)/);
    const login = readRepo("apps/mobile/app/login.tsx");
    expect(login).not.toContain("Device diagnostics");
    expect(login).not.toContain("Welcome back");
    expect(login).not.toContain("I already have an account");
    expect(login).not.toMatch(/placeholder=["']Password["']/);
    expect(login).not.toMatch(/placeholder=["']Username["']/);
    expect(login).toContain("HANDLE_TAKEN_RECOVER_COPY");
    expect(login).toContain("RECOVER_MY_HOP_LABEL");
    expect(login).toContain('placeholder="One-time recovery password"');
    const appJson = readRepo("apps/mobile/app.json");
    expect(appJson).toContain("webcredentials:hop-uokqmg.fly.dev");
    const layout = readRepo("apps/mobile/app/_layout.tsx");
    expect(layout).toMatch(/\{__DEV__ \? <Stack\.Screen name="device-diagnostics"/);
    expect(layout).toMatch(/\{__DEV__ \? <Stack\.Screen name="ble-debug"/);
    const bleDebug = readRepo("apps/mobile/app/ble-debug.tsx");
    expect(bleDebug).toContain("isDeveloperScreenEnabled(__DEV__)");
    expect(bleDebug).toContain('Redirect href="/(tabs)/settings"');
    expect(bleDebug).toContain("Selected transport");
    expect(bleDebug).toContain("Send result");
    expect(bleDebug).toContain("Link ACK result");
    expect(bleDebug).not.toMatch(/connectedId/);
    expect(bleDebug).not.toMatch(/deviceId/);
    const hopApi = readRepo("apps/mobile/src/api/hop.ts");
    expect(hopApi).toContain("X-Hop-Install");
    const onboarding = readRepo("apps/mobile/src/auth/deviceOnboarding.ts");
    expect(onboarding).toContain("hashedInstallHeaderValue");
    expect(onboarding).toMatch(/Local SecureStore wipe only/);
    expect(onboarding).not.toMatch(/\/users\/me\/blocks/);
    const hopBle = readRepo("apps/mobile/src/ble/HopBleEngine.ts");
    expect(hopBle).toMatch(/HOP_BLE_HANDSHAKE_UUID[\s\S]*properties: \['read', 'write', 'notify'\]/);
    const secrets = readRepo("apps/mobile/src/crypto/secretStore.ts");
    expect(secrets).toContain("shouldFailClosedSecretStore");
    expect(secrets).toMatch(/__DEV__/);
  });
});

describe("transport selection diagnostics copy", () => {
  it("describes internet preference and local fallback without leaking crypto", () => {
    expect(
      describeTransportSelection({
        networkStatus: "Online",
        bleImplemented: true,
        bleBlockedReason: null,
      }),
    ).toEqual({
      selected: "internet",
      reason: "API /health reachable; internet is preferred over BLE.",
    });
    expect(
      describeTransportSelection({
        networkStatus: "Queued",
        bleImplemented: false,
        bleBlockedReason: "Nearby BLE cannot run in Expo Go. Install a HOP development build on a physical device.",
      }).selected,
    ).toBe("local");
    expect(isSafeDiagnosticsText("Bluetooth permission granted.")).toBe(true);
    expect(isSafeDiagnosticsText("ciphertext ABC")).toBe(false);
    expect(isSafeDiagnosticsText("crypto_box payload")).toBe(false);
    expect(isSafeDiagnosticsText("audio_b64 clip")).toBe(false);
  });

  it("describes internet vs authenticated BLE vs queue without two-phone claims", () => {
    expect(
      describeProofRoute({
        internetHealthOk: true,
        bleRadioReady: true,
        authenticatedPeerMapped: true,
      }).selected,
    ).toBe("internet");
    expect(
      describeProofRoute({
        internetHealthOk: false,
        bleRadioReady: true,
        authenticatedPeerMapped: true,
      }),
    ).toMatchObject({ selected: "bluetooth" });
    expect(
      describeProofRoute({
        internetHealthOk: false,
        bleRadioReady: true,
        authenticatedPeerMapped: false,
      }).selected,
    ).toBe("local");
  });
});
