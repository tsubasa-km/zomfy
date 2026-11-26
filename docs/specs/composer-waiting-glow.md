---
type: Spec
title: The composer glows while the chat waits for the person
description: While a chat is "Needs you" (a question, a tool approval or another ask), its composer's border shows a glow; Settings picks Rainbow (default), Accent pulse, Static outline or Off, each with a live preview.
status: stable
x-zomfy-implementation: done
tags: [chat, desktop, composer, settings]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

When an agent stops to ask the person something (Claude's AskUserQuestion, a tool permission
approval, a split-work confirmation), the chat says so with an orange dot in the sidebar and a card
in the transcript. A person looking at the composer, where they would type next, sees nothing
different from an idle chat.

# What it does

## When it glows

The composer glows while its chat's session status is `needs-you`. That status is the one source of
truth: the daemon sets it before every ask the person must answer (`askPermission`, which carries
AskUserQuestion and tool approvals alike, and the split-work confirmation), and the sidebar, inbox,
status bar and notifications already read it. The glow ends when the status leaves `needs-you`.

The open chat's composer (`NativeChatComposer`) is the one that can wait, in the main view and in
the right sidebar's side chat once that side chat has started (it is a `ThreadView` too). The
new-thread composer and a side chat's first-message composer belong to no session yet, so they
never wait; they take the same `waiting` prop of `NativeChatComposerBox`, which they leave off.

## Patterns

Settings → Input & Editing → Thread → **Waiting glow** (`chatWaitingGlow`), persisted with the
other UI settings:

- **Rainbow** (default) – a soft rainbow gradient runs around the border, one turn every few seconds.
- **Accent pulse** – the border breathes in the app's highlight color, with a faint halo.
- **Static outline** – a solid ring in the needs-you color (the sidebar dot's orange), no motion.
- **Off** – the composer looks as it does when idle.

Each option shows a small live preview of its pattern beside its label. Under
`prefers-reduced-motion: reduce`, Rainbow shows its gradient standing still and Accent pulse shows
its color without breathing.

A new key needs no `settingsRevision` move: a saved window without it reads the default.

## Cost and layout

The box carries `data-waiting-glow` only while it waits and the pattern is not Off; every rule and
animation hangs on that attribute, so an idle composer runs no animation and paints as before. The
glow recolors the existing 1px border (a gradient in the border box under the surface in the padding
box) and adds at most a `box-shadow`, so nothing moves. A tab or file dragged over the box shows the
drop ring instead of the glow.

# Out of scope

- Glowing other inputs (terminals, the inbox) or the tab strip.
- A per-chat or per-agent choice of pattern.
