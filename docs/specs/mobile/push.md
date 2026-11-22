---
type: Spec
title: Push notifications on the phone
description: When the daemon notifies a paired phone, and how Zomfy Relay sends it through Expo's free push service.
status: stable
x-zomfy-implementation: planned
tags: [mobile, relay, notifications]
sources:
  - id: mobile-app
    resource: /research/mobile-app.md
    title: A phone app for Zomfy
  - id: expo-push
    resource: https://docs.expo.dev/push-notifications/sending-notifications/
    title: Expo — sending notifications with Expo's push service
  - id: person
    resource: "decisions given by the person on 2026-11-22"
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Agents stop to ask while the phone is in a pocket and the app is closed. A notification must reach
the phone without a socket open, through a service the person can use for free, and without the
relay or Expo learning much.

# Behaviour

## When (daemon)

`push-rules.ts` decides, per device setting: an **approval** or **question** waits (always on), a
turn **finished** or **failed**, a **usage limit** paused a chat, a **bot** asks something. One
notification per chat per event; a newer one for the same chat replaces the older (same `tag`). No
push while the device has the chat open (the app reports what is on screen).

## Body

Short and generic: title is the chat or bot name, body is one of a fixed set ("Needs approval",
"Has a question", "Finished", "Failed", "Paused until 14:00"), plus `data {hostId, sessionId,
kind}`. No prompt text, tool arguments or file names leave the daemon in a push.

## Sending (relay)

- The app registers its Expo push token (`ExponentPushToken[…]`) with the daemon over its
  encrypted channel; the daemon keeps it in the device record.
- The daemon sends `{ch: 'phone', type: 'push', deviceId, token, title, body, data, tag}` on the
  host link; the Hub posts it to Expo's push API (`https://exp.host/--/api/v2/push/send`), with the
  optional `EXPO_ACCESS_TOKEN` secret as Bearer when set, and checks receipts later; a
  `DeviceNotRegistered` receipt tells the daemon to drop the token.[^expo-push]
- Android delivery goes through FCM, which needs the person's Firebase project's FCM v1 credentials
  uploaded to their Expo project once ([app](app.md#build)).[^expo-push]
- Rate: at most 1 push per chat per 10 s and 60 per hour per device; extra pushes are dropped and
  counted in the daemon log.

## On the phone

Android notification channels `approvals` (high importance) and `activity` (default). Tapping opens
the chat; an approval notification has no inline buttons in M3 (the decision is made in the app).

# Non-goals

- FCM or APNs directly; iOS.[^person]
- Live Updates or widgets.
- Notification text that shows what the agent is doing.

# Acceptance

- `bun test` in `packages/daemon`: each rule fires once per event; two events in 10 s give one push;
  no push for the chat open on the device; the body never contains the prompt (test with a marker).
- Worker test with Expo's API mocked: the request carries the token, title, body and data; the
  access token is sent only when set; `DeviceNotRegistered` reaches the daemon.
- On the Android Emulator (Google Play image) with the APK and the person's Expo project: an
  approval ask with the app closed shows a notification within 10 s; tapping it opens that chat.

# Open questions

1. Expo needs an Expo account and a Firebase project for Android push (both free). Is creating
   those two accounts acceptable, given "no account system" was about Zomfy's own relay?

[^expo-push]: Expo push service documentation
[^person]: The person's decisions of 2026-11-22
