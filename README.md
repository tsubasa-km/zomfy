# acp-harness

An agent-first harness. A daemon runs agents (Claude Code today) behind the Agent Client
Protocol (ACP), and a lightweight Tauri desktop app connects to it over WebSocket.

```
apps/desktop      Tauri + React UI (Orca-style layout)  ──ws://127.0.0.1:7801/acp──┐
packages/daemon   Bun ACP agent: Claude Agent SDK behind it  <───────────────────────┘
```

The daemon is meant to run in each environment (Windows, WSL, SSH host) so agents work next to
their files; the UI only connects.

What works today, following Orca's look and flow:

- Projects (git repos or plain folders) and workspaces. A new workspace is a git worktree at
  `~/acp-harness/workspaces/<repo>/<name>` on branch `<git user>/<name>`.
- Workspace tabs, each a Claude session, with Orca's sidebar statuses and "Waiting for you".
- A floating workspace (Ctrl/Cmd+Alt+A) for work outside any project.

## Run

```bash
bun install
bun run daemon                       # terminal 1: starts the daemon on 127.0.0.1:7801
cd apps/desktop && bun run tauri dev # terminal 2: opens the desktop app
```

The daemon writes its URL and a random token to `~/.acp-harness/daemon.json`; the app reads it.
Connections without that token, or from an origin other than the app, are refused.

Claude runs from the `claude` CLI on PATH (override with `HARNESS_CLAUDE_PATH`), so it uses that
CLI's login and settings.

## Inspect and drive the app (for agents and debugging)

```bash
cd apps/desktop
bun run tauri:debug                                   # app with WebView2 DevTools on 127.0.0.1:9223
bun run cdp screenshot shot.png                       # capture the window
bun run cdp logs 3000                                 # reload and print console output + exceptions
NEW_SESSION=1 AUTO_ALLOW=1 scripts/smoke-ui.sh "Reply with: pong"   # floating workspace
```

In dev builds `window.__harness` (`createSession`, `harnessRequest`, `state`) stands in for the
native folder dialog, which DevTools cannot click.

## Other entry points

- `bun packages/daemon/src/main.ts --stdio` — ACP over stdio for clients that spawn agents (Zed, Orca).
- `bun packages/daemon/scripts/acp-smoke-client.ts [--ws] "prompt" [cwd]` — drive the agent without a UI.
- `bun run typecheck` — typecheck every package.
