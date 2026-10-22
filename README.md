# Zomfy

A comfy desktop for running coding agents. Zomfy keeps chats, terminals and editors for every
project in one window, on this computer, inside WSL, or on SSH hosts, so you steer the work
without juggling windows and contexts.

- **Hosts side by side**: Windows, WSL distros and SSH hosts in one sidebar. A small daemon runs
  next to the files on each host; the app only connects.
- **Chats with Claude Code** (and other ACP agents): fork a chat, continue after an interruption,
  resume automatically once a usage limit resets, keep a markdown memo beside the chat.
- **Side chat**: select text in a reply and ask about it in a side chat without disturbing the
  main conversation.
- **Run commands from the chat**: shell code blocks get a Run button; the output appears under the
  block and reaches the agent only when you attach it.
- **Mentions**: attach a file, another chat or a terminal snapshot from the + menu or by dragging a
  tab onto the composer; the agent reads it on demand.
- **Workspaces**: git worktrees or plain folders, split views, a floating workspace, a manager
  agent across projects, tasks, automations and an agent dashboard.

Zomfy started as a port of [Orca](https://github.com/stablyai/orca)'s interface (MIT); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Install (Windows)

1. Install [Claude Code](https://docs.claude.com/en/docs/claude-code) and sign in once with
   `claude`. Zomfy runs the `claude` CLI on each host, so it uses that login and settings.
2. Download `Zomfy_<version>_x64-setup.exe` from
   [Releases](https://github.com/tsubasa-km/zomfy/releases) and run it.
   The installer is not code-signed yet, so Windows SmartScreen asks first: choose
   **More info → Run anyway**.
3. Optional: WSL distros show up by themselves; add SSH hosts from the sidebar (Zomfy uses your
   system `ssh` and `~/.ssh/config`, and copies its daemon to `~/.acp-harness/bin` on the host).

## How it fits together

```
apps/desktop      Tauri + React UI  ──ws://127.0.0.1:<port>/acp──┐
packages/daemon   Bun ACP agent: Claude Agent SDK behind it  <───┘  (one per host)
packages/protocol The `_harness/*` methods both sides share
```

## Develop

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
