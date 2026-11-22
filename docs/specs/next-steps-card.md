---
type: Spec
title: The Next steps card
description: The card a turn ends with, from wrap_up or the reply's recap; its done/check sections open by default, and its buttons say plainly what they do, the person's own steps going to the Inbox's To do list.
status: stable
x-zomfy-implementation: done
tags: [chat, desktop, next-steps, inbox, todos]
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# What it is

A turn's Next steps card (`NativeChatNextStepsCard.tsx`) comes from the agent's `wrap_up` call or,
for a reply made without it, from the recap the reply ends with ("### やったこと", "### 確認状況",
"### ネクストステップ"; parsed in `next-steps.ts`). It shows a short summary or the recap's other
sections, each step with its owner, and the agent's question as buttons.

# Behaviour

## The recap's sections

- The recap's sections before the steps (what was done, what was checked) are shown expanded when
  the card first appears; their header still collapses them.

## A step the agent owns

- Its button "Ask to do this" sends the chat a prompt asking the agent to go ahead with that step.
  Its tooltip says so: it sends the agent a message in this chat. Once sent it reads "Asked".

## A step the person (or someone else) owns

- Its button "Add to Inbox" adds the step to the To do list in Zomfy's Inbox (opened from the
  status bar), linked back to this chat. Its tooltip says where it goes and that nothing is sent
  to the agent.
- After adding, a toast confirms "Added to your Inbox's To do list" with an "Open Inbox" action
  that opens the Inbox scrolled to To do.
- A step already in the To do list (open or done, matched by its text) shows "In Inbox" with a
  check; pressing it opens the Inbox at To do. A failed add shows an error toast and leaves the
  button as it was.
