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

Settings → **Device diagnostics** (also linked from Login in development). It reports API `/health`, identity loaded/error (no secret keys), SecureStore probe `hop.diag.probe`, internet, Bluetooth, BLE scan/connect, peer TOFU state, transport, and encryption ready/error.

A localhost API URL is flagged as invalid for a physical iPhone. It does **not** crash the Simulator.

## Identity storage

Development client + Metro: `__DEV__` is true, so a missing SecureStore may fall back to memory (web/tests). **TestFlight / release must keep fail-closed** (`__DEV__` false / `NODE_ENV=production`) — do not weaken that. This development build uses the `expo-secure-store` plugin (iOS Keychain).

## What this does not do

- It does not enable background BLE (`UIBackgroundModes` bluetooth-central/peripheral are off; Nearby still stops when the app is backgrounded).
- It does not include `hop-ble-server`, `react-native-ble-plx`, or Expo Go.
- Seeing Bluetooth **Ready** on diagnostics is not a hardware BLE pass. Encrypted Nearby send on two physical phones is a separate procedure: `docs/BLE_TESTING.md`.

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
