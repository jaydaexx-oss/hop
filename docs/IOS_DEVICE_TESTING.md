# Install HOP on a physical iPhone

This is the install path for **this repo state** (`integration/production-stabilization`). It prepares a **development client**. It does **not** prove Nearby BLE works on hardware.

Do **not** use Expo Go. `munim-bluetooth` and the GATT peripheral path are native modules; Expo Go cannot load them.

Generated `apps/mobile/ios/` is gitignored (Expo CNG). `app.json` is the source of truth. Do **not** run `expo prebuild` locally unless you are on the USB/Xcode path below — EAS cloud runs prebuild when `ios/` is absent.

There is **no EAS `projectId`** in `app.json` (do not invent one). Cloud iOS development builds need `npx eas-cli login` then `npx eas-cli init` on an Expo account before `eas build`. Skip TestFlight / `preview` / `production` store profiles until a paid Apple team is connected. USB development-client path is still valid if you have Xcode.

## iPhone 16 Pro — copy-paste (production API)

On the Mac, with the iPhone 16 Pro connected by USB, Developer Mode on, and this computer trusted:

```bash
cd /Users/jaydae/hop
git checkout integration/production-stabilization
cp apps/mobile/.env.example apps/mobile/.env
# Confirm (no secrets in this file):  grep EXPO_PUBLIC_API_URL apps/mobile/.env
# Expected: EXPO_PUBLIC_API_URL=https://hop-uokqmg.fly.dev

cd apps/mobile
npm install
npx expo prebuild --platform ios
npx expo run:ios --device
```

If Xcode is not selected yet:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
export LANG=en_US.UTF-8
```

If `expo run:ios --device` opens Xcode: choose the iPhone 16 Pro as the run destination, set Signing Team (your Apple ID), bundle id `app.hop.mobile`, then Run. First launch: **Settings → General → VPN & Device Management** → trust the developer.

If Metro is not running after install:

```bash
cd /Users/jaydae/hop/apps/mobile
npx expo start --dev-client
```

Open the installed **HOP** app (not Expo Go). Register: username 3–20 chars, starts with a letter, letters/numbers/`_` only; password ≥ 8 characters. Then Settings → Device diagnostics → API `/health` should show the Fly host, not localhost.

## What you need

- A Mac with **Xcode** (the full app, not only Command Line Tools)
- An Apple ID / development team for signing
- A physical iPhone, USB cable, Developer Mode on, the computer trusted
- The HOP API reachable from the phone. For this branch, that is the live Fly HTTPS API (no LAN API required).

## 1. Point the app at the production API

`http://127.0.0.1:8000` is this Mac (or the Simulator). On a physical iPhone, localhost is **the phone** and cannot reach your Mac.

**Recommended for iPhone 16 Pro / live e2e:** the Fly app `hop-uokqmg` (never `hop-api`).

Copy `apps/mobile/.env.example` to `apps/mobile/.env` if `.env` is missing. The example already sets:

```bash
EXPO_PUBLIC_API_URL=https://hop-uokqmg.fly.dev
```

Native iOS does not use CORS. `fly.toml` `CORS_ORIGINS` is the API origin itself (restrictive HTTPS allow-list). Expo web against this API from `http://localhost:8081` would be blocked; do not test e2e in the browser.

Restart Metro after changing `EXPO_PUBLIC_API_URL` (the value is inlined at bundle time).

### Optional: Mac LAN API instead of production

Only if you are intentionally hitting a local uvicorn, not Fly:

```bash
ipconfig getifaddr en0
```

```bash
cd apps/api
source .venv/bin/activate   # if you use the project venv
DATABASE_URL=sqlite:///./hop.db CORS_ORIGINS=http://localhost:8081 \
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Then in `apps/mobile/.env`: `EXPO_PUBLIC_API_URL=http://<MAC_LAN_IP>:8000` (example `http://192.168.1.23:8000`). Development clients allow RFC1918 LAN HTTP; release builds (`__DEV__ === false`) refuse it.

## 2. Install the native app (USB)

```bash
cd apps/mobile
npm install
npx expo prebuild --platform ios
npx expo run:ios --device
```

Xcode will ask you to pick the connected iPhone and a **Signing Team** (your Apple ID / paid team). Enable **Automatically manage signing** if prompted. Bundle id is `app.hop.mobile`.

If `expo run:ios --device` opens Xcode: select the iPhone as the run destination, pick the team under **Signing & Capabilities**, then Run.

First launch: trust the developer on the iPhone if iOS asks (**Settings → General → VPN & Device Management**).

Grant **Bluetooth** when Nearby (or Device diagnostics) prompts. Grant **Microphone** when you use PTT. Grant **Local Network** if iOS asks (LAN API).

## 3. Metro after the binary is installed

If `expo run:ios` did not leave Metro running:

```bash
cd apps/mobile
npx expo start --dev-client
```

The installed HOP development client loads JS from Metro. Do not scan the Expo Go QR code.

## EAS alternative (no local Xcode compile)

Requires an Expo account. Internal-distribution signing on a physical iPhone usually needs a **paid** Apple Developer team connected to EAS (a free Apple ID is typically USB/Xcode only). BLE still requires this development client — not Expo Go.

`eas.json` `development` is `developmentClient: true`, `distribution: internal`, `ios.simulator: false` (device, not Simulator). Cloud env sets `EXPO_PUBLIC_API_URL=https://hop-uokqmg.fly.dev` (public origin, not a secret). `ios/` is gitignored, so EAS runs CNG prebuild on the cloud.

```bash
cd /Users/jaydae/hop/apps/mobile
npx eas-cli login
npx eas-cli init
npx eas-cli build --profile development --platform ios
```

`eas init` writes `extra.eas.projectId` — do not invent a UUID. After the IPA installs, start Metro (`npx expo start --dev-client`) and open the **HOP** app, not Expo Go. JS still inlines `EXPO_PUBLIC_API_URL` at Metro bundle time from `apps/mobile/.env` if you override the Fly origin.

## Device diagnostics (`__DEV__` only)

Settings → **Device diagnostics** (also linked from Login in development). Release builds (`__DEV__ === false`) show “Diagnostics are not available in this build.” There is no production backdoor.

It reports:

- API `/health` (host only; localhost is flagged as invalid on a physical iPhone)
- Identity loaded/error (no secret keys)
- SecureStore probe `hop.diag.probe`
- Internet / transport selected / fallback reason
- Bluetooth permission, adapter on/off, advertising, scanning, GATT registration, connection count, MTU if the stack returns one, handshake phase
- Peer TOFU state (fingerprint hint only)
- Encryption ready/error

**One-phone BLE rows are technical state on this device. They are not two-phone radio proof.** Do not raise the BLE score from this screen.

No private keys, plaintext, voice clips, or `crypto_box` payloads are shown.

## Development-device validation checklist (one physical iPhone)

This is **isolated development-device validation**, not a product feature and not App Store proof. Use a development client (`eas.json` `development` / `expo-dev-client`). Do not weaken production security. Do not add test backdoors.

Record pass/fail. Until recorded, do not award hardware or live-HTTPS points.

### Permissions

- [ ] Bluetooth prompt appears; grant or deny is reflected on Device diagnostics (**BT permission**)
- [ ] Microphone prompt appears when holding PTT (not probed by diagnostics)
- [ ] Local Network prompt appears if iOS asks (LAN HTTP API)
- [ ] Diagnostics **Adapter** matches Control Center Bluetooth on/off

### Account and identity

- [ ] Register a new username against the reachable API (LAN HTTP in `__DEV__`, or HTTPS)
- [ ] Log out and log back in
- [ ] Identity row is **Loaded**; secret key is not displayed
- [ ] SecureStore probe is **Available**
- [ ] Settings → Replace local identity keys → server 409 `SERVER_KEY_LOCKED` if a different key was already published (fail closed; recovery is a new account)

### Internet messaging (this phone ↔ API)

- [ ] Start a 1:1 chat with a second account (second phone, or a second install / web is not provided — use another device or skip and mark blocked)
- [ ] Send a text; ciphertext is stored (no plaintext in API DB / logs)
- [ ] Receive and decrypt on the other client if available
- [ ] Kill the app, relaunch, conversation list and ciphertext queue persist (`expo-sqlite`)

A single phone talking to a LAN API is **not** live non-localhost HTTPS proof.

### PTT (this phone)

- [ ] Hold PTT: record ≤ cap, encrypt, send
- [ ] Playback of a received (or loopback if you have two accounts) clip
- [ ] Recording URI deleted after send/cancel; leftover `hop-voice*` cleaned on launch
- [ ] Waveform remains decorative (not a hardware fail)

Mic/playback/transport/queue on a physical phone is still required for PTT score credit.

### One-phone BLE diagnostics (not two-phone proof)

- [ ] Nearby / diagnostics: permission, adapter, advertising, scanning, GATT registration
- [ ] MTU value or “Unavailable (iOS negotiates internally)”
- [ ] Handshake state stays **Idle** or **GATT announced** until a second phone connects
- [ ] Transport selected / fallback reason match whether `/health` is reachable

Two-phone encrypted Nearby remains `docs/BLE_TESTING.md`.

## Identity storage

Development client + Metro: `__DEV__` is true, so a missing SecureStore may fall back to memory (web/tests). **TestFlight / release must keep fail-closed** (`__DEV__` false / `NODE_ENV=production`) — do not weaken that. This development build uses the `expo-secure-store` plugin (iOS Keychain).

## What this does not do

- It does not enable background BLE (`UIBackgroundModes` bluetooth-central/peripheral are off; Nearby still stops when the app is backgrounded).
- It does not include `hop-ble-server`, `react-native-ble-plx`, or Expo Go.
- Seeing Bluetooth **Ready** or GATT **Registered** on diagnostics is not a hardware BLE pass. Encrypted Nearby send on two physical phones is a separate procedure: `docs/BLE_TESTING.md`.
- Apple Developer **paid membership** is required for TestFlight / App Store / EAS `production` + `projectId`. A free Apple ID can often run a USB development client on a personal iPhone (7-day signature) but cannot ship TestFlight.
- A live **non-localhost HTTPS** API is required before internet messaging can receive full credit. LAN HTTP is development-device validation only.

## Blockers on a machine with no Xcode.app

This environment generated `apps/mobile/ios/` from `app.json` (`npx expo prebuild --platform ios`) but **could not compile or sign**:

- Full **Xcode.app is not installed** (`xcode-select` points at Command Line Tools only)
- `pod install` failed: `xcodebuild` requires Xcode, plus CocoaPods wants `LANG=en_US.UTF-8`
- No signed IPA was produced here — that is expected

`apps/mobile/ios/` is gitignored (Expo CNG). On your Mac, install Xcode from the App Store, then:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
export LANG=en_US.UTF-8
cd apps/mobile
npx expo prebuild --platform ios
npx expo run:ios --device
```

Generated Info.plist (from this prebuild) includes Bluetooth + microphone strings, `NSAllowsLocalNetworking`, and **no** `UIBackgroundModes` bluetooth-central/peripheral. Identity uses `expo-secure-store` (Keychain). Entitlements file is empty on purpose.
