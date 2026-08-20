import { describe, expect, it } from "vitest";

import {
  IDENTITY_RECOVERY_EXTENSION_POINTS,
  recoveryNotRequiredForOnboarding,
} from "../src/identityRecovery.js";

describe("identity recovery architecture stub", () => {
  it("is not required for onboarding", () => {
    expect(recoveryNotRequiredForOnboarding()).toBe(true);
    expect(IDENTITY_RECOVERY_EXTENSION_POINTS).toEqual([
      "recovery_code",
      "icloud_keychain",
      "optional_email",
      "optional_phone",
    ]);
  });
});
