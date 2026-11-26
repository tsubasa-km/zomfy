---
type: Spec
title: The Next steps card
description: The card a turn ends with, from wrap_up or the reply's recap, holds only what comes next - the person's own next actions, numbered and strong, the agent's question as buttons, and the agent's own next steps small and faint behind its icon, with no headings.
status: stable
x-zomfy-implementation: done
tags: [chat, desktop, mobile, next-steps, inbox, todos]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# What it is

A turn's Next steps card (`NativeChatNextStepsCard.tsx`) comes from the agent's `wrap_up` call or,
for a reply made without it, from the recap the reply ends with ("### ネクストステップ"; parsed in
`next-steps.ts`).

The person looks at it to learn what **they** should do next. So it holds only what comes next:

1. **The person's next actions**, the headline: concrete instructions to the person ("Update the
   app to 0.2.60", "Decide whether to ship on Friday", "Try the export in Settings → Data"), most
   important first.
2. **The agent's question**, when the person's first action is a decision: its answers as buttons.
3. **The agent's own next steps**, secondary: smaller, fainter lines behind the agent's icon, with
   no label.

The card has no headings ([ui-principles.md](ui-principles.md)): whose step it is shows by weight
and by the agent's icon.

What was done and what was checked is not on the card: it belongs in the reply body.

# The tool

`wrap_up`'s input (`packages/protocol/src/manager.ts`; normalized by `normalizeWrapUp` in
`packages/protocol/src/wrap-up.ts`):

| Field | | |
|---|---|---|
| `personActions` | required, may be empty | What the person should do next, each an instruction to them, most important first, at most five. Empty when nothing needs them. |
| `agentSteps` | optional | What the agent will do next, short, at most three. |
| `question` | optional | `{ text, options }` with two to four answers, only when the person's first action is a decision. |

The hint every chat gets (`WRAP_UP_HINT`) and the tool's description ask for exactly this, and say
the card is not a recap. The hint stays a few sentences: it is in every turn's context.

Older agents and transcripts still send `summary` and `steps` (`{ owner, text }`); they are still
accepted. Their `person` steps become the person's actions, `agent` steps the agent's, and a step
owned by someone named ("田中さん") is one of the person's actions with that name as a chip (the
person is the one to chase it). An old card's summary sits at the card's foot in small faint text,
below a rule, with no label, so nothing an old card said is lost.

## When the agent calls wrap_up

- The answer comes first. The hint, the tool's description and its result all say the same order:
  write the complete answer as the visible reply, not in thinking; then, as the very last step,
  call `wrap_up`; after it, end the turn without repeating the answer, at most one short line.
- The card is placed when the turn ends: right under the turn's last reply. A recap the answer ends
  with is still read when it sits in the turn's final run of replies (no tool call after it).

# Behaviour

## The headline

- With actions: the numbered actions are the card's top, strong. Each has an icon button (a list
  with a plus, tooltip "Add to Inbox") that shows on hover or focus and adds it to the To do list in
  Zomfy's Inbox, linked back to this chat. A toast confirms "Added to Inbox" with "Open Inbox". An
  action already in the To do list (open or done, matched by text) keeps a green checked-list icon
  in place (tooltip "In Inbox") that opens the Inbox at To do. A failed add shows an error toast.
- With nothing for the person and no question: the card steps back to a faint box holding only the
  agent's steps. With nothing at all (no actions, question, steps or old summary) no card is
  drawn.

## The question

- Under the actions: the question and its answers. Pressing one sends it as the next prompt; the
  pressed answer stays marked.
- When it is the person's turn and the thread's last card has an unanswered question, the question
  block (`data-next-steps-question`) is what glows ([the glow](composer-waiting-glow.md)).

## The agent's next steps

- Below a rule when the person has something above, in smaller, fainter text behind the agent's
  icon (Claude's, Codex's…), one line per step. The accessible name says "Next, {agent} will:".
- "Ask to do this" is a play icon button on the step's line, shown on hover (tooltip "Ask to do
  this"; a green check, "Asked", once sent). It sends the chat a prompt asking the agent to go
  ahead with that step, and exists only when the person has no actions and no question: that is
  when the person's next move is to let the agent go on.

## A recap read from the reply

- A reply that ends with "### ネクストステップ" (or "Next steps") and no `wrap_up` shows everything
  before that heading as the reply, done and checked sections included, and the steps as the card.
  The copy button on the reply copies the whole original text.

# On the phone

The phone app (`apps/mobile`) shows a `wrap_up` call as a small Next steps block instead of a tool
line, without headings: the person's actions first, numbered and strong, then the question, then
the agent's steps small and muted behind an arrow. A call with nothing in it draws nothing. Notifications and the Inbox do not show `wrap_up` content.

A chat that launched helpers is told, when one stops, what its wrap_up asks of the person and what
it will do next (`child-reports.ts`), the old summary for older calls.

# Acceptance

- A new-style card with actions and a question, one with only the agent's steps, and an old-style
  card (summary + owner steps) render as above, in light and dark, with no headings.
- `normalizeWrapUp` accepts both shapes; tests cover the mapping.
