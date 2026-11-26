---
type: Spec
title: UI principles - show, don't tell
description: Zomfy's screens say state and structure with colour, shape, marks, glow, motion and place, not with explanatory words; labels name fields, words carry content, errors and destructive warnings, and every visual-only state keeps a tooltip and an accessible name.
status: stable
x-zomfy-implementation: done
tags: [desktop, mobile, ui, design]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Why

People take in a screen by its look first: colour, shape, size, where things are and what moves.
They recognise places they have seen before and read only a few words, late. Agents build and check
a UI by reading it, so they drift toward labelling every state, heading every block and putting a
helper sentence under every field. Each of those is cheap to add and slow to see; together they make
the window feel like something written for a model, not for a person.

# Show, don't tell

- **State lives on the object.** A thread's state is its mark (dot, ring, icon, glow) in a fixed
  place on its row, tab and header, never a word beside it ("Your turn", "Needs your answer",
  "Background", "Working"). Values may stay when they are content: a running turn's elapsed time,
  a scheduled wake-up's time beside an alarm clock, a count.
- **One distinct feature per state that matters.** States that ask different things of the person
  differ in hue *and* shape, so they survive greyscale: Needs your answer is the orange question
  bubble, Your turn a green dot with a halo, Working a spinner, background work the Activity mark,
  a failed turn a red alert circle, Quiet no mark.
- **Group by place and space, not headings.** A group of rows is told by its order in the list, a
  thin rule and a small mark; its name is the mark's tooltip.
- **Weight says whose it is.** On the Next steps card the person's actions are numbered and strong;
  the agent's next steps are small and faint behind the agent's icon. No "For you" / "Next, Claude
  will" headings.
- **Controls that are not the main path appear on hover.** Secondary row actions (Add to Inbox, Ask
  to do this) are icon buttons shown on hover or focus, always shown on touch.
- **No helper sentences.** A field has a label that names it. Remove sentences that explain what a
  field does, what will happen, or why the UI exists ("Shown in the sidebar…", "Changes nothing
  until…", "Zomfy, agents and git push act as this account…"). Dialogs need no description line.
- **Short status.** The status bar, toasts and notices carry the noun or value ("Added to Inbox",
  "3"), not a sentence.

# Where words stay

- Content: names, titles, paths, messages, numbers, the person's own data.
- Labels that name a field or a navigation item.
- Errors: what went wrong, next to where it happened.
- What a choice can't be made safely without: a destructive action's warning, what an automatic
  delete keeps — terse, with an icon.
- Accessibility: every icon-only control and every visual-only state has an `aria-label` and, for
  pointer users, a tooltip. Colour never carries a meaning alone.

# Checking a change

Look at a screenshot, light and dark, not at the DOM: what is seen first in one second, what is left
when it is blurred, and whether every state can still be told apart in greyscale. Then look for
leftover explanation text and cut it ([apps/desktop/VERIFYING.md](../../apps/desktop/VERIFYING.md)).

# Acceptance

- Sidebar rows, tabs, the thread header, the session panel and the Agent Dashboard show thread
  state without state words; Your turn and Needs your answer differ in colour and shape.
- The Next steps card has no headings and no "nothing needs you" line.
- The Add a project, Import, New terminal, Project Settings, Zomfy Relay and waiting-glow settings
  carry no helper sentences.
