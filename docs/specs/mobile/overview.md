---
type: Spec
title: Zomfy for Android
description: An Android app, sideloaded as an APK, that watches and steers the agents on the person's Zomfy hosts from anywhere, built on T3 Code's client design and Orca's relay design.
status: stable
x-zomfy-implementation: planned
tags: [mobile]
sources:
  - id: mobile-app
    resource: /research/mobile-app.md
    title: A phone app for Zomfy
  - id: person
    resource: "decisions given by the person on 2026-11-22"
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Agents run for a long time and stop to ask. Away from the desk, the person cannot see what they are
doing, answer an approval, or send the next prompt, so work waits. The research found T3 Code's
phone app the best regarded and Orca's relay design the best fit for a self-hosted
relay.[^mobile-app]

# Decisions taken

- **Android only**, installed as an **APK** (no Play Store, no iOS).[^person]
- **Expo** (React Native, TypeScript), after T3 Code's client design: ordered routes, one-time
  pairing links, an offline queue.[^mobile-app]
- The phone is an **ACP client** using `packages/protocol`, like a window; a scope allowlist limits
  what it may call.
- It reaches the daemon directly on the LAN or tailnet, or through **Zomfy Relay**, the same
  self-hosted Worker as the bots connector ([decision](../../decisions/one-relay-worker.md)),
  end-to-end encrypted.
- **Expo's free push service** carries notifications; relay auth is the **host key** registered at
  first run, with no account system.[^person]

# User stories

1. I scan a QR code in Zomfy's settings and the phone lists my hosts, projects and chats.
2. On mobile data, I open a running chat, see its transcript live, approve a tool call, answer a
   question and send a follow-up.
3. My phone buzzes when an agent asks, needs approval, finishes or fails; tapping opens that chat.
4. In a tunnel, I write a prompt; it is sent when the phone is back online.
5. I revoke a lost phone from Zomfy and it can no longer connect.
6. I talk to a [bot](../bots/overview.md) from the phone like any chat.

# Scope

| Spec | Covers |
| --- | --- |
| [Pairing](pairing.md) | Device records, QR pairing links, scopes, revoke, host-key registration |
| [Relay](relay.md) | Phone routes on the shared Worker, splicing, end-to-end encryption |
| [App](app.md) | Screens, Expo stack, offline queue, APK build |
| [Push](push.md) | When to notify, Expo push through the Worker |

# Non-goals

- iOS, iPad, the Play Store, TestFlight.
- A UI bundle served by the host (Orca #44682): the app ships its own UI.
- A hosted relay or push service run by the Zomfy project.
- Editing files, the browser screencast, emulator mirroring.

# Phases

| Phase | Delivers | First test path |
| --- | --- | --- |
| M0 Groundwork | `packages/protocol/src/remote-devices.ts` (device, scopes, pairing offer, method allowlist); "ask every client, first answer wins" in `harness-agent.ts` (shared with bots) | `bun test` in `packages/daemon` |
| M1 Direct | Daemon device store, pairing, opt-in LAN/tailnet listener; Settings → Devices; app shell with hosts, chats, transcript, prompt, Stop, approvals, questions; APK | Android Emulator, then a real phone on the same Wi-Fi or tailnet |
| M2 Relay | Phone routes on Zomfy Relay, E2EE, ordered routes with fall-back, offline queue | Phone on mobile data against the person's deployment |
| M3 Push | Push rules, Expo push sender in the Worker, token registration, tap to open | Android Emulator with a Google Play image, then the phone |
| M4 Depth | Terminals (xterm.js in a WebView), new chat and worktree, diffs, attachments, voice | Phone |

M1 needs no Cloudflare and can run in parallel with bots B1; M2 needs the host link from bots B0.

# Acceptance

- Pair the phone from a QR code; it lists the host's projects and chats within 3 s on Wi-Fi.
- From the phone on mobile data (M2), approve a pending tool call in a chat a window started; the
  window's card closes, and the turn continues.
- A push arrives within 10 s of an approval ask while the app is closed (M3).
- A revoked phone is refused at its next connect on every route.

# Open questions

None open: the person's decisions above settled the research's questions.

[^mobile-app]: A phone app for Zomfy, TL;DR and §4
[^person]: The person's decisions of 2026-11-22
