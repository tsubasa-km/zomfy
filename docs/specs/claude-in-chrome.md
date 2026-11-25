---
type: Spec
title: Claude in Chrome from Zomfy
description: A per-host setting, with a per-project override, that starts Zomfy's Claude chats with Claude Code's built-in Claude in Chrome server.
status: stable
x-zomfy-implementation: in-progress
tags: [chat, claude, daemon, desktop, connectors, settings]
sources:
  - id: request
    resource: The person's request in the Zomfy development conversation on 2026-11-25
    title: Turn Claude in Chrome on from Zomfy
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Problem

Claude Code drives the person's own Chrome through its built-in Claude in Chrome MCP server, which
it starts only when launched with `--chrome`. Zomfy's Claude chats start Claude Code through the
Agent SDK without that flag, so the browser tools are never there.[^request]

# Behaviour

- **Settings → Agents → Claude** has a switch, *Claude in Chrome*, per host, off by default. Its
  description says the Claude in Chrome extension must be installed and Chrome running. It is
  stored with the host's other agent launch settings (`chat-agents.json`, `claudeChrome`) and
  sent as `claudeChrome` on Claude's `ChatAgentInfo`.
- **Project Settings** has *Claude in Chrome* with three choices: *Use the host's setting*
  (default, unset), *On*, *Off*. Stored as `claudeChrome` on the project.
- When on for a chat (the project's choice, else the host's), the daemon starts its Claude Code
  process with `extraArgs: { chrome: null }` (`--chrome`). The setting is part of the process's
  spawn key, so the next turn after a change starts a process with or without it. The session
  panel's control process (`claude-control.ts`) gets the same flag, and control processes are
  restarted when the host setting changes, so *Connectors* lists `claude-in-chrome` with its
  status (connected, failed…) and its tools.
- In *Connectors* the `claude-in-chrome` server shows the Chrome icon.

# Not in scope

- Installing the extension or starting Chrome; Zomfy only passes the flag.
- Codex and other agents.

# Acceptance

- Off (default): no `extraArgs` are passed; on: turns and the control process pass
  `{ chrome: null }`; a project's choice overrides the host's.
- With the extension installed and Chrome running, a Claude chat with the setting on lists the
  `mcp__claude-in-chrome__*` tools, and the session panel's Connectors shows `claude-in-chrome`
  with its status and the Chrome icon.
