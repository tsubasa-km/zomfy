---
type: Spec
title: The Android app
description: Screens, Expo stack, connection and offline behaviour, and how the APK is built and installed.
status: stable
x-zomfy-implementation: planned
tags: [mobile, app]
sources:
  - id: mobile-app
    resource: /research/mobile-app.md
    title: A phone app for Zomfy
  - id: t3-conn
    resource: https://github.com/pingdotgg/t3code/blob/main/docs/internals/connection-runtime.md
    title: T3 Code connection runtime
  - id: t3-composer
    resource: https://github.com/pingdotgg/t3code/blob/main/docs/user/composer.md
    title: T3 Code composer
  - id: expo-apk
    resource: https://docs.expo.dev/build-reference/apk/
    title: Expo — build APKs for Android
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

The phone needs a fast, thin client for the chats on the person's hosts, which keeps working through
flaky networks and backgrounding — the things T3 Code's app is praised for and Orca's is criticised
for.[^mobile-app]

# Behaviour

## Stack

- `apps/mobile`: Expo (current SDK), React Native, TypeScript, expo-router, TanStack Query with
  persistence, zod, expo-secure-store (keys), expo-camera (QR), expo-notifications, i18n with en and
  ja, `react-native-webview` + xterm.js for terminals (M4), libsodium for E2EE.
- It imports `packages/protocol` and the ACP SDK types as workspace packages, so phone and desktop
  cannot drift. It runs as a **development build**, not Expo Go, because Android push needs one.

## Screens

| Screen | Content |
| --- | --- |
| Pair | Scan QR or paste link; name the phone |
| Hosts | Paired hosts with route in use (Wi-Fi / tailnet / relay) and state; Needs you count |
| Needs you | Every pending approval and question across hosts, newest first, answerable in place |
| Host | Projects → workspaces → chats, with each chat's state dot; Bots section |
| Chat | Transcript from ACP `session/update` (messages, tool calls collapsed, plans), approval and question cards, composer with Send and Stop, queued-message chips |
| Settings | Notifications per event kind, scopes shown, unpair, app version |

## Connection

After T3 Code's runtime: each host has an **ordered route list** (LAN, tailnet, relay); the app uses
the first that answers, keeps probing a preferred one and moves back when it recovers;
jittered backoff capped at 5 minutes; re-probe on foreground and network change. One connection
owner per host.[^t3-conn] On reconnect the app replays the open chat with `session/load` and
merges.

## Offline

Drafts and queued prompts survive restarts and are sent in order on reconnect; a queued prompt
shows as a chip that can be removed before it goes.[^t3-composer] Cached host, workspace and chat
lists and the last transcript of recently opened chats are readable offline.

## Build

- `bun run mobile:apk` runs `eas build -p android --profile preview` with `buildType: apk`
  (EAS's free tier), or `--local` where the toolchain allows; the APK is attached to a GitHub
  release `android-v<version>` and installed by opening it on the phone.[^expo-apk]
- The app's package id is `dev.zomfy.app`; the APK is signed with a keystore kept by EAS (or a
  local one for local builds). An in-app check tells the person when a newer `android-v*` release
  exists.

# Non-goals

- iOS, tablets, the Play Store; Expo Go support; editing files; a host-served UI bundle.

# Acceptance

- `bun test` in `apps/mobile`: the transcript reducer turns recorded `session/update` streams into
  the expected items; the route chooser picks the first live route and returns to the preferred one;
  the queue sends in order once and survives a reload.
- On the Android Emulator: pair from a QR code shown by Zomfy on the same machine, open a chat, send
  a prompt, press Stop, answer an approval and a question.
- On a real phone: switch from Wi-Fi to mobile data during a running turn; the chat keeps updating
  within 10 s through the relay (M2).
- `bun run mobile:apk` produces an installable APK; installing a newer one keeps the pairing.

# Open questions

1. Build the APK in EAS's cloud (needs the Expo account the push already needs) or locally with
   Android Studio's Gradle on Windows? The spec defaults to EAS cloud.

[^mobile-app]: A phone app for Zomfy, §2 and §4
[^t3-conn]: T3 Code's `connection-runtime.md`
[^t3-composer]: T3 Code's `composer.md`
[^expo-apk]: Expo's APK build reference
