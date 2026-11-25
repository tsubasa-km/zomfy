---
type: Spec
title: Bots in the phone app
description: A Bots screen in the Android app that lists the host's bots, starts a chat with one from a first message, and marks bot chats in the lists.
status: stable
x-zomfy-implementation: done
tags: [mobile, app, bots]
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Problem

From the phone the person can read and continue a chat a bot already has (bot chats are ordinary
chats with `origin: 'bot'`), but cannot start one: the phone may list bots but not call
`_harness/bots/chatCreate`. Talking to a bot from the phone should not need Discord or Slack.

# Behaviour

## Scope

- `_harness/bots/chatCreate {id, text?, fromSessionId?} → {sessionId}` is allowed for phones under
  **`chats:operate`**, the scope that already covers `_harness/sessions/create` and
  `session/prompt`: starting a bot chat is creating a chat and sending its first prompt, so it needs
  no new power and no new scope. Phones paired before keep working without pairing again; a phone
  without `chats:operate` is refused (`SCOPE_REFUSED_CODE`), on the direct route and through the
  relay alike, since both pass the gateway's one allowlist.
- Listing bots stays `bots:read` (`_harness/bots/list`, `_harness/bots/changed`).

## Bots screen

- The Host screen gets a **Bots** row while the connection has `bots:read` and the host has at
  least one bot; it opens the Bots screen for that host.
- One card per bot: avatar (an `http(s):` or `data:image/` URL as a picture, otherwise its first
  one or two characters, or the name's initial), name, `@handle`, and **Paused** when paused.
- **Talk** (hidden while paused, or without `chats:operate`) opens a composer under the bot. Send
  calls `chatCreate` with the text; the daemon runs it as the chat's first turn, and the app opens
  the new chat on the existing Chat screen, with its approval and question cards. A failure keeps
  the text and shows the error. Not connected: Send is off (a bot chat cannot be queued, since the
  chat does not exist yet).
- Under each bot, its recent chats (up to five, newest first, archived ones left out), each opening
  the chat.

## Bot chats in the lists

- In the Host screen's tree a chat with `origin: 'bot'` shows the bot's small avatar and `@handle`
  before its title. The chat screen's title is unchanged.

## Text

Every string is in the app's i18n table (`src/lib/i18n.ts`), English as the key and Japanese.

# Non-goals

- Creating, editing, pausing or deleting bots from the phone; `@handle …` in a phone chat's
  composer; attachments in the first message.
- Queuing a first message for a bot while the host is offline.

# Acceptance

- The protocol table allows `_harness/bots/chatCreate` under `chats:operate`.
- A daemon gateway test: a phone with `chats:operate` creates a bot chat; one with only
  `chats:read` and `bots:read` is refused.
- `bun test` in `apps/mobile`: the pure module that pairs bots with their chats (recent chats,
  avatar text, the label of a bot chat) and the connection's bot list (loaded with `bots:read`,
  followed on `_harness/bots/changed`, absent without the scope).
- In `bun run web` against a preview daemon: the Bots screen lists a bot, Talk opens a chat.

# Implementation status

Built as above. `src/lib/bots.ts` holds the pure parts (avatar, recent chats, order, `canTalk`,
`startBotChat`); the connection loads `_harness/bots/list` at each connect when the device has
`bots:read` and follows `_harness/bots/changed`, so `HostConnectionState.bots` is null without the
scope or on a host that cannot list bots (the connect still succeeds). The screen is
`app/bots/[hostId].tsx`; the Host screen shows the Bots row and marks bot chats. Checked in
`bun run web` against a preview daemon: paired, the Bots screen showed a paused and an active bot,
Talk started a chat that answered, and the chat appeared under the bot and, marked, in the host tree.
