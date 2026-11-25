---
type: Spec
title: The thinking effort shows in the composer
description: The composer's model button names the effort a chat runs at ("Opus · High"), including the level Claude's default resolved to on the chat's last turn, and the effort picker always has one level selected, Default included.
status: stable
x-zomfy-implementation: done
tags: [chat, desktop, daemon, composer]
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Problem

A Claude chat's composer shows the model and, only when one was picked, the effort. A chat on
Claude's default effort shows nothing, and the picker's effort row has no level selected, so the
person cannot tell what effort is in use.

# What it does

## The model button

The button reads model and effort joined by a dot: "Opus · High". For Claude:

- An effort picked for the chat shows as its level.
- No effort picked (Claude's default): the level the default resolved to on the chat's last turn
  with the same model, as "High (default)"; while that is not known (a new chat, a changed model),
  "Default".
- A model without effort levels shows the model alone.

The tooltip and the screen-reader label say the same. ACP agents and Codex already name their
current effort choice (Codex resolves its default itself); they get the same "·" separator.

## The picker

The effort row starts with a **Default** choice, selected when no effort is picked; its tooltip
names the level it resolved to when known. Picking Default clears the chat's effort. The picked
level is always the selected one.

## Knowing the default

Claude reports the effort a turn runs at only to hooks (`effort.level` on the `Stop` hook's
input); its init message from an SDK process does not carry it. A Claude chat's turns register a
`Stop` hook that only reads it; when the turn ran with no effort picked, the daemon keeps
`{ model, effort }` on the session as `defaultEffort` (`model` is the chat's model option, null for
the default model), and the button uses it while the chat's model option still matches.

# Out of scope

- The new-thread composer and side chats, which have no turn yet: they show "Default".
- Changing Claude's default effort itself.

# Acceptance

- `bun test` in `apps/desktop` covers the labels: picked, default known, default unknown, a model
  without efforts, a changed model.
- `bun test` in `packages/daemon` covers reading the effort from the hook input.
- In the preview, a Claude chat's composer shows "Model · Level" and the picker selects a level.
