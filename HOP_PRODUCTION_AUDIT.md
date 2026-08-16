# HOP Production-Readiness Audit

**Date:** 2026-08-16  
**Auditor method:** `git fetch origin`; source tracing on `origin/dev` (= `origin/main`), `origin/feature/smart-transport-ui`, `origin/feature/ptt-port`, `origin/feature/ble-debug-screen`, `origin/legacy-main-backup`, `origin/legacy-replit`. Working tree at audit time: `feature/ptt-port` (`03da702`).  
**Spec:** `HOP_MASTER_SPEC.md` was **not found** anywhere in this repo (root, `docs/`, `attached_assets/`). Secondary sources used: `README.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `docs/API.md`, `docs/BLE_TESTING.md`, `docs/PLATFORM_LIMITATIONS.md`, `docs/RELAY.md`. On `origin/legacy-main-backup`, `attached_assets/` exists but contains a PTT paste and a screenshot — not a master spec.  
**Constraints honored:** no application-code changes, no merge, no delete, no commit/push.

Status labels used exactly as requested:

1. PRODUCTION IMPLEMENTED  
2. IMPLEMENTED BUT UNVERIFIED ON HARDWARE  
3. PARTIALLY IMPLEMENTED  
4. DEMO / MOCK / FAKE  
5. DEAD / LEGACY CODE  
6. NOT IMPLEMENTED  

---

## EXECUTIVE SUMMARY

HOP is a **real 1:1 internet messenger prototype with a serious crypto_box design**, not a painted UI. Register/login, conversation create, opaque ciphertext storage, WebSocket fan-out, SQLite offline queue, and libsodium `crypto_box` encrypt/decrypt are implemented in executable code and covered by API/protocol tests that actually open boxes (not only assert UI labels).

It is **not production-ready**. The product promise is a hybrid messenger (“messages find a way”). Direct BLE is implemented in `HopBleEngine` + `munim-bluetooth`, but **this repository contains zero evidence of a successful two-phone BLE session**. Mesh/relay is a protocol simulator plus an unused TransportManager stub. Push, groups, events, and App Store/TestFlight packaging are missing. Identity keys are client-published and TOFU (in-memory on BLE). Voice/PTT exists only on `feature/ptt-port`, uses the production `MessageService`/`crypto_box` path for send, then writes **decrypted audio to the filesystem cache**. Two feature branches overlap on the same four files and are not integrated.

**Do not ship this to the App Store or call BLE/mesh “working” based on tests or Nearby UI.**

---

## PRODUCTION READINESS SCORE: **38 / 100**

Conservative. Scoring treats the *product* (hybrid E2EE messenger) as the bar, not “does a chat screen exist.”

| Points | Why |
|---|---|
| +22 | Real FastAPI 1:1 chat: auth, opaque `encrypted_payload`, WS first-frame auth, acks, blocks, identity publish+immutability, rate limits. |
| +10 | Real client crypto: `encryptApplicationMessage` / `decryptApplicationMessage` (libsodium `crypto_box_easy`), MessageService refuses send without keys, SQLite stores ciphertext + `local_seal` not plaintext body. |
| +6 | Offline queue (`HopSqliteStore` + `MessageService.flushOne`) is real sql.js-tested persistence, not AsyncStorage. |
| −12 | BLE is a core promise and is **unverified on any physical iPhone/Android pair** (`docs/BLE_TESTING.md`, `docs/PLATFORM_LIMITATIONS.md`). BLE unit tests use `MockBleLink`. |
| −8 | No production mobile pipeline: `eas.json` has only `development` / `developmentClient: true`; `app.json` includes `expo-dev-client`; default `EXPO_PUBLIC_API_URL` is `http://127.0.0.1:8000`. |
| −6 | Identity is not production E2EE: client-published keys, no CA/attestation, BLE TOFU in RAM (`PublicKeyTofu`), SecureStore failure falls back to process memory. Key loss + server 409 = permanently stuck. |
| −6 | Feature branches unmerged; chat/Nearby conversation IDs split on `ptt-port`; PTT not on `dev`. |
| −5 | Mesh/relay advertised in UI copy is **simulator-only**; `createRelayTransport()` is unimplemented. |
| −3 | No push, groups, events; `/push/register` is 501. |
| −3 | No evidence of a live production deploy (Compose/docs exist; this environment has not applied Alembic to Postgres). |
| −3 | Voice at-rest plaintext cache; PTT is an 8s clip, not a live stream; waveform is `Math.random()`. |

A 70+ score would require: two-phone BLE proof, production EAS + HTTPS API, merged transport-UI + PTT, durable identity, no plaintext audio cache, and App Store packaging. None of those are proven here.

---

## FEATURE MATRIX

| Feature | Status | Evidence (file:function) | Risk | Required work |
|---|---|---|---|---|
| Mobile app shell (tabs, login, chat, settings, nearby) | **3 PARTIALLY IMPLEMENTED** | `apps/mobile/app/(tabs)/_layout.tsx`; `login.tsx`; `chat/[id].tsx`; `settings.tsx`; `nearby.tsx`. No `ble-debug` on `dev`/`ptt-port`. | UX incomplete vs product promise; Nearby ping ≠ chat thread on `ptt-port`. | Merge smart-transport-ui; gate debug screens. |
| API | **3 PARTIALLY IMPLEMENTED** | `apps/api/app/main.py`; routers in `app/api/`. Auth/chat real; `/devices`,`/sync`,`/push/register` 501 (`stubs.py`). | Ops/docs endpoints missing; `/ready` requires Redis. | Implement or remove stubs; prove Postgres+Redis deploy. |
| Protocol package | **1 PRODUCTION IMPLEMENTED** (library) | `packages/protocol/src/*` — types, state machine, crypto, transports. | Library ≠ product. Relay/simulator shipped in the same package. | Keep simulator test-only; do not call it mesh. |
| MessageService | **1 PRODUCTION IMPLEMENTED** (text on `dev`; voice on `ptt-port`) | `MessageService.sendText`, `sendVoice`, `flushOne`, `acceptInbound`, `sync` in `packages/protocol/src/messageService.ts`. Chat UI: `ChatScreen.send` → `service.sendText`. | `recipientId \|\| me.id` can self-encrypt if `peerId` missing (`chat/[id].tsx` `send`). Nearby `sendTestPayload` **bypasses** MessageService. | Fail send without recipient; route Nearby through MessageService. |
| TransportManager | **3 PARTIALLY IMPLEMENTED** | `TransportManager.send` / `select` / `LIVE_TRANSPORT_PRIORITY` in `transportManager.ts`. App wiring: `createAppTransportManager` then `BleProvider` re-registers BLE. | Dual registration; `LocalTransport` unused by MessageService (SQLite is the queue). Relay never selected. Internet `/health` wins even if peer is next to you. | Single registration path; document internet-first; do not auto-select relay. |
| HopBleEngine / BleProvider | **2 IMPLEMENTED BUT UNVERIFIED ON HARDWARE** | `HopBleEngine.startSession`, `connect`, `send`, `handleInboxWrite` (`HopBleEngine.ts`); `loadNativeBle` → `munim-bluetooth` (`loadNative.ts`); `BleProvider` registers `BluetoothTransport`. | Untested radios; Expo Go blocked (good); background stops Nearby. Handshake `user_id`/`username`/`pk` are plaintext GATT. | Execute `docs/BLE_TESTING.md` on iPhone+Android; persist TOFU. |
| OfflineProvider / SQLite | **1 PRODUCTION IMPLEMENTED** (protocol-tested; device unproven) | `OfflineProvider` → `ExpoSqliteDriver.open` → `HopSqliteStore`. Schema in `store.ts` `SCHEMA_SQL`. No AsyncStorage message store found. | Protocol tests use `sql.js`, not `expo-sqlite` on a phone. Voice `audio_b64` is in-memory after decrypt, not a SQLite column. | Device test of queue across kill; encrypt-or-avoid audio cache. |
| crypto_box (text) | **1 PRODUCTION IMPLEMENTED** (protocol) | `encryptApplicationMessage` / `decryptApplicationMessage` (`cryptoBox.ts`). API `is_crypto_box_payload` (`payload.py`); `send_message` rejects non-box (`conversations.py`). | Not Signal; no ratchet/FS. Server never opens boxes (good) so API tests use dummy ciphertext `BOXED` (`test_security.py`). | Treat as static-key E2EE; plan FS separately. |
| crypto_box (voice) | **3 PARTIALLY IMPLEMENTED** | Same `encryptApplicationMessage` with `kind: "voice"` + `audio_b64`. `MessageService.sendVoice`. Only on `feature/ptt-port`. | 8s / 48k b64 cap; decrypted files in `cacheVoiceClip`. | Merge; stop plaintext cache; hardware record/play test. |
| Auth | **1 PRODUCTION IMPLEMENTED** | `register`/`login`/`logout` (`auth.py`); `hash_password` argon2id (`security.py`); opaque session tokens `issue_token`; `get_current_user`. | 30-day sessions; PBKDF2 verify still accepted for old hashes. No 2FA. | Rotate/expire; drop PBKDF2 when no legacy users. |
| Nearby | **2 IMPLEMENTED BUT UNVERIFIED ON HARDWARE** | `nearby.tsx` → `startNearby`/`connectPeer`/`sendTestPayload`. Discovery is native scan, not a fake device list. | On `ptt-port`, “Send encrypted message” is a ping into `ble:{sorted ids}`, not the internet conversation. `smart-transport-ui` opens the real chat instead. | Merge smart-transport-ui; hardware proof. |
| Messaging (internet 1:1) | **3 PARTIALLY IMPLEMENTED** | UI → `MessageService.sendText` → `InternetTransport.send` POST `/conversations/{id}/messages` → DB ciphertext → `hub.send_json` → `useHopSocket` → `acceptInbound`. | Proven in API+protocol tests, **not** in a documented two-phone production chat. `e2ee: true` is “looks like crypto_box JSON”, not “we decrypted.” Optimistic `DELIVERED` if peer WS connected (`send_message`). | Two-device internet soak against HTTPS API; cryptographic delivery receipts. |
| PTT / voice | **3 PARTIALLY IMPLEMENTED** (`ptt-port` only) | `PTTButton` → `ChatScreen.sendVoice` → `MessageService.sendVoice` → same `TransportManager`. | Not on `dev`. Hold-to-record clip, not live PTT. Chunk fields `seq`/`total`/`part_of` reserved, unused. Waveform `Math.random()`. | Merge after transport-UI; hardware mic test; real meter. |
| Notifications / push | **6 NOT IMPLEMENTED** | `stubs.register_push` → 501; `test_unimplemented_push_returns_501`. | Background message loss; App Store expectation. | APNs/FCM + encrypted payload policy. |
| Profiles | **3 PARTIALLY IMPLEMENTED** | Settings shows `user.username`; `GET /users/me`. No avatar/bio/edit. | Fine for alpha. | Product decision. |
| Contacts | **3 PARTIALLY IMPLEMENTED** | `contacts.tsx` `startChat` → `api.createConversation` by username. Copy says address book is never uploaded (no Contacts API usage found). | No contact list persistence beyond conversations. | Optional. |
| Groups / events | **6 NOT IMPLEMENTED** | API `_peer` requires exactly 2 members (`conversations.py`). No group/event routes or screens. | Do not advertise. | New protocol+API. |
| Login screen | **1 PRODUCTION IMPLEMENTED** | `login.tsx` → `AuthProvider.login/register` → `/auth/*`. | Client default API is localhost HTTP. | Production URL + ATS. |
| Chats tab | **1 PRODUCTION IMPLEMENTED** | `index.tsx` lists API conversations + SQLite cache. | Preview line is hardcoded “Tap to open”, not last message. | Last-message preview needs decrypt. |
| Settings | **3 PARTIALLY IMPLEMENTED** | Username, logout, relay consent toggle (`settings.tsx`). | Relay toggle implies physical relay; radio path is not TransportManager-selected. | Honest copy; hide until mesh is real. |
| Nearby screen | **2 IMPLEMENTED BUT UNVERIFIED ON HARDWARE** | See Nearby row. | Foreground-only. | Hardware. |
| BLE debug | **5 DEAD / LEGACY CODE** on `dev`/`ptt-port`; **4 DEMO** on `feature/ble-debug-screen` | `origin/feature/ble-debug-screen:apps/mobile/app/ble-debug.tsx`; Settings link “BLE Debug (dev)” is **not** `__DEV__`-gated. | Shipping it in TestFlight exposes GATT internals. | Keep out of production builds. |
| Internet E2EE | **3 PARTIALLY IMPLEMENTED** | See Security. Content confidentiality vs honest server: **yes in code**. Full production E2EE (FS, attested identity, no metadata, proven devices): **no**. | Overclaiming. | Never say “Signal-grade.” |
| BLE E2EE | **2 IMPLEMENTED BUT UNVERIFIED ON HARDWARE** | `HopBleEngine.send` refuses non-`isCryptoBoxPayload`; inbox drops non-box. | Handshake/ACK metadata plaintext; unproven radios. | Hardware + TOFU persistence. |
| Mesh / peer-relay | **4 DEMO / MOCK / FAKE** | `SimulatedNetwork` (`simulatedNetwork.ts`); `createRelayTransport` unimplemented (`stubTransports.ts`). `HopBleEngine.handleInboxWrite` has a consent+`decideRelay` branch, but TM never selects `relay`. | UI copy on Nearby/Settings oversells. | Do not ship mesh claims. |
| Docker / VPS deploy | **3 PARTIALLY IMPLEMENTED** | `infra/docker-compose.prod.yml`, `DEPLOYMENT.md`, Alembic `001_initial`. `init_db()` still `create_all` on API start (`db.py`). | Docs exist; **not applied to live Postgres in this environment**. Dual create_all + Alembic drift risk. | Dry-run prod compose; disable create_all in prod. |
| CI | **1 PRODUCTION IMPLEMENTED** (for unit/typecheck) | `.github/workflows/ci.yml`: protocol `npm test`, API `pytest`, mobile `tsc`. | No E2E, no device farm, no lint of secrets. | Add hardware/E2E later. |

---

## SECURITY FINDINGS

### P0

1. **Identity key loss is unrecoverable and breaks encryption.** `loadOrCreateIdentity` generates a new pair if SecureStore is empty (`identity.ts`). Server `put_identity` returns **409** if a key was already published (`users.py:put_identity`). `OfflineProvider` swallows publish failure. Result: client encrypts with a new secret key; peers still encrypt to the old published `pk`; BLE `verifyServerIdentity` will reject the new handshake pk. There is no recovery UX.

2. **Do not claim production E2EE without attested keys.** Public keys are whatever the client PUTs (`PUT /users/me/identity`). First BLE contact TOFU-binds `user_id→pk` in **RAM only** (`PublicKeyTofu.bind`, `HopBleEngine.tofu`). First-contact spoofing is explicitly possible. This is **not** Signal, not a ratchet, not hardware-backed.

3. **Voice plaintext at rest after decrypt (ptt-port).** `cacheVoiceClip` writes base64 audio to `FileSystem.cacheDirectory/hop-voice/{messageId}.m4a` (`apps/mobile/src/voice/cache.ts`). Expo-AV recordings are also plaintext files until send. SQLite `messages.text` is nulled, but the playable clip is not sealed on disk.

### P1

4. **SecureStore failure falls back to process memory.** `secretStore.ts` `readSecret`/`writeSecret` catch SecureStore errors and keep keys/tokens in a `Map`. Secrets vanish on process death and never hit Keychain in that failure mode. Comment says “Never localStorage” (true) but memory fallback is still weak.

5. **BLE handshake and ACK are plaintext metadata.** `encodeHandshake` JSON `{v:2,user_id,username,pk}` is a GATT read (`bleCodec.ts`, `HopBleEngine.startSession`). ACK notify is UTF-8 `message_id` (`notifyAck`). Content is boxed; **who talked to whom, when, and which message_id** is observable on the air.

6. **Internet delivery status is not a cryptographic ACK.** If `hub.is_connected(peer.id)`, send stores `status="DELIVERED"` (`conversations.py:send_message`) without proof of decrypt. Recipients can POST `/messages/{id}/acks`. The server can lie. BLE ACK is a GATT notify timeout (`ACK_TIMEOUT_MS=8000`), not a timer that *pretends* success — timeout → retry → fail. That is honest, but not e2e-authenticated.

7. **`decodeUnencryptedText` / `alg: none` still exist in the protocol package.** Production internet send refuses non-box. BLE `BluetoothTransport.send` refuses non-box unless `preparePayload` runs. `BleProvider` `preparePayload` tries `decodeUnencryptedText` then re-seals — a leftover plaintext *input* path. `encodeUnencryptedText` is still exported from `index.ts`.

8. **No forward secrecy.** Each message is `crypto_box_easy` to the peer’s long-term key (`cryptoBox.ts`). Compromise of `secretKey` in SecureStore decrypts history (and `local_seal` is a self-box of the same plaintext).

### P2

9. **Metadata on the server is rich.** `messages` rows store `sender_id`, `recipient_id`, `conversation_id`, timestamps, `ttl`, `transport`, `status`, and ciphertext (`tables.py:Message`). That is not “the server sees nothing.”

10. **Rate limits are in-process with Redis optional.** `_redis_allow` returns `None` on any exception and falls back to memory (`rate_limit.py`). Multi-worker (`UVICORN_WORKERS=2`) + Redis down = per-process limits. `TRUST_PROXY_HEADERS=true` in prod compose; if Nginx does not overwrite `X-Forwarded-For`, clients can spoof IP.

11. **Optimistic `/health` routing.** `InternetTransport.isAvailable` is `GET /health`. A reachable API sends **all** chat over the internet even when the recipient is a meter away. Fine for product policy; bad if operators assume BLE privacy from Nearby being open.

12. **CORS `*` is used in API tests** (`conftest.py`). Production template is explicit origins (`infra/.env.example`). Mis-set `CORS_ORIGINS=*` + `allow_credentials` interaction in `main.py` (`allow_all` disables credentials). Easy foot-gun.

13. **Nonce uniqueness is not tracked.** libsodium random nonce per message is standard; there is no store-side replay window beyond `message_id` / `processed_ids`. `ProcessedIdSet` is RAM (BLE engine) and can evict after 50k IDs (`duplicates.ts`). SQLite `processed_ids` has no pruning.

### P3

14. **OpenAPI may be on in non-prod.** `openapi_enabled` defaults on unless `APP_ENV` is production or `DOCS_ENABLED=false` (`config.py`).

15. **`postEnvelope` posts to `/messages`** (`client.ts`) — that route does not exist on the API (acks are `/messages/{id}/acks`). Dead and confusing.

16. **Android still declares location permissions** for BLE (`app.json`). Expected for old APIs; privacy nutrition labels will need an explanation.

17. **No `ITSAppUsesNonExemptEncryption` / privacy manifest** in repo. App Store export compliance will block or mis-declare.

---

## DEMO / MOCK / FAKE INVENTORY

| Item | Where | What it actually is |
|---|---|---|
| Nearby “Send encrypted message” ping | `BleProvider.sendTestPayload` | Real crypto_box over `HopBleEngine.send`, **bypasses MessageService**, conversation id `ble:{sorted user ids}` — not the internet thread (`ptt-port` / `dev`). |
| PTT waveform | `PTTButton` `waveIdRef` | `Math.random()` bars, not microphone amplitude. |
| Voice bubble bars | `VoiceMessageBubble` `BARS` | Hard-coded heights `[8, 14, 22, …]`. |
| Controlled peer-relay | `SimulatedNetwork` + tests | In-process A→B→C→D. Not radios. |
| Relay transport | `createRelayTransport` | Always `implemented: false`. |
| TransportManager tests | `transportManager.test.ts` `mockTransport` | Availability matrix only. |
| BLE transport tests | `MockBleLink` in `bluetoothTransport.test.ts` | `send()` returns `{ok:true}` immediately — **no GATT, no ack wait**. |
| Voice BLE test | `voice.test.ts` “routes voice over BLE…” | Registers a fake transport whose `send` pushes `message_id`. |
| Offline/internet tests | `mockWorld()` HTTP | Fake `/health` + POST store; **crypto_box itself is real libsodium**. |
| API `BOXED` fixture | `test_security.py` | Structurally valid JSON with dummy `pk`/`nonce`/`ciphertext`. Proves server opacity, **not** that a box opens. |
| LocalTransport detail string | `localTransport.ts` | “SQLite persistence is not implemented” — true for *this* class; app queue is `HopSqliteStore`, unused by `MessageService.flushOne`. |
| `defaultTransportManager()` | `transportManager.ts` | Unimplemented BLE+relay; app does not use this helper (`createAppTransportManager` does). |
| PlaceholderScreen | `PlaceholderScreen.tsx` | Unused component. |
| Chats preview | `index.tsx` | “Tap to open” — not a last message. |
| Legacy Replit app | `origin/legacy-main-backup`, `origin/legacy-replit` | Entire previous product: `.replit`, `hop-ble-server`, `react-native-ble-plx` mocks, mockup-sandbox. **Not in current `dev`.** |
| Legacy BLE message char | `artifacts/hop/protocol/ble/constants.ts` on legacy | `HOP_MESSAGE_CHAR` comment: “NOT IMPLEMENTED in this PoC.” |
| BLE debug screen | `feature/ble-debug-screen` | Hardware validation UI; not a fake radio, but a **dev tool**. Ungated from Settings. |

**Not fake:** discovered Nearby peers (they come from `munim-bluetooth` scan callbacks). Empty list = no advertisements, not a mocked roster. **Also not fake:** internet users (API `User` rows). No bot-reply timer found. BLE ack success is GATT notify, not `setTimeout` resolving ok (timeout only fails the attempt).

---

## DEAD / LEGACY CODE INVENTORY

| Item | Location | Notes |
|---|---|---|
| Replit monorepo | `origin/legacy-main-backup`, `origin/legacy-replit` | `.replit`, Express/Drizzle era, `artifacts/hop`, `attached_assets`. Do not merge. |
| `hop-ble-server` Expo module | `origin/legacy-main-backup:artifacts/hop/modules/hop-ble-server/` | GATT server for `HOP_PEER_ID_CHAR` / `HOP_MESSAGE_CHAR`. **Absent from `dev`.** Current stack uses `munim-bluetooth`. |
| `react-native-ble-plx` + advertiser mocks | `origin/legacy-main-backup:artifacts/hop/__mocks__/` | Jest mocks. **Absent from `dev`.** |
| Legacy UUIDs `484F5000-…` | `origin/legacy-main-backup:artifacts/hop/protocol/ble/constants.ts` | Current UUIDs are `8e7a0001-6f70-48a1-9c3d-2b1e0a7c5d11` family (`bleCodec.ts`). **Incompatible with legacy firmware/clients.** |
| `encodeUnencryptedText` / `decodeUnencryptedText` | `packages/protocol/src/payload.ts` | alg `none`. Should not remain in a production client export. |
| `postEnvelope` → `POST /messages` | `apps/mobile/src/api/client.ts` | No such API route. |
| `PlaceholderScreen` | `apps/mobile/components/PlaceholderScreen.tsx` | Zero imports. |
| `Report` table | `apps/api/app/models/tables.py` | No routes. |
| `/devices`, `/sync` | `apps/api/app/api/stubs.py` | 501. |
| `InternetTransport.subscribe` | `internetTransport.ts` | No-op; realtime is `useHopSocket` + `/ws`. |
| TransportManager in-memory `outbound` | `transportManager.ts` `enqueue`/`processQueue` | MessageService uses SQLite `outbound_queue` instead. |
| PBKDF2 verify branch | `security.py:verify_password` | Legacy hash format. |
| `feature/ble-debug-screen` extras | `startScan`/`stopScan` isolated controls vs production Nearby duty cycle | Diverges `BleProvider`/`HopBleEngine` from `dev`. |

**AsyncStorage:** no matches in `*.ts`/`*.tsx`/`*.py`. Message/audio persistence is SQLite + SecureStore + (PTT) FileSystem cache.

---

## ARCHITECTURE VIOLATIONS

Relative to `docs/ARCHITECTURE.md` (“UI → MessageService → TransportManager → Transport; messaging must not import native BLE”).

1. **Nearby ping bypasses MessageService.** `BleProvider.sendTestPayload` → `engine.send`. Violates the documented single send path. `smart-transport-ui` improves this by opening `ChatScreen` after `openOrCreatePeerConversation`, but `sendTestPayload` remains on that branch too.

2. **BluetoothTransport is registered twice.** `createAppTransportManager` registers **unimplemented** BLE (`hopRuntime.ts`), then `BleProvider` replaces it. Brief window where BLE is “not implemented.” Cleanup re-registers the stub.

3. **Two conversation ID namespaces on `dev`/`ptt-port`.** Internet chats use server UUIDs. BLE pings use `ble:{idA:idB}`. Inbound BLE `acceptInbound` will not show in the Contacts-created thread. `smart-transport-ui` adds `localDirectConversationId` + `openOrCreatePeerConversation` to unify — **not merged**.

4. **Relay UI vs relay transport.** Settings/Nearby describe A→B→C forwarding. `LIVE_TRANSPORT_PRIORITY` is only `internet`, `bluetooth`. Physical relay in `handleInboxWrite` is a side path, untested on hardware, not selected by TM.

5. **`init_db()` `create_all` vs Alembic.** Production entrypoint runs `alembic upgrade head`, then Uvicorn lifespan still `create_all`. Drift risk.

6. **Messaging code still knows about unencrypted payloads.** `decodeUnencryptedText` in BleProvider; architecture said internet and BLE are crypto_box only.

7. **PTT is a voice note, not a transport.** `voice.ts` comments describe future chunked PTT. Current send is one boxed JSON clip ≤8s. Naming it PTT oversells.

8. **Working tree vs integration.** HEAD is `feature/ptt-port`, not `dev`. Shipping the wrong branch drops transport-UI or drops voice.

---

## BRANCH INTEGRATION PLAN

**Facts**

- `origin/main` **is** `origin/dev` (`dda207d` “Fix mobile CI by installing protocol package before typecheck.”).
- `origin/feature/smart-transport-ui` (`1d8cebd`): +12 files vs `dev` (conversation unification, transport status in chat, Nearby “Message” opens the same thread).
- `origin/feature/ptt-port` (`03da702`): +19 files vs `dev` (voice protocol, PTT UI, expo-av, cache).
- Overlap (both changed vs `dev`):  
  `apps/mobile/app/chat/[id].tsx`  
  `apps/mobile/src/ble/BleProvider.tsx`  
  `packages/protocol/src/index.ts`  
  `packages/protocol/src/messageService.ts`  
- `git merge-tree` of the two feature tips reports **changed in both** on those four files. Chat screen is a large textual conflict (PTT composer vs transport header). `messageService.ts` is additive (`sendVoice`) vs smaller smart-transport edits — still a merge conflict.
- `origin/feature/ble-debug-screen` (`89aca0c`) also edits `BleProvider.tsx` + `HopBleEngine.ts` + Settings + new `ble-debug.tsx`.
- `origin/legacy-main-backup` / `legacy-replit`: 368-file alternate universe. **Never merge.**

**Integration base:** `origin/dev` (same as `main`).

**Safest order (do not merge in this audit):**

1. **Freeze `origin/dev` as base.**  
2. **Rebase `feature/smart-transport-ui` onto `dev` first** (smaller; fixes the conversation-ID split that PTT-over-BLE needs).  
3. **Rebase `feature/ptt-port` onto the result.** Manually merge `chat/[id].tsx` (keep transport status **and** PTT composer), `messageService.ts` (keep `sendVoice` + any smart-transport list/status tweaks), `BleProvider.tsx` (keep BLE transport registration + voice log line; stop using ping as the primary Nearby CTA), `index.ts` (export both conversationTransport helpers and voice).  
4. **Keep `feature/ble-debug-screen` off production.** If needed for hardware week, cherry-pick behind `__DEV__` / a non-store flavor.  
5. **Do not rebase onto legacy.** Current BLE UUIDs and `munim-bluetooth` are a clean break from `hop-ble-server` / ble-plx.

**Why not PTT first:** PTT on `ptt-port` still sends Nearby test payloads into `ble:…` threads. Voice over “real BLE chat” depends on the unified conversation from smart-transport-ui.

---

## PHYSICAL DEVICE TESTS REQUIRED

None of these are satisfied by CI, simulators, Expo Go, or `MockBleLink`.

| # | Test | Pass criteria |
|---|---|---|
| 1 | iPhone + Android **development builds** (not Expo Go) | `munim-bluetooth` loads; Nearby permission prompts appear. |
| 2 | Mutual discovery | Each device lists the other’s **username**, not a MAC (`docs/BLE_TESTING.md` §3). |
| 3 | GATT handshake v2 | Connect fails without `pk`; succeeds with `sessionEstablished` + matching server identity when online. |
| 4 | Encrypted BLE text | Send from chat (not only Nearby ping); receiver decrypts; duplicate `message_id` does not duplicate inbox; ack within 8s or honest failure. |
| 5 | Internet off | Same as 4 with Wi-Fi/cellular disabled. |
| 6 | Internet on fallback | With API up, chat send uses internet (`InternetTransport`); with API down and peer mapped, BLE. |
| 7 | Background | Leave Nearby / background app → scan/advertise stop (`BleProvider` AppState). |
| 8 | Identity publish | After login, `PUT /users/me/identity` 200; second different key 409. |
| 9 | Two-user internet chat on **HTTPS** API | Ciphertext in DB/WS; UI shows plaintext only after local decrypt. |
| 10 | PTT (after merge) | Hold-to-record ≤8s; peer plays audio; payload on API is crypto_box; no `audio_b64` in HTTP JSON outside ciphertext. |
| 11 | Offline queue | Airplane mode send → SQLite queued → reconnect → same `message_id` delivered once. |
| 12 | Keychain | Kill app; identity still decrypts history; simulate SecureStore failure and confirm we do **not** silently generate a new identity. |

`docs/PLATFORM_LIMITATIONS.md` states this machine has **no Xcode / no attached phones**. This audit did not run radios.

---

## TEST AUDIT

| Class | What | Verdict |
|---|---|---|
| **A — actually tested** (in CI / local unit) | libsodium round-trip, tamper, sender bind, TOFU (`cryptoBox.test.ts`); API plaintext/alg:none reject, identity immutability, argon2id, rate-limit 429, WS first-frame, 1:1 send/list/ack (`test_security.py`, `test_chat.py`, `test_auth.py`); MessageService queue/restart with **sql.js** (`offlineSync.test.ts`); voice box size/leak vs fixture (`voice.test.ts` internet case); TM selection with mocks; relay **policy** + **simulator**. Mobile **typecheck only**. | Real for those layers. |
| **B — mocked** | HTTP in protocol tests; `MockBleLink`; fake BLE `send` in voice/offline tests; API `BOXED` dummy ciphertext; TM `mockTransport`. | **Mocked BLE ≠ BLE works.** Dummy box ≠ opened box (API). |
| **C — needs physical devices** | Scan, advertise, MTU, chunk write, GATT handshake, ACK notify, iOS advertising support, Android 12 permissions, expo-sqlite, SecureStore, microphone, speaker, background kill, munim-bluetooth on both OSes. | **Not done in this repo’s evidence.** |

---

## TOP 10 BLOCKERS TO PRODUCTION

1. **No two-phone BLE proof** — core product promise unverified.  
2. **No production mobile build** — `eas.json` development-only; `expo-dev-client` in `app.json`; localhost API default.  
3. **Unmerged feature branches** with conflicts on the chat send surface.  
4. **Identity model** — client-published keys, RAM TOFU, 409 on rotation, memory fallback.  
5. **Nearby vs chat thread split** on `dev`/`ptt-port` (`sendTestPayload`).  
6. **Mesh/relay marketed, not real.**  
7. **No push** — 501 `/push/register`.  
8. **Voice plaintext cache + PTT not on `dev`.**  
9. **App Store/TestFlight packaging** — no production EAS profile, no privacy manifest, no encryption export flag, BLE debug branch ungated, location+mic+Bluetooth permissions without policy docs.  
10. **No proven production API deploy** — Compose/docs only; `create_all` still in lifespan; Redis required for `/ready`.

---

## RECOMMENDED NEXT DEVELOPMENT MILESTONE

**Milestone: “Two phones, one thread, honest transports.”**

1. Rebase `smart-transport-ui` onto `dev`; do not merge PTT yet.  
2. Delete or hard-gate Nearby `sendTestPayload` as the primary CTA; chat `MessageService.sendText` is the only user send.  
3. Run `docs/BLE_TESTING.md` on one iPhone + one Android; record pass/fail in STATUS (do not mark implemented until both pass).  
4. Only then rebase `ptt-port`; keep transport header + PTT; stop writing plaintext m4a (play from sealed cache or memory).  
5. Add EAS `preview`/`production` profiles, `EXPO_PUBLIC_API_URL=https://…`, drop `expo-dev-client` from store builds, `__DEV__`-only BLE debug.  
6. Do **not** start mesh, groups, or Signal until (3) is green.

---

## EXPLICIT ANSWERS

### 1. Is HOP currently a real messaging application or primarily a prototype?

**A real 1:1 internet-messaging prototype with unfinished hybrid transport.** It is not a demo of fake users and bot replies. It is also not a production messenger: BLE unproven, branches split, no store pipeline, no push, static-key crypto, no live deploy evidence.

### 2. Does real Internet messaging work end-to-end?

**In code and automated tests: yes, as opaque crypto_box 1:1 chat.** Path: `ChatScreen.send` → `MessageService.sendText` → `encryptApplicationMessage` → `TransportManager.send` → `InternetTransport.send` → `POST /conversations/{id}/messages` (`is_crypto_box_payload` required) → ciphertext in `messages.encrypted_payload` → WS `message_event` with `text=None` → `acceptInbound` → `decryptApplicationMessage`.  
**Not proven:** two physical phones against a production HTTPS API. API tests use TestClient; protocol internet tests mock HTTP. Server `e2ee` flag means “JSON looks like a box,” not “plaintext was opened here.”

### 3. Does real BLE messaging appear implemented?

**Yes, as a foreground Nearby PoC in source.** `HopBleEngine` uses real `munim-bluetooth` APIs (scan, advertise, connect, chunked writes, handshake characteristic, ACK notify). Payloads must be `isCryptoBoxPayload`. Expo Go/web are blocked.  
**Caveat:** Nearby ping on `dev`/`ptt-port` bypasses MessageService; unified chat exists only on `smart-transport-ui`. Relay is not a TM route.

### 4. Has real BLE messaging actually been proven on physical phones?

**No.** `docs/BLE_TESTING.md` and `docs/PLATFORM_LIMITATIONS.md` state it has not been verified on hardware in this environment. CI has no device job. BLE tests mock the link.

### 5. Is Push-to-Talk using the production transport/encryption architecture?

**On `feature/ptt-port`, send does: `PTTButton` → `sendVoice` → `MessageService.sendVoice` → same `crypto_box` + `TransportManager` as text.** That is the production architecture.  
**It is not on `origin/dev`.** It is an 8-second AAC clip, not a live stream (`seq=0`,`total=1`). Playback writes plaintext files. Tests mock BLE. Waveform is random.

### 6. Is any text, voice, key material, or sensitive payload exposed as plaintext?

| Channel | Text body / audio | Keys | Other |
|---|---|---|---|
| Internet HTTP/WS body | No, if clients only send crypto_box (enforced on POST) | Public `sender_pk` inside box JSON (expected) | Metadata: ids, times, status |
| BLE air | Ciphertext in envelope JSON; handshake `pk`/`user_id`/`username` **plaintext**; ACK `message_id` **plaintext** | Secret key not sent | Conversation envelope fields unencrypted beside payload |
| SQLite | `text` column forced null for boxes; `local_seal` is self-crypto_box | Not in SQLite | Ciphertext stored |
| SecureStore | — | Identity + session token intended here | Memory fallback if Keychain fails |
| Voice cache (ptt-port) | **Yes — decrypted m4a/base64 on disk** | — | Recording URI from expo-av |
| Server logs | Logging config does not log bodies; do not assume operators never dump DB ciphertext | — | |

`alg: none` is rejected on internet and (without preparePayload success) on BLE.

### 7. Which Replit-era components are still fake/demo?

**On current `dev` / feature branches: none of the Replit app is running.** No `hop-ble-server`, no `ble-plx`, no `.replit`. Survivals are **ideas and leftover protocol helpers**: `encodeUnencryptedText`, unimplemented `/push` `/devices` `/sync`, `PlaceholderScreen`, `SimulatedNetwork` (new-stack simulator, not Replit UI).  
**On `origin/legacy-main-backup` / `legacy-replit`:** the whole tree — `hop-ble-server`, ble-plx mocks, mockup-sandbox, legacy UUIDs, `HOP_MESSAGE_CHAR` unimplemented, Replit README template.

### 8. What would prevent App Store / TestFlight deployment today?

- Only EAS `development` profile (`developmentClient: true`).  
- `expo-dev-client` plugin in `app.json`.  
- Default API `http://127.0.0.1:8000`; no store-ready `EXPO_PUBLIC_API_URL`.  
- No privacy manifest / encryption export compliance keys.  
- BLE debug Settings entry on `ble-debug-screen` not `__DEV__`-gated.  
- Bluetooth + microphone + (Android) location permissions without privacy policy / data-safety text in repo.  
- No push, no account deletion UX beyond `deleted_at` on the server, no support URL.  
- Version `0.1.0`; bundle `app.hop.mobile` with no Apple team / EAS `projectId` in `app.json`.  
- BLE/mesh copy that would be rejected as misleading if mesh is claimed.  
- Unmerged PTT/transport UX.

TestFlight *could* be forced with a new EAS preview profile and a hosted API, but **not with the repo as-is**, and not honestly as a hybrid messenger.

### 9. What is the safest branch integration order?

`origin/dev` (= `origin/main`) → rebase/merge **`feature/smart-transport-ui`** → rebase **`feature/ptt-port`** (resolve the four overlapping files) → keep **`feature/ble-debug-screen`** out of store builds → **never** merge `legacy-main-backup` / `legacy-replit`.

### 10. What should we build/fix next?

Prove **iPhone ↔ Android encrypted BLE in the same conversation as internet chat** (`smart-transport-ui` + `docs/BLE_TESTING.md`). Do not add mesh, groups, or store listing until that pass is recorded. Then integrate PTT without plaintext audio cache, then production EAS + HTTPS API.

---

## ADDITIONAL CHECKS REQUESTED

| Check | Result |
|---|---|
| `HOP_MASTER_SPEC.md` | **Missing.** |
| `eas.json` | Only `build.development` with `developmentClient: true`, `distribution: internal`. |
| `app.json` | Name HOP, `0.1.0`, Bluetooth + mic plist/permissions, plugins: expo-router, **expo-dev-client**, expo-secure-store, expo-av, munim-bluetooth. No EAS projectId. |
| Secrets / `.env` | `.gitignore` ignores `.env` / `infra/.env`. **No committed `.env` found.** `.env.example` and `infra/.env.example` use `CHANGE_ME_*` placeholders. |
| CI | Protocol tests + API pytest + mobile typecheck. No deploy job. |
| `DEPLOYMENT.md` vs actual | Manual Hostinger/Docker guide; **not executed here**. Prod compose exists. |
| ble-debug in production builds | **Not on `dev`/`ptt-port`.** On `feature/ble-debug-screen` it is a normal Settings navigation target. |
| Identity key storage | Intended: `expo-secure-store` via `secretStore.ts`. Fallback: in-memory `Map`. |
| `alg: none` rejection | API 400 (`send_message` + `test_alg_none_payload_is_rejected`). InternetTransport refuses. BluetoothTransport refuses unless preparePayload re-seals. |
| Rate limits | Auth 30/min/IP, messages 60/min/IP (env-overridable). In-process + optional Redis. Tested with monkeypatched limit=3. |
| Identity immutability | Server 409 on key change (`test_identity_public_key_cannot_change`). Client can still generate a new local pair and fail publish silently. |

---

*End of audit. Application code was not modified. This file is the only write.*
