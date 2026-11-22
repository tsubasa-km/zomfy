---
type: Spec
title: Bots in the desktop app
description: The Bots settings pane, the bots section of the sidebar, Needs you, and talking to a bot from Zomfy itself.
status: stable
x-zomfy-implementation: in-progress
tags: [bots, desktop]
sources:
  - id: orca-bots
    resource: /research/orca-bots.md
    title: Orca Bots, and a self-hosted equivalent for Zomfy
  - id: orca-docs
    resource: https://orca.dev/docs/bots
    title: Orca Bots quickstart
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

The person sets up bots, the relay and each source in Zomfy, talks to bots there, and answers what
bots ask. The first test path is Zomfy itself, so talking to a bot must work with no relay at all.

# Behaviour

## Talking to a bot from Zomfy

- The left sidebar's navigation (`SidebarNav`) gets a **Bots** entry, like Orca. It opens the bot
  list: one row per bot (avatar, name, a dot for running / waiting on you / paused). Clicking a bot
  opens its newest chat; **New chat** opens
  another, in the bot's home. Like Orca, a new chat per job is normal, because the bot remembers in
  `MEMORY.md`.[^orca-docs]
- A bot chat is an ordinary chat (composer, transcript, approvals, Stop) with a header showing the
  bot and, for chats started elsewhere, where it came from ("from Discord · #eng · asked by
  Alex") with a link that opens the thread in the browser.
- Typing `@<handle>` at the start of a prompt in any chat sends that prompt to the bot as a new bot
  chat, with a link back to the chat it came from.
- Bot chats and the workers they start have `origin: 'bot'`; the normal project lists leave them
  out unless "Show bot chats" is on.

## What the app calls

The daemon side is built ([daemon](daemon.md#methods)); the app needs only these:

- The list: `_harness/bots/list`, then `botsChanged {bots}` after every change.
- **Create bot**: `_harness/bots/create {input}`; `input.homeWorkspaceId` or `input.homePath` picks
  an existing folder, neither makes `~/zomfy/bots/<handle>`. Then `update {id, patch}`, `pause {id,
  paused}`, `askers {id, source, askers}`, `delete {id, deleteHome?}`. Errors are readable messages
  (a bad or used handle, a guarded agent).
- **Open SOUL.md / MEMORY.md / home folder**: files in the workspace `bot.homeWorkspaceId`.
- **New chat** and `@handle …`: `_harness/bots/chatCreate {id, text?, fromSessionId?}` →
  `{sessionId}`; without `text` the window sends the first prompt with `session/prompt` as in any
  chat. Bot chats are sessions with `origin: 'bot'`, `botId` and `botFrom`; a bot's newest chat is
  its session with the latest `lastActivityAt`.
- **Relay**: `connectorStatus`, `connectorPair {relayUrl, setupCode | invite, hostName?}`,
  `connectorUnpair`, and `connectorStatusChanged` for the live state.
- **Access requests**: `accessRequests`, `answerAccessRequest {id, allow}`, and
  `accessRequestsChanged {requests}`.

## Needs you

- Questions, approvals and access requests from bot chats appear in the existing inbox with the
  bot's avatar, as Orca's "Needs you"; answering one there clears the buttons in the source.
- An `unsupported` prompt is always in the inbox.

## Settings → Bots

1. **Relay**: Worker URL and setup code fields, **Pair**, status (connected, last hello, host id),
   **Unpair**, and **Deploy to Cloudflare** / "or run `bun run deploy`" links to the guide. The
   same relay serves the phone ([pairing](../mobile/pairing.md)).
2. **Sources**: a card per source (Discord, Slack, GitHub, Linear, Webhooks) showing whether the
   deployment has it configured (from `hello-ok` features), the URLs to paste into the source
   (interactions endpoint, events URL, webhook URL) with copy buttons, and a link to the source's
   setup steps.
3. **Bots**: list, **Create bot** (name, handle, avatar, purpose, agent, model, permission mode,
   home: a new folder `~/zomfy/bots/<handle>` by default, or an existing repository), and per bot:
   - **Open SOUL.md**, **Open MEMORY.md** (opened in Zomfy's editor), Open home folder.
   - **Who can ask** per source: the owner's own id per source (with "how to find my id" help) and
     added members with roles; pending access requests.
   - Sources the bot answers on, schedules and triggers (a list of its automations, with **New
     schedule** and **New trigger** that open the automation editor with `botId` set).
   - Pause, Delete (with the home kept unless "also delete the folder" is ticked).

All new strings are English in the code with Japanese added to `apps/desktop/src/i18n/ja/`.

# Non-goals

- Editing `SOUL.md` in a special form; it is a Markdown file in the editor.
- A bot store or importing Orca bots (Orca's import page) in this work.

# Acceptance

- `bun test` in `apps/desktop`: the bots store reduces `botsChanged` and `connectorStatusChanged`;
  the `@handle` parser finds a bot handle only at the start of a prompt.
- In the running app (checked over CDP): create a bot with no relay configured, open its chat from
  the sidebar, send "what is in SOUL.md?", and get an answer quoting it.
- `@reviewer summarise this chat` in another chat opens a new chat under the bot with a link back.
- Pairing with a `wrangler dev` relay shows "connected" and the host id; Unpair returns to the form.
- A question from a Discord-started bot chat appears in the inbox; answering it there makes the
  fake Hub receive the answer and `prompt-cleared`.
- Bot chats are hidden from project lists until "Show bot chats" is on.

# Decisions

Answered by the person on 2026-11-22: the bot list is a **Bots** entry in the left sidebar's
navigation, like Orca, not a section above the projects or a tab.

# Open questions

None for the person.

[^orca-docs]: Orca Bots quickstart
