---
type: Spec
title: Codex and ACP agents follow the thread's permission mode, instructions, moves and titles
description: Zomfy's permission modes, its own instructions, chat moves and thread titles reach Codex (ACP and Direct) and other ACP agents as they reach Claude.
status: stable
x-zomfy-implementation: in-progress
tags: [chat, codex, acp, daemon, desktop, permissions]
sources:
  - id: review
    resource: Read-only review of Zomfy with agents other than Claude, 2026-11-27 (zomfy-provider-review.md)
    title: Features built on the Claude path that do not reach Codex and ACP agents
  - id: codex-acp
    resource: "@agentclientprotocol/codex-acp 2.2.2, src/AgentMode.ts and src/CollaborationModeConfig.ts (bundled in dist/index.js)"
    title: codex-acp session modes
  - id: app-server
    resource: "`codex app-server generate-ts --experimental` from codex-cli 0.164.0 (ThreadStartParams, TurnStartParams, AskForApproval, SandboxMode, McpServerElicitationRequestParams, ThreadNameUpdatedNotification)"
    title: Codex App Server protocol types
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T00:00:00Z" }
---

# Problem

With Codex, the person gets far more approval prompts than the permission mode they picked should
give, and thread titles are not set.[^review] Zomfy's modes (`default`, `acceptEdits`, `plan`,
`auto`, `bypassPermissions`) are sent and stored only for Claude; Codex starts in its own default.
Zomfy's instructions (the Next steps card, the worktree claim rules, the Manager and quick-chat
prompts) go only into Claude's system prompt. A Codex chat cannot move, so `finish_worktree`
leaves its worktree behind. Direct (App Server) declines every MCP elicitation, which includes
Codex asking to run a harness tool.

# Behavior

## Permission modes

- Every chat stores its permission mode (`SessionOptions.permissionMode`), whatever its agent. A
  new thread, a bot, a workflow step and an agent switch store the mode they were given for Codex
  and ACP agents too.
- The daemon applies the mode when the agent's session opens (new, resumed or loaded) and before
  each turn, and at once when the person changes it while the agent runs. A turn never starts in a
  mode other than the stored one.
- **Codex over ACP** (codex-acp)[^codex-acp]: the session's `mode` config option and its
  `collaboration_mode` option. **Codex Direct** (App Server)[^app-server]: `approvalPolicy`,
  `approvalsReviewer` and `sandbox` on `thread/start` and `thread/resume`; `approvalPolicy`,
  `approvalsReviewer`, `sandboxPolicy` and `collaborationMode` on every `turn/start`.

  | Zomfy mode | codex-acp `mode` | codex-acp `collaboration_mode` | App Server `approvalPolicy` | `approvalsReviewer` | `sandbox` |
  |---|---|---|---|---|---|
  | `default` | `read-only` | `default` | `on-request` | `user` | `read-only` |
  | `acceptEdits` | `workspace-write` | `default` | `on-request` | `user` | `workspace-write` |
  | `plan` | `read-only` | `plan` | `on-request` | `user` | `read-only` (+ `collaborationMode: plan`) |
  | `auto` | `agent` (Auto review) | `default` | `on-request` | `auto_review` | `workspace-write` |
  | `bypassPermissions` | `agent-full-access` | `default` | `never` | `user` | `danger-full-access` |

  The App Server columns are the presets codex-acp itself sends for each of its modes, so a Codex
  thread behaves the same over either connection.
- **Other ACP agents**: when the agent advertises a session mode (a `mode` category config option
  or ACP session modes), Zomfy picks the first of its choices whose id matches, in order:

  | Zomfy mode | Agent mode ids tried |
  |---|---|
  | `default` | `default`, `read-only`, `ask`, `manual` |
  | `acceptEdits` | `acceptEdits`, `accept-edits`, `autoEdit`, `auto_edit`, `auto-edit`, `workspace-write` |
  | `plan` | `plan`, `read-only`, `architect` |
  | `auto` | `auto`, `agent`, `autoEdit`, `auto_edit` |
  | `bypassPermissions` | `bypassPermissions`, `yolo`, `agent-full-access`, `full-access`, `danger-full-access` |

  A mode with no match is not offered for that agent. An agent with no session modes keeps its own
  behaviour and shows no permission picker.
- What Zomfy answers itself, on top of the agent's mode: in `bypassPermissions` every approval an
  external agent asks for is allowed (questions still reach the person); the harness's own
  read-only and self-only tools (and a Manager or Lead chat's manager tools) are allowed without a
  card, as Claude's `allowedTools` does.
- When the agent changes its own mode (Codex leaving plan mode), the stored mode follows, by the
  table read backwards.
- A scheduled bot run is pinned to `plan`. For Codex that is read-only with plan collaboration. A
  bot chat whose agent has no mode that `plan` maps to does not run: the turn fails saying the agent
  cannot be held read-only.
- **Desktop**: the New thread composer and the thread's composer show the same permission picker
  for Codex and ACP agents as for Claude, listing only the modes the agent supports (all five for
  Codex). Before the agent's session reports its modes, Codex lists all five and other agents show
  none. The agent's own mode and collaboration-mode chips are hidden where the picker drives them.

## Approvals of MCP tools over Direct

- An MCP elicitation that is Codex asking to run a tool (`_meta.codex_approval_kind:
  "mcp_tool_call"`, a form with no fields) becomes an approval card titled `mcp.<server>.<tool>`,
  with Allow, Allow for this session (when Codex offers it) and Cancel. For the harness's own
  auto-allowed tools it is accepted without a card.
- Other elicitations (forms with fields, URLs) are declined, as before.

## Zomfy's instructions for other agents

- Codex Direct gets them as `developerInstructions` on `thread/start` and `thread/resume`.
- An ACP agent gets them as a text block ahead of the first prompt of each conversation Zomfy opens
  with it (`session/new`), never again in that conversation. The transcript never shows it.
- The text is what Claude's system prompt gets: the Manager prompt for the Manager chat, the
  quick-chat prompt for a quick chat, otherwise the worktree claim rules, the split-work hint, the
  project's tools-off note and the Next steps hint (left out for split helpers and workflow steps).

## Moving a Codex or ACP chat

- `move_chat`, `finish_worktree` and a relocated project move Codex and ACP chats as they move
  Claude chats. The agent's process stops; the next turn starts it in the new folder and reopens
  the same conversation there (codex-acp `session/resume` or `session/load`, App Server
  `thread/resume` with the new `cwd`). An agent that cannot reopen it starts a new conversation
  handed the chat so far, as after any lost conversation. Other agents' conversation ids are
  dropped, as before.

## Titles

- A thread still named `New thread` takes its title from the first 40 characters of the next prompt
  the person (or an agent through the harness tools) sends, for every agent. Harness notes, resumed
  turns and woken turns never name it.
- A title the agent sends (ACP `session_info_update.title`, App Server `thread/name/updated`) replaces
  the thread's title while that title is still `New thread` or the one Zomfy took from the first
  prompt. A thread the person renamed keeps its name.

# Not in scope

Usage-limit and sign-in detection for Codex, workflow data guards for external agents, child
threads' `wrap_up` reports from external agents, Direct's context ring and `/` menu, connectors
for external agents.

# Acceptance

- A Codex chat over ACP, created in `bypassPermissions`, has codex-acp's mode set to
  `agent-full-access` before its first prompt; changing to `plan` sets `read-only` and plan
  collaboration.
- A Codex Direct chat sends the table's `approvalPolicy`, `approvalsReviewer`, `sandbox` on
  `thread/start` and the turn fields on `turn/start`.
- A scheduled Codex bot run starts read-only.
- A Direct MCP tool approval for a harness read-only tool is accepted without a card; one for
  another server's tool is an approval card whose answer reaches Codex.
- Zomfy's instructions reach the first prompt of an ACP conversation once, and Direct's
  `developerInstructions`.
- `finish_worktree` and `move_chat` move a Codex chat; its next turn runs in the new folder on the
  same conversation.
- A Codex chat takes the first-prompt title, then the agent's own title; a renamed chat keeps its
  name.
- Integration tests drive harness-agent's `prompt()` with fake ACP and App Server agents for each of
  the above.

# Open questions

None. Whether every Codex release honours each field is checked only against the generated
protocol types and codex-acp's source; a run against a real Codex account is left to the person.

[^review]: Features built on the Claude path that do not reach Codex and ACP agents.
[^codex-acp]: codex-acp session modes.
[^app-server]: Codex App Server protocol types.
