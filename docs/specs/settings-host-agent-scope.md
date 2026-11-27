---
type: Spec
title: Settings pages scoped to a host and an agent
description: Settings pages whose settings belong to one host and one agent (Secrets & environment, and the Chat agents part of Agents) pick the host and the agent at the top, remember the pair, and show only that pair's settings below.
status: stable
x-zomfy-implementation: in-progress
tags: [desktop, settings, agents, hosts]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T18:00:00Z" }
---

# Problem

Secrets and an agent's launch settings belong to one host and one agent. The pages listed every
connected host in a block of its own and, in Agents, every agent of each host in a fold, so the
person scrolled past the hosts and agents they were not working on, and a page with one host showed
a lone block with a large empty area under it.

# What it does

- **One picker pair** at the top of each such page: the **host** (the connected hosts, by name)
  and the **agent** (every chat agent that host knows, its icon and name; one not installed is
  listed greyed, its state the tooltip).
- Below, only the picked pair's settings.
- The pair is **remembered** (`settingsHostAgent` in the window's settings) and shared by the
  pages, so picking Codex on the Windows host in Agents shows Codex's secrets on that host in
  Secrets. A remembered host that is not connected, or an agent the host does not list, falls back
  to the first connected host and its first ready agent, without overwriting what was remembered.
- With one host, the host picker still shows (it names where the settings go).

## Pages

- **Secrets & environment** ([agent-secrets](agent-secrets.md)): the pair's secrets.
- **Agents › Chat agents**: the picked agent's launch settings on the picked host, open (its state,
  install link, Codex connection, Claude in Chrome, command, environment), and the host's Reload.
  Default agent, Default permissions and the Claude Code command rows above stay as they are.

# Acceptance

- Both pages show the host and agent pickers and only that pair's settings; changing either
  changes what is below at once.
- The pair survives closing and reopening Settings and a restart, and is the same on both pages.
