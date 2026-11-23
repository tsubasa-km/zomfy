---
type: Spec
title: Pairing hosts and phones
description: How a daemon registers its host key with the person's relay at first run, and how a phone pairs with a host by QR code into a revocable, scoped device record.
status: stable
x-zomfy-implementation: done
tags: [mobile, relay, security]
sources:
  - id: mobile-app
    resource: /research/mobile-app.md
    title: A phone app for Zomfy
  - id: orca-bots
    resource: /research/orca-bots.md
    title: Orca Bots, and a self-hosted equivalent for Zomfy
  - id: orca-offer
    resource: https://github.com/stablyai/orca/blob/main/src/shared/remote-runtime/pairing/mobile-relay-pairing-offer.ts
    title: Orca mobile pairing offer
  - id: t3-auth
    resource: https://github.com/pingdotgg/t3code/blob/main/docs/internals/environment-auth.md
    title: T3 Code environment auth
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T12:00:00Z" }
---

# Problem

There is no account system: the relay must know which daemons and phones are the person's, and a
phone must prove it was paired, without Zomfy running a login service. Pairing that silently
expires or drops is what reviews of both researched apps punish most.[^mobile-app]

# Behaviour

## Host registration (daemon ↔ relay, at first run)

1. Deploy creates a random 128-bit **setup code** as the Worker secret `SETUP_CODE`
   ([connector](../bots/connector.md#deploy)).
2. In Settings → Bots → Relay (or Devices) the person pastes the Worker URL and setup code. The
   daemon generates an **Ed25519 host key** (private part in `~/.zomfy/relay/host-key`, mode 0600)
   and calls `POST /v1/hosts/register {setupCode, publicKey, name}`. The Hub stores the key, returns
   a `hostId`, and marks the setup code used.
3. Each connect to `/v1/host?hostId=<id>` answers the Hub's `challenge` nonce with a signature over
   `"zomfy-relay-v1" | hostId | nonce`; a bad or revoked key, or an unknown host, closes the socket
   with code 4401. The Hub keeps only a hash of each used setup code, never the code.
4. Another host joins with a one-time **host invite** (10 minutes) that a registered host mints from
   its settings (`POST /v1/hosts/invite`, signed). Revoking a host deletes its key row.
5. A lost setup code is reset with `wrangler secret put SETUP_CODE`, which also allows a new
   registration.

## Phone pairing (phone ↔ host)

1. Settings → Devices → **Pair a phone** shows a QR code and a link
   `zomfy://pair#<offer>`; the offer, as Orca's, holds: host id and name, the direct routes (LAN,
   tailnet) if the listener is on, the relay URL if paired, the host's pinned X25519 public key, a
   one-time **pairing grant** (random 256-bit, expires in 10 minutes), and the scopes
   offered.[^orca-offer]
2. The phone generates its own Ed25519 and X25519 keys (expo-secure-store) and presents the grant
   with its public keys over the first route that answers. The daemon checks and burns the grant,
   and stores a **device record** in `~/.zomfy/devices.json`: id, name, model, public keys, scopes,
   createdAt, lastSeenAt.
3. When the relay is used, the daemon also registers the device's public key with the Hub
   (`device-add` on the link), so the Hub accepts that phone's socket for this host only.
4. A device stays paired until revoked; there is **no silent expiry**. Revoke (Settings → Devices)
   deletes the record locally and at the Hub and closes its open connections.

## Scopes

`chats:read`, `chats:operate` (prompt, Stop, approvals, questions), `terminals:operate`,
`workspaces:operate`, `bots:read`. Every ACP and `_harness/*` method has one required scope in
`remote-devices.ts`; a method not in the table is refused for phones. All scopes are on by default
for the person's own phone; a pairing can drop any.

# Built so far

Host registration (the first list, except the settings UI) is built in `apps/relay` and the
daemon's `relay-pairing.ts`, in phase B0 of [bots](../bots/overview.md#phases). Phone pairing,
device records and scopes are not built yet.

## Implementation status

Phone pairing on the direct route is built (M1); the relay part is built in M2 (see below).

- `packages/daemon/src/device-store.ts` keeps `~/.zomfy/devices.json`, which also holds the host's
  stable `hostId` and the listener setting; the host's X25519 key is in
  `~/.zomfy/remote/box-key.json` (mode 0600). Grants live in memory, so a restart burns them.
- `remote-gateway.ts` is the opt-in listener, port **7802** by default. Like T3 Code's server it
  listens on every interface and answers only loopback, RFC 1918, link-local, `100.64/10` and IPv6
  ULA/link-local peers; the offer lists the LAN addresses, then the tailnet ones.
  `ZOMFY_REMOTE_BIND=127.0.0.1` keeps it on loopback (previews, the Android Emulator via
  `10.0.2.2`).
- The wire: `GET /v1/hello`, `POST /v1/pair`, and the WebSocket `/v1/device`, which sends a
  challenge; the phone signs `zomfy-device-v1|hostId|deviceId|nonce` with its Ed25519 key. A bad
  signature closes with 4401, a revoke with 4403. After `ready` the socket is an ACP connection to
  the agent the windows use.
- The scope tables cover methods the phone calls, notifications it hears and requests it is sent
  (`session/request_permission` needs `chats:operate`); anything unlisted is refused or dropped.
- Settings → Devices (`DevicesPane.tsx`): the listener switch, a QR code and link, the paired
  phones with their scopes and connection, and Revoke. Pairing offers every scope; choosing fewer
  is in the protocol but not yet in the UI.
- On the direct route the traffic is not encrypted beyond what the tailnet gives; the relay route is
  end-to-end encrypted ([relay](relay.md#implementation-status)).

M2, the relay:

- The offer lists the relay last, `{kind:'relay', url, relayHostId}`, with `relayUrl`, while this host
  is paired with a relay (Settings → Bots → Relay); LAN and tailnet come first.
- The daemon registers device keys at the Hub with `device-sync` (the whole list) rather than one
  `device-add` per pairing, so revokes made while the link was down are not lost.
- A phone may pair **through the relay**: when no direct route answers it presents the grant inside
  the end-to-end channel, under an id it chose (`d_<id>`), which becomes its device id. So a phone
  can pair with the listener off, as long as the host is linked to the relay.
- Settings → Devices shows each phone's route (Wi-Fi / LAN, tailnet or Zomfy Relay), whether phones
  can reach this computer through the relay, and allows pairing when only the relay is on.
- On the relay a 4401 from the Hub is treated by the app as a failed route, not as unpaired: only
  the host (on any route) or a 4403 revoke unpairs a phone, so pairing the host with another relay
  never silently drops a phone.

# Non-goals

- Accounts, OAuth, Clerk, Orca's `login.onorca.dev`.
- DPoP-bound tokens (T3) on the direct route: the device key signs a challenge instead.[^t3-auth]
- Pairing a phone with a host the phone cannot reach on any route.

# Acceptance

`bun test` in `packages/daemon` and the Worker tests:

- Registration with the right setup code returns a host id; a second registration with the same
  code is refused; a reset code allows one more.
- A socket whose signature does not verify is closed with 4401; a revoked host is refused.
- A pairing grant works once, and not after 10 minutes.
- A device without `terminals:operate` calling a terminal method gets an error; an unlisted method
  is refused.
- Revoking a device closes its open connection within 1 s and its next connect fails on the direct
  route and on the relay.
- A device paired 60 days ago still connects.

# Open questions

None for the person.

[^mobile-app]: A phone app for Zomfy, §2 and §4
[^orca-offer]: Orca's `mobile-relay-pairing-offer.ts`
[^t3-auth]: T3 Code's `environment-auth.md`
