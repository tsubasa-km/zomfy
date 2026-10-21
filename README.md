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
cd apps/desktop && bun run tauri dev   # builds the daemon binaries, then opens the app
```

The app starts the daemons itself and stops the ones it used when it quits. They run detached from
the app's process tree, so a crash or a dev rebuild of the app leaves them (and their terminals)
running, and the next launch reconnects:

- This computer: `packages/daemon/dist` is copied to `%LOCALAPPDATA%\acp-harness\bin` and run from
  there on 127.0.0.1:7801. A daemon that answers with the same build is reused; a different build
  is replaced.
- WSL: the Linux binary is copied to `~/.acp-harness/bin` in the distro and started through a
  detached `wsl.exe` on 127.0.0.1:7811, which also keeps the distro awake.

`bun run build` in `packages/daemon` only rewrites a binary whose bytes changed, so an unchanged
rebuild never restarts a daemon. Each daemon writes its URL and a random token to
`~/.acp-harness/daemon.json`; connections without that token, or from another origin, are refused.
`bun run daemon` still runs one from source by hand.

Claude runs from the `claude` CLI on PATH (override with `HARNESS_CLAUDE_PATH`), so it uses that
CLI's login and settings.

## Inspect and drive the app (for agents and debugging)

```bash
cd apps/desktop
bun run tauri:debug                                   # app with WebView2 DevTools on 127.0.0.1:9223
bun run cdp screenshot shot.png                       # capture the window
bun run cdp logs 3000                                 # reload and print console output + exceptions
NEW_SESSION=1 AUTO_ALLOW=1 scripts/smoke-ui.sh "Reply with: pong"   # in C:\dev\harness-playground
TARGET=floating NEW_SESSION=1 scripts/smoke-ui.sh "Reply with: pong"       # in the floating workspace
```

In dev builds `window.__harness` (`createSession`, `harnessRequest`, `state`) stands in for the
native folder dialog, which DevTools cannot click.

Tests run against a dedicated repository, `C:\dev\harness-playground`
(`bun packages/daemon/scripts/ensure-playground.ts` creates and registers it), so real projects
are never touched.

## Other entry points

- `bun packages/daemon/src/main.ts --stdio` — ACP over stdio for clients that spawn agents (Zed, Orca).
- `bun packages/daemon/scripts/acp-smoke-client.ts [--ws] "prompt" [cwd]` — drive the agent without a UI.
- `bun run typecheck` — typecheck every package.
