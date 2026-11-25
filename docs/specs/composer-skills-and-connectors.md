---
type: Spec
title: Skills and connectors in the composer
description: The chat composer's `/` menu splits commands from skills, the `+` menu lists skills and connected MCP servers, and an `@mcp:` chip asks the agent to use a server.
status: draft
x-zomfy-implementation: planned
tags: [chat, composer, skills, mcp]
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Why

Skills and MCP servers (connectors) are how a person points an agent at a capability, but today
the composer only knows them by accident: skills sit in the `/` menu mixed with commands, and a
connector can only be named in prose. Files already have a menu and a chip; skills and connectors
should be as easy to reach, from the same places: the `+` menu and a typed symbol.

# Skills

## Telling skills from commands

- `ChatCommand` (packages/protocol, `sessions.ts`) gains an optional `kind`: `command`, `skill` or
  `mcp-prompt`. Absent (an older daemon) reads as before: built-in commands, then the rest.
- The Claude Agent SDK's `SlashCommand` has no such flag: commands, skills and plugin skills come
  as one list, with only `builtin` set. The daemon's catalog probe (`claude-catalog.ts`) asks the
  same probe process for `reloadSkills()`, whose answer lists exactly the skills (from
  `~/.claude/skills`, the project's `.claude/skills`, and plugins' skills, under their
  `plugin:skill` names). A command whose name is in that list is a `skill`.
- A name of the form `mcp__<server>__<prompt>` is an MCP server's prompt: `mcp-prompt`.
- Everything else is a `command` (`builtin` still marks Claude Code's own).
- A turn's init frame names the session's skills too; the catalog's late additions
  (`noteSlashCommands`) are marked from it.
- Other agents (ACP, Codex) bring their own command list; without a `kind` from them, everything
  they list is a command.

## The `/` menu

- Matches are drawn in headed groups, in this order: **Commands** (Claude Code's own first, then
  custom commands), **Skills**, **MCP prompts**. A group with no match is left out; the headings
  show only when more than one group has matches.
- The arrow keys walk the rows in the order drawn.

## Skills in the `+` menu

- The `+` menu gains **Skill**, a submenu with a search box and the session's skills (name and
  description). Picking one puts `/skill-name ` at the start of the message, as choosing it from
  the `/` menu does: a leading `/command` already there is replaced, other text is kept after it.
- The entry shows only where the composer has a command list with at least one skill.

# Connectors

## Which servers

- The `@` menu and the `+` menu offer the chat's MCP servers, read with the same
  `_harness/chatStatus/mcp` request the Session panel's *Connectors* uses, once per chat when
  either menu first needs them, and again whenever the Session panel reads the list.
- Only connected servers are offered. Zomfy's own tools server is left out (it is always there).
- The daemon lists connectors for Claude chats only; for other agents the request fails and the
  entries are hidden. The New thread tab has no chat yet, so it offers none.

## The `@` menu

- Typing `@` lists connectors with the files: with nothing typed after `@`, files first; with a
  query, a connector whose name starts with it comes before files, one whose name merely contains
  it after them. `@mcp:` narrows the list to connectors.
- Each connector row has its icon (the Session panel's `ConnectorIcon`) and "MCP server".

## The `+` menu

- **Connector**, a submenu listing the connected servers with their icons; picking one inserts the
  chip at the caret, like *File in this workspace*. Shown only when there is at least one.

## The chip

- The text form is `@mcp:<server>`, where the name's whitespace and `%` are percent-encoded
  (`claude.ai Google Calendar` → `@mcp:claude.ai%20Google%20Calendar`), so a name with spaces is
  still one word.
- The composer and the transcript draw it as a chip with a plug icon and the server's name; a
  click opens the chat's Session panel.

## On send

- The daemon expands it, so the person's bubble keeps the chip and the agent reads plain words.
  The transcript records the prompt as typed; only the text handed to the agent changes:
  - each `@mcp:<server>` becomes `` `<server>` (MCP server) ``;
  - one line per distinct server is added after the message: "Use the `<server>` MCP server's
    tools for this." For Claude it also names the tools' prefix (`mcp__<normalized name>__`) and
    says to load them with ToolSearch when they are deferred.
- The expansion is a pure function in the daemon (`mcp-mentions.ts`) with unit tests.

## Resources

- Claude Code's own `@server:uri` resource mentions are not listed (optional in the request; left
  out to keep the menu small).

# Strings

UI strings are English in code; their Japanese goes in `apps/desktop/src/i18n/ja/`, appended.

# Acceptance

- In a Claude chat, `/` shows *Commands* and *Skills* headed separately; a skill like `okf-generate`
  sits under *Skills*.
- `+` → *Skill* → a skill puts `/name ` at the start of the message.
- With a connected server, `@` lists it, and so does `+` → *Connector*; picking it shows a chip with
  a plug icon. A failed or signed-out server is not offered.
- Sending `@mcp:server` shows the chip in the bubble, and the agent receives the instruction.
- Unit tests cover the `/` grouping, the `@` ordering, `@mcp:` parsing and encoding, the daemon's
  skill marking and the send-time expansion.
