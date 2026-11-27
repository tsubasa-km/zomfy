---
type: Spec
title: Summarize the first message into a thread title
description: An agent's own thread title takes precedence, and a host setting enables a summary when the backend leaves a new thread unnamed.
status: stable
x-zomfy-implementation: done
tags: [chat, daemon, desktop, settings]
sources:
  - id: request
    resource: Feature request in the Zomfy development conversation on 2026-11-27
    title: Opt-in titles summarized by the model that starts the thread
  - id: current-title
    resource: Zomfy at 35a723d, packages/daemon/src/harness-agent.ts lines 532–549
    title: Initial naming from the first prompt
  - id: native-title-request
    resource: Follow-up on thread naming in the Zomfy development conversation on 2026-11-27
    title: Reuse agent-provided titles and avoid a duplicate request
  - id: claude-session-info
    resource: https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser
    title: Claude Agent SDK session metadata
  - id: codex-thread-info
    resource: https://learn.chatgpt.com/docs/app-server
    title: Codex App Server thread metadata and title notifications
generated: { by: "codex/gpt-6", at: "2026-11-27T07:24:30Z" }
---

# Problem

New threads use the start of the first message as their title. Long prompts can begin with context
that makes the resulting thread hard to recognize in the list.[^current-title] People can opt in
to a short title that describes what they asked for.[^request] When the agent already supplies a
title, the thread should use it and skip a second model request.[^native-title-request]

# Behavior

- The first-message title appears as soon as the person sends the message. A name set by the
  person has first priority. A title supplied by the agent has priority over a Zomfy summary or
  the first-message title. Use the usual thread updates to reflect the title in the sidebar and
  tab, including when the agent supplies it after the first turn. Track where the title came
  from even when two titles have the same text.
- **Settings → Agents → Summarize thread titles** is a switch for the selected host. It starts off,
  including when a saved host has no value for it. The switch enables Zomfy's extra model
  request. An agent's own title can appear in either setting.
- Claude Code can supply a title in its session metadata. Use that title when available and
  make zero additional title requests for Claude. A session's first-prompt preview keeps its
  first-message status.[^claude-session-info]
- For a supported Codex connection that relies on the client for titles, wait for the first
  response to finish and check the backend for a title before the extra request. App Server
  exposes a thread name and thread-name notifications.[^codex-thread-info] Start at most one
  request if the thread is still using its first-message title and the switch is on. A late
  backend title takes priority and invalidates any pending result, including when its text
  matches the first-message title.
- Ask the first turn's agent, account and effective model for one short line in the language
  of the submitted text. The request is transient and has no tools or connectors. The normal
  turn starts and streams without waiting for title work. Messages without text, unavailable
  title requests, errors and empty results keep the best title already present.
- A manual rename, deletion or disabling the switch makes a pending Zomfy title result
  inapplicable.

# Scope

The feature applies when a person starts a new thread. Existing conversations and names, imported
history, and threads started by a bot, workflow or automation have no title job. Subsequent sends
do not generate a title. The existing manual rename works at any time.

# Acceptance

- With the switch off, sending a first message makes no extra title request. The host remembers
  the switch across restarts, and older settings load as off.
- Claude makes zero extra title requests even when its own title is missing or late. A title
  supplied by Claude is shown in the thread.
- With the switch on, Codex runs the normal turn first and asks for a title only when the backend
  leaves the thread unnamed. The request uses the actual model from the turn, including an
  explicitly selected model or the effective default. The sidebar and tab receive the result.
- A backend title available before the request prevents it. A backend title arriving during or
  after the request takes priority. Test this with a title equal to the first-message title too.
- Neither automatic path overrides a manual rename. Repeated sends, prior conversations and
  explicitly named threads make no extra request.
- The desktop preview shows the change in place with Codex and confirms both switch states.

[^request]: Opt-in titles summarized by the model that starts the thread.
[^current-title]: Initial naming from the first prompt.
[^native-title-request]: Reuse agent-provided titles and avoid a duplicate request.
[^claude-session-info]: Claude Agent SDK session metadata.
[^codex-thread-info]: Codex App Server thread metadata and title notifications.
