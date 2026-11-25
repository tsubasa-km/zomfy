---
type: Spec
title: Thinking that holds the answer shows open
description: When a turn's reply is short and its last thinking is long, the chat shows that thinking expanded, as markdown marked as thinking; a setting picks collapsed, expand when the reply is short (default), or always expanded.
status: stable
x-zomfy-implementation: in-progress
tags: [chat, desktop, transcript, settings]
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Problem

Zomfy folds an agent's thinking under a collapsed "Thinking" row. Sometimes the model writes its real
answer there (a long explanation with a code block) and replies with one sentence, so the person
reads the sentence and misses the answer.

# What it does

## Which thinking opens

When a turn has ended, its last thinking row with no tool calls after it is the candidate. It is
shown **prominent** when both hold:

- the reply after it is short: the turn's agent text after that thinking (a recap read as the
  Next steps card counts) is under 280 characters once trimmed, or empty;
- the thinking is substantial: at least 400 characters once trimmed, or at least 120 with a code
  fence in it.

A wrap_up card is not a reply. A turn still running decides nothing, so thinking that streams stays
collapsed and opens once the turn ends rather than jumping while the reply streams.

## How it looks

A prominent thinking row starts open, shows its whole text (no inner scroll box), and stays marked
as thinking: the brain glyph and "Thinking" label (思考) above it, muted text, indented behind a thin left
rule. Its markdown renders as replies do, code blocks with their Run buttons included. The
disclosure still opens and closes it; a click holds until the setting changes or the row becomes
prominent at its turn's end.

## The setting

Settings → Input & Editing → Thread → **Show thinking**, persisted with the other UI settings
(`chatThinkingDisplay`):

- **Collapsed** – every thinking row starts closed, as before.
- **Expand when the reply is short** (default) – prominent rows start open.
- **Always expanded** – every thinking row starts open; a non-prominent one keeps its scroll box.

## Performance

The decision is made in the transcript model when a turn closes (`closeTurn`), on rows already
built; a settled turn's rows keep their identity, so the incremental builder and the
block-virtualized rows render as before.

# Out of scope

- Moving thinking into the reply or changing what the agent writes.
- The phone app.

# Acceptance

- `bun test` in `apps/desktop` covers the thresholds: short and empty replies, long and fenced
  thinking, thinking before a tool call, a running turn, a recap reply.
- In a fabricated transcript in the preview, a short-reply turn shows its thinking open and marked;
  the setting's three choices behave as above.
