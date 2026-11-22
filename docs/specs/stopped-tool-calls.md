---
type: Spec
title: Tool calls a stopped turn leaves open read as stopped
description: When a turn is known to have stopped (Stop, a failed turn, the daemon restarting) or a chat's Claude process is gone, every tool call still pending or running is closed as stopped, live and on replay, instead of spinning forever.
status: stable
x-zomfy-implementation: done
tags: [chat, daemon, desktop, transcript, background-tasks]
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

After Zomfy's daemon restarted (an update, a crash, the person restarting it), the tool calls a turn
had in flight (a Bash command, a subagent and the calls inside it) kept their spinner and the
subagent kept saying "Working" for good, even though the chat said "Stopped: the daemon restarted
during this turn". The same happened after Stop or a failed turn whenever the agent's process
ended before it reported a result for a call. The transcript never got a final status for those
calls, so every replay showed them running again.

# What it does

## In the daemon (the record)

- Whenever the daemon records a notice that ends a turn (one carrying `harness/turnEnd`: Stop,
  a failed or usage-limited turn, "Stopped: the daemon restarted during this turn"), it first
  records, for every tool call in the chat's transcript whose last status is `pending` or
  `in_progress`, a `tool_call_update` with `status: "failed"` and
  `_meta["harness/toolStopped"]: true` (`TURN_RECOVERY_META.toolStopped`). Live windows receive
  them as any update; replays carry them.
- The same happens when the chat's Claude process is known to be gone between turns: the notice
  that its background tasks were stopped (the next daemon's "Zomfy restarted, which stopped the
  background tasks…", the hour cap, the chat moving or closing), so a background subagent's calls
  close too ([background-task-wake.md](background-task-wake.md)).
- ACP has no stopped status, so `failed` keeps other clients (the phone) from showing the call as
  running; the meta flag says it was stopped, not a failure of the call itself.

## In the desktop app (the view)

- A `tool_call_update` with the flag sets the call's status to `stopped`.
- A turn-end notice also sets every still-open call before it to `stopped`, so transcripts written
  before this change replay without spinners.
- A stopped call shows its tool glyph, no spinner and no failure colour; it is not counted as
  failed nor kept in view as running in a folded run of calls. A stopped subagent shows "Stopped".

# Out of scope

- Restarting the stopped calls: the chat's Continue already asks the agent to check whether its
  last step finished.
