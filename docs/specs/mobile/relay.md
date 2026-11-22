---
type: Spec
title: Phone relay
description: The phone routes on the shared Zomfy Relay Worker, which splices end-to-end encrypted frames between a phone and its host's daemon link.
status: stable
x-zomfy-implementation: planned
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
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Away from the LAN or tailnet, the phone cannot reach a daemon that listens on 127.0.0.1 behind NAT.
The relay must connect them without seeing what they say, in the person's own Cloudflare account,
in the same Worker as the bots connector ([decision](../../decisions/one-relay-worker.md)).

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
