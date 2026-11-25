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
- The phone app starts a bot chat the same way, from its Bots screen
  ([bots in the phone app](../mobile/bots.md)); the chat then shows in the windows like any other.
- Typing `@<handle>` at the start of a prompt in any chat sends that prompt to the bot as a new bot
  chat, with a link back to the chat it came from.
- Bot chats and the workers they start have `origin: 'bot'`; the normal project lists leave them
  out unless "Show bot chats" is on.

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
   - **Default bot**: at most one bot takes source messages that name no bot by handle; its
     `hello` entry sets `isDefault` ([contract](contract.md#bots-channel-daemon--hub)).

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

# Built so far

Phase B1 (`apps/desktop`: `stores/bots-store.ts`, `lib/bot-state.ts`, `lib/bot-mention.ts`,
`components/bots/`, `components/settings/BotsPane.tsx`; tested in `tests/bots.test.ts`):

- The **Bots** row in `SidebarNav` (hidden from its context menu or Settings → Appearance) opens the
  Bots page beside the sidebar: a row per bot with avatar, name, handle, a dot (running, waiting on
  you, paused) and its five newest chats; clicking the bot opens its newest chat or a new one;
  **New chat** and a settings button per row. The Bots row counts bots waiting on the person.
- **Create bot** / **Edit bot**: name, handle (from the name until edited), avatar (an emoji or an
  image URL), purpose, agent (guarded agents left out), model, permission mode (Ask for approval by
  default), home (`~/zomfy/bots/<handle>` or an existing folder path, with Browse in the app), and
  Default bot.
- A bot chat has a header: the bot, where it came from (a Zomfy chat with a link that brings it to
  the front; a Discord thread with a link that opens it in the browser), and **New chat**.
- `@handle …` at the start of a prompt in any chat's composer calls `chatCreate` with the text and
  `fromSessionId`, clears the composer and opens the new chat; an unknown handle is left as text. The
  New thread page does not take `@handle` yet.
- The thread list leaves bot chats out unless View options → **Show bot chats** is on; a bot chat
  waiting for the person shows either way.
- The inbox shows a bot chat's approvals and questions with the bot's avatar and name, and access
  requests with Allow / Decline in Needs you; the status-bar count includes them.
- Settings → Bots: Relay (Worker URL and setup code, Pair, state, host id, last hello, Unpair,
  Deploy to Cloudflare and `bun run deploy` links), Sources (a card per source with configured or
  not from the relay's `/health` sources, the Discord interactions URL with Copy, and a link to
  the source's spec), and Bots (list, Create bot, and per bot Open SOUL.md / MEMORY.md in the editor,
  Open home folder, Who can ask per source with the owner's id and members, pending access requests,
  Pause, Delete with "also delete the folder").
- Checked in a preview: a bot created with no relay answered "what is in SOUL.md?" quoting it;
  `@reviewer summarise this chat` opened a chat under the bot with a link back; pairing with a
  `wrangler dev` relay showed connected and the host id, and Unpair returned to the form.

Phase B2 (`lib/bot-automation.ts`, `lib/automation-draft.ts`,
`components/automations/BotAutomationFields.tsx`, `components/bots/BotNoticeRow.tsx`,
`components/bots/CopyField.tsx`; tested in `tests/bots.test.ts`):

- Settings → Bots, per bot: **Schedules and triggers** lists its automations (trigger, on/off,
  click to edit) with **New schedule** and **New trigger**. The automation editor takes a bot: it
  hides host, workspace and agent (the bot's home and agent), and adds Runs in (a new chat each
  time, or one chat) and Results go to (its chat, the thread, nowhere, or a place's ref); a
  trigger picks the source, its event kinds, places, "only from" and "text contains".
- **New trigger → Webhook**: **Create webhook URL** mints a hook through the relay and shows the
  URL and key once, with Copy.
- Linear's Who can ask has a member search (`find` through the relay).
- Needs you shows bot notices (a webhook refused in a burst or at its cap) with Dismiss; they
  count with access requests.
- The Sources cards show the Slack, GitHub and Linear URLs with Copy.
- `@handle …` on the New thread page opens a bot chat, as in a chat's composer.
- A source's question answered in the inbox is answered for every side: the daemon clears it in
  the source ([daemon](daemon.md#built-so-far)).
- Checked in a preview: New schedule from a bot saved and listed under it (no relay paired).

Not yet: the end-to-end check of a question answered in the inbox against a relay.

# Decisions

Answered by the person on 2026-11-22: the bot list is a **Bots** entry in the left sidebar's
navigation, like Orca, not a section above the projects or a tab.

# Open questions

None for the person.

[^orca-docs]: Orca Bots quickstart
