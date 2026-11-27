---
type: Spec
title: Summarize the first message into a thread title
description: A host setting lets the starting model write a short title for a new thread from its first message.
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
generated: { by: "codex/gpt-6", at: "2026-11-27T01:31:27Z" }
---

# Problem

New threads use the start of the first message as their title. Long prompts can begin with context
that makes the resulting thread hard to recognize in the list.[^current-title] People can opt in
to a short title that describes what they asked for.[^request]

# Behavior

- **Settings → Agents → Summarize thread titles** is a switch for the selected host. It starts off,
  including when a saved host has no value for it. A thread sent while the switch is off uses the
  existing naming behavior and starts no additional model request.
- With the switch on, the first accepted user message of a fresh, unnamed thread starts one
  background request on the same agent, account and effective model as the first turn. Resolve the
  model from that turn, including when the composer uses its default. The main reply starts
  independently and streams as usual.
- The request uses the text submitted in that first message as the material to summarize. It asks
  for one short line in the language of the request. The title call is transient and has no tools
  or connectors. Its output only updates the thread title. A message with no text supplies no
  material for a title request.
- The current first-message title appears immediately. A valid generated title replaces it and
  follows the usual title updates to the sidebar and tab. Keep the current title if the request
  fails, runs out of time, gives no usable title, or the connection cannot use the same model
  in an isolated request. Keep a name set by the person, including changes during generation.
  Discard a result for a deleted thread or when the setting is off at completion.

# Scope

Title requests are supported for Claude Code and Codex connections that can reuse the same model
and account in an isolated request.

The feature applies when a person starts a new thread. Existing conversations and names, imported
history, and threads started by a bot, workflow or automation have no title job. Subsequent sends
do not generate a title. The existing manual rename works at any time.

# Acceptance

- With the switch off, sending a first message makes no title request. The selected host remembers
  the switch across restarts, and older settings load as off.
- With the switch on, an explicitly selected model and the effective default are both carried
  from the first turn to the title call. The normal reply can begin before the title returns.
  A successful result updates the same thread on the host and in the desktop sidebar and tab.
- Repeated sends, threads with prior user messages and explicitly named threads make no new title
  request. In-flight failures and manual renames leave the current thread and its name intact.
- In the desktop preview, the switch can be found and set on the selected host, and the title
  changes in place after a successful first-message request.

[^request]: Opt-in titles summarized by the model that starts the thread.
[^current-title]: Initial naming from the first prompt.
