# Mobile dependency security (npm audit vs app risk)

**Date:** 2026-08-16  
**App:** `apps/mobile` (Expo 57 / React Native 0.86)  
**Policy:** do not run `npm audit fix --force`. A force fix would install `expo@53`, which is a breaking downgrade from Expo 57.

This document distinguishes **what npm reports** from **whether the HOP production send path is actually vulnerable**.

## npm reports (this phase)

`npm audit` and `npm audit --omit=dev` both report **22 vulnerabilities (8 moderate, 14 high)**. There are **no CRITICAL** findings. Every HIGH/MODERATE item is a **toolchain transitive**. None is a direct HOP crypto/messaging dependency.

| Advisory | Severity | Via | Production send-path reachable? | Action |
|---|---|---|---|---|
| `image-size` ICNS/JXL/HEIF infinite-loop DoS ([GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)) | high | `metro` → `@expo/metro` / `expo` / `react-native` | **No.** Metro parses images at **bundle/dev** time. It is not imported by `MessageService`, `crypto_box`, or `HopBleEngine`. | Leave. `--force` → Expo 53. |
| `uuid` buffer bounds in v3/v5/v6 when `buf` is provided ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)) | moderate | `xcode` → `@expo/config-plugins` | **No.** iOS **prebuild** toolchain. HOP message IDs use protocol `createMessageId`, not this `uuid` API. | Leave. `--force` → Expo 53. |

`packages/protocol` `npm audit`: **0 vulnerabilities**.

## What would actually be a production-reachable vuln

Examples that **would** be patched in this phase if present:

- A HIGH/CRITICAL in `libsodium-wrappers` used by `encryptApplicationMessage`
- A HIGH/CRITICAL in `expo-secure-store` that bypasses fail-closed identity storage
- A HIGH/CRITICAL in `expo-sqlite` that leaks plaintext (HOP stores ciphertext + `local_seal`)

None of those appear in this audit.

## Safe vs unsafe fixes

| Command | Used? |
|---|---|
| `npm audit fix` (non-force) | Not applied; remaining issues require `--force`. |
| `npm audit fix --force` | **Forbidden** here. Breaks Expo 57 / RN 0.86. |

Re-audit after a future Expo SDK upgrade that carries a patched Metro/`image-size`.
