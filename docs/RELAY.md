# Controlled peer-relay

Status: **protocol simulator implemented. Physical multi-device mesh is not complete.**

Do not treat this as a finished real-world mesh until A → B → C (and longer paths) succeed on hardware.

## What this is

A consented store-and-forward hop:

```text
A → B → C
```

and the development simulator path:

```text
A → B → C → D
```

B and C forward **ciphertext only**. They do not have the recipient’s secret key, so libsodium `crypto_box_open_easy` fails for them.

## Cryptography

Unchanged primitive: libsodium `crypto_box` (X25519 + XSalsa20-Poly1305). The origin seals to the **final recipient** public key. Relays never re-encrypt and never see plaintext.

The sender must already know the recipient’s public key. The simulator has a key directory. Physical BLE still has no key-distribution / DHT; origin-initiated relay to a never-met peer is not solved.

## Controls

| Control | Behavior |
|---|---|
| Encrypted payload | `alg: crypto_box_xsalsa20poly1305` required; `alg: none` is not relayed |
| TTL / expiration | Relays drop when `now >= expires_at` |
| Hop count | Incremented on each forward |
| Maximum hops | `MAX_HOPS` (8); cannot forward when `hop_count >= 8` |
| Duplicate detection | `message_id` remembered; duplicates are acked, not re-forwarded |
| Relay consent | Off by default. Without consent, a node delivers only if it is the recipient |
| Retry | Hop-by-hop, 3 attempts, 1 ms backoff in the simulator (BLE still 8s × 3) |
| Delivery ack | Hop-by-hop ack of `message_id`; destination also sends an encrypted `delivery_ack` back to the origin |
| Loop prevention | Unencrypted `path` of visited user IDs; a node will not forward to a user already on the path, and drops if it sees itself while not the recipient |

`path` is routing metadata, not a MAC. Hop limit + duplicates still bound a tampered path.

## Simulator

`SimulatedNetwork` in `@hop/protocol` is the development network (A, B, C, D plus arbitrary graphs). It is **not** CoreBluetooth / Android GATT.

Tests cover: A→B→C, A→B→C→D, relay cannot decrypt, consent off, duplicates, expiration, device disappearance, broken links, triangle loop bound.

## Physical BLE

If Settings → **Relay is on**, `HopBleEngine` may forward an inbound crypto_box envelope whose `recipient_id` is another nearby handshaked peer. Default remains off.

This path has **not** been run on three or four phones.

## Not done

- Real-world mesh networking
- Key distribution for recipients you have never met (client-published keys, not attested)
- Automatic flood routing / partition healing on hardware
