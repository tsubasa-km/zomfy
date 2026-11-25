---
type: Spec
title: Direct Codex connection
description: Choose how a host runs Codex chats, through ACP or directly through Codex App Server.
status: stable
x-zomfy-implementation: done
tags: [chat, codex, daemon, desktop]
sources:
  - id: request
    resource: Feature request and approved connection behavior in the Zomfy development conversation on 2026-11-25
    title: Keep both Codex connections selectable
  - id: app-server
    resource: https://learn.chatgpt.com/docs/app-server
    title: Codex App Server protocol
generated: { by: "codex/gpt-6", at: "2026-11-25T02:23:53.591Z" }
---

# Problem

A host with the Codex CLI needs a separate ACP adapter to run a Codex chat. People want to use
the CLI's App Server directly and keep the ACP option for hosts that already use it.[^request]

# Behavior

- The Codex row in the selected host's agent settings offers **ACP** and **Direct (App Server)**.
  ACP is the default for saved settings with no selection. The selection is persisted per host
  and controls Codex chat availability and the next Codex turn that starts there.
- Direct mode finds the host's `codex` and launches `codex app-server` over stdio. It uses the host
  launch environment and existing Codex account, including a configured `CODEX_HOME`. A custom
  ACP command applies in ACP mode. The app identifies which executable is needed in each mode.
- The daemon maps App Server threads, turns, streaming messages, supported attachments, tool
  events, approvals, and non-secret questions to its chat interfaces.[^app-server] Secret
  questions are skipped with a notice. The session registry associates a chat with its Codex
  thread ID.
- An in-flight turn continues on the connection that started it. The next turn opens the
  saved thread on the selected connection. If Direct mode cannot reopen that thread, it
  reports the failure and keeps the ID for retry. Connection selection never triggers an
  automatic retry on the other protocol.
- The initial release covers model and reasoning selection supported by the installed CLI.
  Codex-specific features outside the chat flow can be added separately. Terminal launch,
  Codex sign-in setup, and switching the connection for agents other than Codex are outside
  the scope of this change.

# Acceptance

- A host with only the Codex CLI can start and stop a Direct chat and continue it after a
  restart. Settings without a connection value keep using ACP.
- A Direct turn streams text and tool status, routes approval and question responses, and
  completes or fails without leaving the chat waiting. Stopping a turn ends its pending asks.
- Switching protocols between turns uses the stored thread ID. A failed Direct resume and a
  process exit surface errors without replaying the prompt or creating a replacement thread.
- A source build and isolated browser preview can verify both modes without opening or
  replacing the installed desktop app or its daemon.

# Manual review

Use a browser preview connected to a source-built daemon on a separate loopback port and
`ZOMFY_HOME`. Open **Settings › Agents › Codex**, select **Direct (App Server)**, and send a
message in a fresh Codex chat. Check streaming and Stop. With both transports installed and
using the same Codex account folder, switch to ACP during a turn and verify the next message
continues the same thread. Repeat with the transports reversed.

# Open questions

None.

[^request]: Keep both Codex connections selectable.
[^app-server]: Codex App Server protocol.
