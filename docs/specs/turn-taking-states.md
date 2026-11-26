---
type: Spec
title: Threads say whose turn it is
description: Every surface that shows a thread's state uses five turn-taking states (Needs your answer, Your turn, Working, Background work running, Quiet) derived from what the daemon reports, instead of the sidebar's "Done" and "Settled".
status: stable
x-zomfy-implementation: done
tags: [chat, sidebar, tabs, mobile, daemon, protocol]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

Zomfy is used as one long-lived thread with an agent: when the agent's turn ends it is the person's
turn. The sidebar sorted threads instead by "Needs you / Done / Working / Settled". "Done" meant
"stopped and not yet looked at" and "Settled" meant "stopped and looked at", both kept only in the
window's memory, so a restart dropped every thread into Settled. Neither said whose turn it was:
a thread the agent handed back with a question sat in the quietest group once opened, and a thread
whose turn ended with background tasks or a scheduled wake-up still pending read as Settled while it
was still going. "Done" also meant three things (the sidebar, the dashboard, the workspace board).

# The states

| State | ja | Meaning | Who moves next |
|---|---|---|---|
| **Needs your answer** | 回答待ち | A question, an approval or a split confirmation is waiting, or the last turn failed | The person, by answering |
| **Working** | 作業中 | A turn runs (in this thread, or in a helper or worker under it) | The agent |
| **Background work running** | バックグラウンドで作業中 | The turn ended, but background tasks run or a scheduled wake-up is due; the thread goes on by itself | The agent (the person may wait) |
| **Your turn** | あなたの番です | The agent's last turn ended after the person's last prompt and nothing is going on | The person |
| **Quiet** | 静か | It was the person's turn, they have seen the thread, and it has been untouched for a while (default 24 hours); also a thread that never ran a turn | Nobody |

"Background work running" is a kind of Working: it groups with Working and draws like it, with its
own icon (the Activity mark) and label.

## How each is detected

The daemon keeps owning `SessionStatus` (`idle | working | needs-you | error`) and its meaning does
not change, so older clients keep working. It adds to `SessionInfo`:

- `background?: { tasks: string[]; wakeUps: SessionWakeUp[] } | null` — the chat's live background
  tasks (from the Claude process's `background_tasks_changed`) and its pending scheduled wake-ups
  (from the Stop hook's `session_crons`, see [scheduled-wake-ups.md](scheduled-wake-ups.md)), each
  with its next fire time. Null or absent when there are none. Tasks live in memory only (they die
  with the daemon); wake-ups are saved, so the daemon can still fire them after a restart.
- `yourTurnSince?: number | null` — when the agent's latest turn ended (normally, by Stop, or with a
  failure). Cleared when any turn starts. Saved, so it survives restarts.
- `seenAt?: number | null` — when a window last showed the thread to the person, set through
  `_harness/sessions/markSeen`. Saved.

`turnPhase(info, now, quietAfterMs)` in `packages/protocol/src/turn-taking.ts` derives the state,
checking in this order:

1. `status` is `needs-you` or `error` → Needs your answer.
2. `status` is `working` → Working.
3. `background` has a task or a wake-up → Background work running.
4. `yourTurnSince` is set, and not (seen since then and `now - lastActivityAt ≥ quietAfterMs`) → Your turn.
5. Otherwise → Quiet.

A daemon that predates the fields sends none of them: an idle thread with a turn in the last
`quietAfterMs` reads as Your turn, an older one as Quiet.

A thread's helpers and workers (`parentId`, side chats) fold into its row as before: a child that
needs an answer makes the row Needs your answer, a working child makes it Working, a child with
background work makes it Background work running; a child's Your turn and Quiet do not lift the
parent.

## Quiet after

Settings → Input & Editing → Thread → **Quiet after** (`chatQuietAfterHours`): 1, 4, 24 (default)
or 72 hours, or Never (0). It is read by the desktop only; the phone uses the default.

# Where it shows

- **Sidebar**, grouped by state: Pinned, Needs your answer, Your turn, Working (Background work
  running rows inside it), Quiet, Archived. A Quiet row is the single grey line a Settled row was.
  The row's corner says the state with its mark ("Your turn", "Background · 12m", "Wakes 14:30").
  Group by Project keeps its folders and uses the same row corner.
- **Tab**: the dot beside a chat tab follows the state: question mark (Needs your answer), spinner
  (Working), Activity mark (Background work running), a small accent dot (Your turn), none (Quiet).
  The tooltip names the state.
- **Thread**: above the composer, a one-line status names background work while it runs
  ("Background work running: bun test · wakes at 14:30"), the thread's equivalent of a header.
- **Session panel** (right sidebar, Session tab): the head line under the thread's title says its
  state, and a "Background work" section lists the running tasks and the pending wake-ups with
  their times.
- **Hover card** in the sidebar: the state's label in place of the old Idle/Done.
- **Phone**: the thread list and the chat screen use the same five labels and translations;
  "Needs you" becomes "Needs your answer" (回答待ち) there too.
- **Agent Dashboard** and its counts in the sidebar: lanes Needs your answer, Working (background
  work too), Your turn and Quiet, instead of Needs You / Working / Done / Idle. An idle chat's dot
  elsewhere (workspace cards, Send to agent) is the plain grey dot, no longer Done's check.

"Your turn" reads あなたの番です in Japanese, the translation the workflow run view already used.

The words "Done" and "Settled" are no longer used for chat threads. "Done" remains only where it
means a finished task (the task list, the workspace board, the dashboard's TUI agents).

# Out of scope

- Notifications, the Inbox and the tray (another change covers helper threads there).
- A control to stop one background task or cancel one wake-up.
- The manager tools' `wait_for_session` reading these states.
- Recording `wrap_up`'s question in the daemon (the glow spec reads it from the transcript).

# Acceptance

- A thread whose turn ended shows under Your turn after the app restarts, until the person sends a
  prompt; opened and left for 24 hours, it moves to Quiet.
- A turn that ends with a background Bash running shows Background work running in the sidebar,
  tab, thread and session panel, and Your turn once the task's woken turn ends.
- A turn that ends with a ScheduleWakeup shows Background work running with the wake time.
- Older daemons' threads still group sensibly (no field, no crash).
