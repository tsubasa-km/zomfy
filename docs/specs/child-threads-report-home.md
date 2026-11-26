---
type: Spec
title: Child threads stay quiet and report to the thread that launched them
description: Threads another thread started (create_session, create_workspace, split_work, workflow and bot workers) raise no notification, Inbox entry, unread mark or tray dot of their own, and when one an agent prompted stops, the daemon tells the launching thread in one batched turn.
status: stable
x-zomfy-implementation: done
tags: [threads, helpers, notifications, inbox, daemon, manager-tools]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

Zomfy's person works in one long-lived thread; the helpers that thread starts are its tools. Two
things worked against that:

- **The person heard from every helper.** Desktop notifications, the Inbox's `finished` entries,
  unread marks and the tray's attention dot treated a helper like the person's own thread: four
  helpers meant four "Claude finished" notifications and four Inbox rows, then the lead's own.
- **The lead heard from none of them.** Only `split_work` started the lead's turn when its parts
  finished. A lead that used `create_session` / `create_workspace` + `send_prompt` had to keep its
  turn open in `wait_for_session` (run by the desktop window, at most 30 minutes, returning when any
  one session stopped), or end its turn and wait for the person to nudge it. Nobody continued the
  work when a helper finished.

# Who is a child

A thread is a **child** when it has a `parentId`: the daemon sets it on a chat an agent created with
the manager tools (`create_session`, `create_workspace`, from the calling chat, one level deep), on
split_work's helpers and workflow chats (`origin: 'workflow'`), and on the workers a bot chat starts.
Side chats (`sideOf`) are the person's own conversation beside a thread and are not children.

# What it does

## The person hears only from the parent

In the desktop app, for a child thread:

- No "finished" or "stopped with an error" desktop notification.
- No unread mark, so no Inbox `finished` entry, no "Done" on its row, and no tray attention dot
  when it finishes.
- When it needs the person (a question or approval), that reaches the person once, through the
  parent: the question or approval card shows in the parent thread (as it already did for
  split_work and workflow helpers, now for every child), the Inbox keeps its approval entry, the
  tray counts it as waiting, and the one desktop notification names the parent thread
  ("{parent} · from {child}").
- Children stay where the person looks for them on purpose: under their parent in the sidebar and
  in the session panel, with their status, just quiet.
- Settings → Notifications → **Helper threads** (off by default) brings back a child's own
  notifications and unread marks, as for any thread.

## The launching thread is told when its child stops

The daemon keeps, for each chat an agent prompted through `send_prompt`, `create_session` or
`create_workspace` with a prompt, the chat that prompted it (its **launcher**). When that turn
stops (the chat leaves `working` for `idle`, `error` or `needs-you`), the daemon reports it to the
launcher:

- **Batched.** Stops are gathered for a short moment (3 s after the last one, 15 s at most), and
  finished reports wait while other chats the same launcher prompted are still working, so a lead
  that started several helpers gets one turn when the last of them is done. A child that needs the
  person or failed is reported without waiting for its siblings.
- **Idle launcher:** the daemon starts a turn in it with a harness note (`Helper finished: <title>`,
  or `Helpers reported: N chats stopped`) listing each child, its session id, its status, its last
  reply (3000 characters at most, withheld for a local-only chat) and its `wrap_up` summary if it
  gave one. A child that needs the person lists what it waits on and tells the lead to answer with
  `answer_approval` when it can decide, else to tell the person, who sees the card in the lead.
- **Busy launcher:** the note is kept and the daemon starts that turn when the launcher's current
  turn ends. A `wait_for_session` in that turn that already returned the child's stop takes the
  child out of the note, so nothing is said twice.
- **Archived launcher, a launcher that cannot take a turn now** (its conversation is open in a
  Claude terminal, its last turn failed): the note goes into the context its next turn starts with,
  and no turn is started. A launcher that was closed gets nothing.
- A turn the person starts in the child, or one it starts itself, is not reported: the launcher
  link ends with the reported turn and is made again by the next `send_prompt`.
- split_work's helpers and workflow chats keep their own reports (split_work's "every part has
  finished" turn, the workflow's run activity) and are not reported this way.

### Loops

- A chat never becomes the launcher of itself, of the chat that launched it, or of its own parent:
  a helper prompting its lead does not set up a report back to the helper.
- At most 10 report turns are started in one chat within 10 minutes; further reports go into the
  context its next turn starts with, and the daemon logs it.

## wait_for_session runs in the daemon

`wait_for_session` on sessions of the caller's own host is served by the caller's daemon, so it
works with no window open (a lead started from the phone or a bot) and sees turns the instant they
start. It waits until any of the sessions stops (or, with `all: true`, every one), the timeout passes
(default 300 s, at most 1800 s) or the caller's turn is stopped. A session that was just prompted
reads as working until its turn starts (at most 30 s). The result has the same shape as before:
`timedOut`, and per session `sessionId`, `title`, `status`, `lastReply` and `waitingOn` (the titles
of its pending approvals; `list_approvals` gives their ids). Sessions on another host still go to
the window, as before.

## The agents know

The descriptions of `send_prompt`, `create_session`, `create_workspace` and `wait_for_session`, and
the `zomfy-worktrees` skill, say that the launching chat is told when the chat it prompted stops:
end the turn rather than poll, and use `wait_for_session` only to act on the result within the same
turn.

# Out of scope

- Reports across hosts: a lead on one host prompting a chat on another is not told; it still uses
  `wait_for_session`, which the window serves for other hosts.
- Keeping launcher links and unsent notes across a daemon restart (a restart stops the turns too).
- The thread status vocabulary, the sidebar's grouping and the composer and card glow (another
  spec).

# Acceptance

- Daemon tests with fake chats: a lead that prompted two children gets one batched turn when both
  stop; a busy lead gets the note at its next turn; a `wait_for_session` that returned a child's
  stop keeps it out of the note; a child that needs the person is reported once; an archived lead
  gets the note as context and no turn; a child prompting its launcher sets up no report back.
- Desktop tests: a child's finish raises no notification, unread mark, Inbox entry or tray dot; its
  needs-you raises one notification naming the parent; the setting brings the old behaviour back.
- In a preview, a helper's finish shows no notification or Inbox entry, and the lead's turn starts
  with the helper's report.
