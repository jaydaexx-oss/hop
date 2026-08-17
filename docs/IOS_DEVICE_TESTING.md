# Install HOP on a physical iPhone

This is the install path for **this repo state** (`integration/production-stabilization`). It prepares a **development client**. It does **not** prove Nearby BLE works on hardware.

Do **not** use Expo Go. `munim-bluetooth` and the GATT peripheral path are native modules; Expo Go cannot load them.

Generated `apps/mobile/ios/` is gitignored (Expo CNG). `app.json` is the source of truth.

## What you need

- A Mac with **Xcode** (the full app, not only Command Line Tools)
- An Apple ID / development team for signing
- A physical iPhone, USB cable, Developer Mode on, the computer trusted
- The HOP API reachable from the phone (LAN HTTP or production HTTPS)

## 1. API the phone can actually reach

`http://127.0.0.1:8000` is this Mac (or the Simulator). On a physical iPhone, localhost is **the phone**.

Find the Mac LAN IP:

```bash
ipconfig getifaddr en0
```

Run the API on all interfaces (from `apps/api`, with your usual env / venv):

```bash
cd apps/api
source .venv/bin/activate   # if you use the project venv
DATABASE_URL=sqlite:///./hop.db CORS_ORIGINS=http://localhost:8081 \
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Allow port 8000 through the Mac firewall if prompted.

In `apps/mobile/.env` (copy from `apps/mobile/.env.example`):

```bash
EXPO_PUBLIC_API_URL=http://<MAC_LAN_IP>:8000
```

Example: `EXPO_PUBLIC_API_URL=http://192.168.1.23:8000`.

Production / TestFlight must use `https://<API_DOMAIN>` instead. Release builds (`__DEV__ === false`) refuse cleartext HTTP except loopback. Development clients allow RFC1918 LAN HTTP so this LAN path works. iOS ATS `NSAllowsLocalNetworking` is on for that LAN HTTP path.

Restart Metro after changing `EXPO_PUBLIC_API_URL` (the value is inlined at bundle time).

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

Requires an Expo account and an Apple team connected to EAS:

```bash
cd apps/mobile
npx eas-cli login
npx eas-cli build --profile development --platform ios
```

`eas.json` `development` is `developmentClient: true` and `ios.simulator: false`. Install the IPA, then start Metro as above. Set `EXPO_PUBLIC_API_URL` **before** bundling JS (`.env` or EAS env). A cloud-built binary still needs a reachable API.

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
