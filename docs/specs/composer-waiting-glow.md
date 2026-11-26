---
type: Spec
title: The place the person acts next glows
description: A waiting question or approval card glows, or the Next steps card's question when the turn ended with one, or else the composer when it is simply the person's turn; one place at a time, in the pattern Settings picks (Rainbow, Accent pulse, Static outline or Off).
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

The first version made the composer glow while the chat was `needs-you`. But the person answers a
question on its card, not in the composer, and when the agent simply hands the thread back (the
person's turn) nothing glowed at all.

# What it does

## Where it glows

The glow marks the one place the person acts next in a thread; only one place glows at a time.
Which one follows the thread's turn-taking state ([turn-taking-states.md](turn-taking-states.md)):

| The thread | What glows |
|---|---|
| A question is waiting (AskUserQuestion, its own or a helper's shown in this thread) | The **question card** (`data-question-card`) |
| An approval or a split confirmation is waiting (its own or a helper's) | The **approval card** |
| Your turn, and the latest turn's Next steps card asked a question nobody has answered | The Next steps card's **question block** (`data-next-steps-question`) |
| Your turn otherwise | The **composer**, until the person starts typing |
| Working, Background work running, Quiet, a failed turn | Nothing |

A waiting card is the one `ThreadView` docks above the composer (`pendingPermission`), so a
helper's ask shown in the parent thread glows there too, though the parent's own status is not
`needs-you`. The Next steps question counts only on the thread's last Next steps card, with no
prompt sent after it.

The open chat's composer (`NativeChatComposer`) is the one that can glow, in the main view and in
the right sidebar's side chat once that side chat has started (it is a `ThreadView` too). The
new-thread composer and a side chat's first-message composer belong to no session yet, so they
never glow; they take the same `waiting` prop of `NativeChatComposerBox`, which they leave off.

## Patterns

Settings → Input & Editing → Thread → **Waiting glow** (`chatWaitingGlow`), persisted with the
other UI settings:

- **Rainbow** (default) – a soft rainbow gradient runs around the border, one turn every few seconds.
- **Accent pulse** – the border breathes in the app's highlight color, with a faint halo.
- **Static outline** – a solid ring in the needs-you color (the sidebar dot's orange), no motion.
- **Off** – nothing glows.

Each option shows a small live preview of its pattern beside its label. Under
`prefers-reduced-motion: reduce`, Rainbow shows its gradient standing still and Accent pulse shows
its color without breathing.

A new key needs no `settingsRevision` move: a saved window without it reads the default.

## Cost and layout

The glowing element carries `data-waiting-glow` only while it glows and the pattern is not Off;
every rule and animation hangs on that attribute, so nothing else runs an animation or paints
differently. The glow recolors the element's existing 1px border (a gradient in the border box under
the surface in the padding box) and adds at most a `box-shadow`, so nothing moves. Each element sets
`--composer-glow-surface` to its own background (the composer's surface, a card's `--card`, the
transcript canvas for the Next steps question). A tab or file dragged over the composer shows the
drop ring instead of the glow.

# Out of scope

- Glowing terminals, the inbox or the tab strip (the tab's state dot says Your turn instead).
- A per-chat or per-agent choice of pattern.
