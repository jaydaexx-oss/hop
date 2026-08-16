# Testing Nearby BLE on two physical phones

This is the only test that counts for encrypted BLE. Simulators, emulators, Expo Go, and web **do not** count.

HOP BLE has **not** been verified on hardware in this environment (no Xcode / no attached phones here). Treat the steps below as the acceptance procedure.

## What you need

- One physical **iPhone** (iOS 16.4+)
- One physical **Android** phone (API 31+ strongly recommended; API 24+ may work)
- A Mac with Xcode for the iOS dev client, and Android Studio / SDK for the Android dev client
- Two HOP accounts (different usernames)
- Bluetooth on, phones a few meters apart, screens awake, **Nearby tab open on both**

Expo Go cannot load `munim-bluetooth`. You must install a **development build**. Exact iPhone install + LAN API steps for this repo: **`docs/IOS_DEVICE_TESTING.md`**.

Physical phones must **not** use `EXPO_PUBLIC_API_URL=http://127.0.0.1:8000` (localhost on the phone is the phone). Use `http://<Mac-LAN-IP>:8000` on the same Wi-Fi, with the API bound to `0.0.0.0`, or `https://<API_DOMAIN>`.

## 1. Build development clients

From `apps/mobile` after `npm install`:

### iOS (physical device)

See **`docs/IOS_DEVICE_TESTING.md`** for API URL, signing, and diagnostics.

```bash
cd apps/mobile
npx expo prebuild --platform ios --clean
npx expo run:ios --device
```

Xcode will ask you to pick the connected iPhone. Sign with your Apple development team when prompted. Grant the Bluetooth permission the first time Nearby opens.

### Android (physical device)

```bash
cd apps/mobile
npx expo prebuild --platform android --clean
npx expo run:android --device
```

Enable USB debugging, accept the install, then grant:

- Nearby devices / Bluetooth scan, connect, advertise (Android 12+)
- Location, if the OS still asks (Android 11 and some OEMs)

### EAS alternative

```bash
cd apps/mobile
npx eas-cli login
npx eas-cli build --profile development --platform ios
npx eas-cli build --profile development --platform android
```

Install the two builds on the two phones, then start Metro:

```bash
cd apps/mobile
npx expo start --dev-client
```

Point each installed HOP client at that bundler.

## 2. Accounts

On phone A: register/login as `alice` (example).  
On phone B: register/login as `blake`.

Internet is required for login (and to create the identity keys locally after login). After both sessions exist you can disable Wi-Fi and cellular for the BLE send test. Identity keys live in SecureStore on each phone, not on the server.

## 3. Discovery

1. Turn Bluetooth **on** on both phones.
2. Open **Nearby** on both (leave the tab visible; do not background the app).
3. Allow Bluetooth when prompted.
4. Wait up to ~20 seconds (scan runs in 12s pulses).

**Pass:** each phone lists the other as a **username** (`alice` / `blake` or `HOP:alice`), not a MAC address such as `AA:BB:CC:DD:EE:FF`.

If advertising fails on one OS, the other phone can still advertise; only the scanner side will see a peer. Try swapping which phone you connect from.

## 4. Secure session

1. On phone A, tap **Connect** on Blake.
2. Wait until the row says **Secure session** (fails after 15 seconds if GATT connect or handshake `pk` is missing).

**Pass:** both activity logs mention a secure session / libsodium public key. Connect must fail if the peer still speaks handshake v1 (no `pk`).

## 5. Encrypted application message

1. On phone A, tap **Send encrypted message**.
2. Phone A waits up to 8 seconds for an ack (retries up to 3 times on timeout).
3. Phone B activity log should show `Received encrypted message from alice: nearby ping from alice`.
4. Phone A activity log should show `Sent encrypted message to blake`.

**Pass:** B displays the authenticated plaintext. The payload on the air is `alg: crypto_box_xsalsa20poly1305`, not `alg: none`. Duplicate taps of a *new* message each get a new `message_id`. If A retries the **same** `message_id` (ack timeout), B must not create a second inbox row and must still ack.

## 6. Internet off

1. Disable Wi-Fi and cellular on both phones (Bluetooth stays on).
2. Repeat connect + send encrypted message.

**Pass:** the encrypted message still arrives over BLE.

## 7. Disconnect

1. Tap **Disconnect**, or leave Nearby, or background the app.

**Pass:** the row returns to Not connected. Re-entering Nearby starts a new scan/advertise session. A new connect is required before another encrypted send (handshake `pk` is read again).

## Failures that are OS limits, not product bugs

- Nearby closed or app backgrounded → discovery/send stops (especially iOS).
- iPhone advertising local name truncated or omitted; identity still comes from the handshake characteristic after connect.
- Android 6–11 may require Location on for BLE scans.
- Two iPhones in the background will not keep a HOP mesh alive. That is out of scope.

Do not file “mesh” bugs against this PoC. Multi-hop relay is not implemented.
