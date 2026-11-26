---
type: Spec
title: Threads say whose turn it is
description: Every surface that shows a thread's state uses five turn-taking states (Needs your answer, Your turn, Working, Background work running, Quiet) derived from what the daemon reports, shown by marks and place rather than words, instead of the sidebar's "Done" and "Settled".
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

"Background work running" is a kind of Working: it groups with Working, with its own icon (the
Activity mark).

## How each looks

The states are shown, not named ([ui-principles.md](ui-principles.md)): each has a mark that
differs from the others in hue and shape, and the name is only the mark's tooltip and accessible
label.

| State | Mark |
|---|---|
| Needs your answer | Orange question bubble (`--agent-question`); a failed turn a red alert circle |
| Your turn | Green dot with a soft halo (emerald), never orange |
| Working | The spinner, with the turn's elapsed time |
| Background work running | The yellow Activity mark; with a wake-up, its time (an alarm clock in the thread) |
| Quiet | No mark; the row shows how long ago it last did something |

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
  running rows inside it), Quiet, Archived. A group has no titled heading: its mark (pin, question
  bubble, green dot, yellow ring, moon, archive box), a thin rule tinted for the groups that need
  the person, its count and its fold; the name is the tooltip. Needs your answer's group carries the
  Inbox as an icon button. A Quiet row is the single grey line a Settled row was. The row's corner
  is the state's mark with at most a value: the elapsed time while working, the wake time beside
  the Activity mark. Group by Project keeps its folders and uses the same row corner.
- **Tab**: the dot beside a chat tab follows the state: question bubble (Needs your answer), spinner
  (Working), Activity mark (Background work running), the green dot (Your turn), none (Quiet).
  The tooltip names the state.
- **Thread**: above the composer, while background work runs, one quiet line: the Activity mark,
  what runs ("bun test") and an alarm clock with the wake time. The full sentence is its tooltip.
- **Session panel** (right sidebar, Session tab): the state's mark beside the thread's title, and a
  "Background work" section listing the running tasks (Activity mark) and the pending wake-ups
  (alarm clock and time; a repeat icon for a recurring one).
- **Hover card** in the sidebar: the state's mark (named in its tooltip), the background summary and
  the time.
- **Phone**: the thread list and the chat screen show the same states as marks told apart by shape:
  a larger orange dot (Needs your answer), a green dot with a halo (Your turn), a ring (Working,
  dashed for background work), a red square (failed), a small grey dot (Quiet). A row shows only a
  wake-up time beside its mark; the state's name is the accessibility label.
- **Agent Dashboard** and its counts in the sidebar: lanes Needs your answer, Working (background
  work too), Your turn and Quiet, instead of Needs You / Working / Done / Idle, each headed by the
  group's mark and count; Your turn's cards are tinted green. An idle chat's dot elsewhere
  (workspace cards, Send to agent) is the plain grey dot, no longer Done's check.
- **Status bar**: the question bubble with the count waiting, and the spinner with the count
  working (or a grey dot with the count of threads); no words.

"Your turn" reads あなたの番です in Japanese, in tooltips and accessible names.

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
