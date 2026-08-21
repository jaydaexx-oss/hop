import { hashedInstallHeaderValue, INSTALL_HEADER_NAME } from '@hop/protocol';

import { API_URL, assertSafeApiUrl } from '@/src/api/client';
import { ApiError } from '@/src/api/hop';
import { identityBackend } from '@/src/crypto/identity';

export const RESET_ACCOUNT_CREATION_TEST_COUNTER_LABEL =
  'Reset this network/IP and install test counter';
export const DEV_RESET_SERVER_FLAG_OFF_MESSAGE =
  'This API does not allow resetting the account-creation test counter. Production hop-uokqmg leaves ENABLE_DEV_RATE_LIMIT_RESET off, so the 5/network/IP and 3/install mint limits stay in force. Recover my HOP for an existing handle does not use this limiter. Point Metro EXPO_PUBLIC_API_URL at your Mac LAN API (APP_ENV=development) and tap this control on the phone so that API sees this iPhone’s IP. A Mac curl against localhost cannot clear this phone’s production or cellular IP.';
export const DEV_RESET_SUCCESS_MESSAGE =
  'Cleared register-device mint buckets for this network/IP and this install. Blocks and the 7-day install cooldown were not changed. hop.install.id was not rotated.';
export const DEV_RESET_CONFIRM_MESSAGE =
  'This asks the development API to delete Redis/memory register-device mint keys for this network/IP (5 new accounts / 24h) and this install (3 / 24h). It does not lift blocks, does not delete cooldown rows, and does not mint a new hop.install.id. Against production hop-uokqmg the server flag is off and this will 404. Curl from a Mac clears the Mac’s IP only — this in-app reset is the way to clear this phone’s seen IP on a local test API.';

const RESET_PATH = '/auth/dev/reset-account-creation-limits';

export function isAccountCreationResetActionEnabled(isDev: boolean): boolean {
  return isDev === true;
}

export type AccountCreationResetResult = {
  status: string;
  cleared: string[];
  blocks_unchanged: boolean;
};

/** Hidden __DEV__ diagnostics only. Production builds must not call this. */
export async function resetAccountCreationTestCounter(): Promise<AccountCreationResetResult> {
  if (!isAccountCreationResetActionEnabled(typeof __DEV__ !== 'undefined' && __DEV__)) {
    throw new Error('Account-creation test reset is not available in production builds');
  }
  assertSafeApiUrl(API_URL);
  const installHeader = await hashedInstallHeaderValue(identityBackend);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    [INSTALL_HEADER_NAME]: installHeader,
  };
  let response: Response;
  try {
    response = await fetch(`${API_URL}${RESET_PATH}`, { method: 'POST', headers });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Network error', 0);
  }
  const data = (await response.json().catch(() => ({}))) as AccountCreationResetResult & { detail?: string };
  if (response.status === 404) {
    throw new ApiError(DEV_RESET_SERVER_FLAG_OFF_MESSAGE, 404);
  }
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status);
  }
  return data;
}
