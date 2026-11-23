---
type: Spec
title: Phone relay
description: The phone routes on the shared Zomfy Relay Worker, which splices end-to-end encrypted frames between a phone and its host's daemon link.
status: stable
x-zomfy-implementation: done
tags: [mobile, relay, cloudflare, security]
sources:
  - id: mobile-app
    resource: /research/mobile-app.md
    title: A phone app for Zomfy
  - id: orca-e2ee
    resource: https://github.com/stablyai/orca/blob/main/src/shared/remote-runtime/e2ee/paired-e2ee-v2-key-schedule.ts
    title: Orca paired E2EE v2 key schedule
  - id: orca-relay
    resource: https://github.com/stablyai/orca/tree/main/cloud/packages/relay-contract
    title: Orca relay contract
  - id: orca-framing
    resource: https://github.com/stablyai/orca/blob/main/src/shared/remote-runtime/e2ee/mobile-e2ee-v2-framing.ts
    title: Orca mobile E2EE v2 framing
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Away from the LAN or tailnet, the phone cannot reach a daemon that listens on 127.0.0.1 behind NAT.
The relay must connect them without seeing what they say, in the person's own Cloudflare account,
in the same Worker as the bots connector ([decision](../../decisions/one-relay-worker.md)). The
Worker can also run on the person's own machine behind a tunnel
([self-hosting](../bots/self-host.md)); phones then use the tunnel's public URL.

# Behaviour

## Routes on the Worker

| Route | Role |
| --- | --- |
| `GET /v1/device/<hostId>/ws` (upgrade) | A phone's socket for one host. First frame proves the device key (signature over `"zomfy-relay-v1" \| deviceId \| nonce`); unknown or revoked device → close 4401. |
| `/v1/host` `phone` channel | The daemon side: `device-add {deviceId, publicKey}`, `device-remove`, and spliced frames. |
| `POST /v1/push` (on the host link) | See [push](push.md). |

## Splicing

- The Hub tags each phone socket with `{deviceId, hostId}` in its hibernation attachment and keeps
  nothing else in memory. A frame from the phone goes to the host link as
  `{ch: 'phone', type: 'frame', deviceId, data}`; a frame from the daemon with a `deviceId` goes to
  that phone's socket.
- The host offline → the phone gets `{type: 'host-offline'}` and stays connected; `host-online`
  when it returns. The Hub never queues phone frames (the app queues prompts itself, see
  [app](app.md#offline)).
- Frames are opaque base64 ciphertext to the Hub; a frame over 1 MiB is refused.

## End-to-end encryption

- On each phone connect the phone and daemon run a handshake: X25519 ephemeral keys, signed by each
  side's long-term key (pinned at [pairing](pairing.md)), then HKDF-SHA256 over the transcript into
  two directional keys, as in Orca's v2 key schedule; frames are XChaCha20-Poly1305 (libsodium) with
  a counter nonce; a replayed or reordered frame closes the channel.[^orca-e2ee]
- Inside the channel the phone speaks ACP JSON-RPC exactly as over the direct route, so the daemon
  hands the decrypted stream to the same connection path as `websocket-server.ts`, with the device's
  scopes.

# Implementation status

Built in phase M2. Where the code differs from the behaviour above, this is what was built and why.

## The Worker (`apps/relay/src/phone.ts`, small hooks in `hub.ts` and `index.ts`)

- The phone's socket: the Hub sends `{type:'challenge', nonce}`; the phone answers
  `{type:'auth', deviceId, signature}` (signature over `zomfy-relay-v1|<deviceId>|<nonce>`) and gets
  `auth-ok`, then `host-online` or `host-offline`. Then `{type:'frame', data}` both ways. A device id
  is `d_<the daemon's id>`.
- Device keys come only from the host: `device-add`, `device-remove`, and **`device-sync`** (added):
  the whole list after each `auth-ok` and on every change, so a revoke made while the link was down
  still reaches the Hub. The Hub closes a removed device's socket with **4403**.
- **Pairing through the relay** (added, so a phone can pair when the listener is off): the phone sends
  `{type:'pair', deviceId, publicKey, signature}` with a fresh id; the Hub checks the key proof and
  lets it reach the host, marked `pairing`. The grant travels inside the end-to-end channel only.
  At most 4 pairing sockets per host; an id that is already a device is refused.
- The host side hears `device-open {deviceId, pairing?}` when a phone authenticates or the link comes
  back (a new channel starts), and `device-closed`. The daemon may ask `close {deviceId, code}`.
- Close codes: 4401 unknown device, bad key, another host's device or a frame before auth; 4403
  revoked; 4409 a newer socket of the same device; 4400 the daemon's "channel broke". Frames over
  1 MiB get `{type:'error', code:'too_large'}` and the socket stays. 50 devices per host.
- `host-offline` / `host-online` go to every phone of the host; frames sent meanwhile are dropped.
- Worker tests: `apps/relay/test/phone.test.ts`, including the storage and log check for a marker.

## End-to-end encryption (`packages/protocol/src/phone-e2ee.ts`, shared by daemon and app)

- Orca's v2 handshake, transcript and key schedule, with Zomfy's labels: the phone's
  `e2ee_hello {clientPublicKey, clientNonce, context}`, the host's
  `e2ee_ready {hostPublicKey, hostEphemeralKey, clientNonce, hostNonce, context}`; the context binds
  the transport and the relay host id.
- Both sides use ephemeral X25519 keys. The host's long-term key is X25519 (the one pinned in the
  offer), so it cannot sign: it proves itself by key agreement instead. The input key material is
  X25519(phone ephemeral, host ephemeral) followed by X25519(phone ephemeral, host pinned key), and
  the phone refuses a ready whose `hostPublicKey` is not the pinned one. The phone signs the
  transcript hash with its Ed25519 device key (Orca's device proof, `zomfy-device-proof/v1`) in its
  first sealed message, `{type:'auth', deviceId, proof}` or `{type:'pair', request, proof}`; the host
  answers `ready {scopes}`, `paired {response}` or `refused`.
- Frames are XChaCha20-Poly1305 from **@noble/ciphers** rather than libsodium: the same AEAD as
  libsodium's `crypto_aead_xchacha20poly1305_ietf`, in pure JavaScript that runs on Hermes, which
  has no WebAssembly for libsodium. Orca's nonce layout (session id, direction, counter), with the
  header as associated data.[^orca-framing] A frame must carry exactly the next counter.
- A daemon reply too large for one 1 MiB frame is not sent; a request gets JSON-RPC error `-32002`
  instead, so the phone does not wait on it.

## The daemon (`packages/daemon/src/phone-relay.ts`, `relay-channels.ts`)

- The phone relay rides the link the bots connector keeps (`ConnectorClient` reports it to
  `relay-channels.ts`); there is no second socket.
- After the device proof it hands the decrypted stream to `remote-gateway.ts` (`attachRelay`), the
  same path and scope checks as a direct socket. A bad, replayed or reordered frame closes the
  channel with 4400; a revoke closes it with 4403 at once.
- Tests: `phone-relay.test.ts` against an in-process fake relay, and `phone-relay.wrangler.test.ts`
  against `wrangler dev` (skipped unless `ZOMFY_RELAY_DEV_URL` and `ZOMFY_RELAY_DEV_SETUP_CODE` are
  set; never against a deployment).

Not yet tried from a real phone on mobile data against the person's deployment; that is the
overview's M2 test path.

# Non-goals

- Message queueing or history in the relay; the daemon is the source of truth.
- A relay that sees plaintext, even for push (push bodies are separate and short, see
  [push](push.md)).
- Reaching SSH hosts directly: a phone reaches an SSH host's chats through the host whose daemon
  is linked to the relay, or through that host's own link.

# Acceptance

Worker tests with `@cloudflare/vitest-pool-workers`, and `bun test` in `packages/daemon` against
`wrangler dev`:

- A phone with a known device key connects and its frames reach the fake daemon unchanged; frames
  from the daemon reach only the named device.
- An unknown device is closed with 4401; a device of another host is refused.
- With the daemon disconnected the phone receives `host-offline`, then `host-online` after reconnect,
  without reconnecting itself.
- The Hub's stored state and logs never contain decrypted payloads (a test greps them for a marker
  sent inside the channel).
- A replayed ciphertext frame closes the channel on the daemon side.
- An ACP `session/prompt` sent through the relay runs a turn like one from a window.

# Open questions

None for the person.

[^orca-e2ee]: Orca's `paired-e2ee-v2-key-schedule.ts` and relay contract
[^orca-framing]: Orca's `mobile-e2ee-v2-framing.ts`
