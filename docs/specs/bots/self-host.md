---
type: Spec
title: Running Zomfy Relay on your own machine
description: The same Relay Worker run locally on workerd with durable storage, reached from the internet through a tunnel the person controls, started with `bun run relay:local`.
status: stable
x-zomfy-implementation: done
tags: [bots, mobile, relay, self-host, workerd]
sources:
  - id: workerd
    resource: https://github.com/cloudflare/workerd
    title: workerd, the open-source Workers runtime
  - id: wrangler-dev
    resource: https://developers.cloudflare.com/workers/wrangler/commands/#dev
    title: wrangler dev
  - id: cf-tunnel
    resource: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
    title: Cloudflare Tunnel (cloudflared)
  - id: ts-funnel
    resource: https://tailscale.com/kb/1223/funnel
    title: Tailscale Funnel
  - id: person
    resource: "the person's request of 2026-11-22"
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T12:00:00Z" }
---

# Problem

Zomfy Relay ([connector](connector.md), [phone relay](../mobile/relay.md)) is deployed to the
person's Cloudflare account ([decision](../../decisions/one-relay-worker.md)). Some people would
rather not use Workers at all, or want the relay on a home server they already run. The person asked
for the relay to run on their own machine as well, with the same code.[^person]

# Who it is for

Someone with a computer that stays on (a desktop, a home server, WSL, a small Linux box) on Windows,
macOS or Linux, with Node 20+ and a clone of the repository.

# Behaviour

## Runtime

- The same Worker (`apps/relay/src`, `wrangler.jsonc`) runs locally under **`wrangler dev --local`**,
  which bundles it and runs it in **workerd**, the open-source Workers runtime, through
  Miniflare.[^workerd][^wrangler-dev] `Hub` and `DiscordGateway` are SQLite-backed Durable Objects as
  in Cloudflare; their storage and alarms are kept in `--persist-to` on disk, so registered hosts,
  deliveries, conversations and timers survive restarts.
- Why not a hand-written `workerd` config: it would need its own bundling step and a Cap'n Proto
  config kept in step with `wrangler.jsonc` (classes, SQLite storage, migrations, alarms). Wrangler
  is already the relay's dev dependency and ships workerd for Windows, macOS and Linux (x64 and
  arm64), so the local run uses exactly the runtime the Worker tests use.
- The launcher turns off wrangler's dev-only surfaces: the interactive session, telemetry, and the
  **Local Explorer** (`X_LOCAL_EXPLORER=false`), which would otherwise serve the Durable Objects'
  storage at `/cdn-cgi/local/explorer/api`. Wrangler listens on `127.0.0.1` only, on an internal
  port.
- In front of it the launcher runs a small proxy on the relay's port (default `127.0.0.1:8787`)
  that forwards HTTP and WebSocket upgrades unchanged and answers every `/cdn-cgi/…` path 404, so
  nothing internal to the dev server can be reached through a tunnel. The tunnel points at this
  proxy, and it stays up while wrangler restarts.
- A new variable, **`PUBLIC_URL`**, names the relay's public origin. When it is set the Hub uses it
  for the URLs it hands out (webhook URLs) instead of the origin of the last request, which locally
  may be `http://127.0.0.1:8787`.

## `bun run relay:local`

At the repository root (`bun run --cwd apps/relay local`, which is `node scripts/local.mjs`):

1. Uses the relay home **`~/.zomfy/relay`** (`--dir` or `ZOMFY_RELAY_HOME` to change it):
   `relay.env` (the secrets, the same names as `.dev.vars.example`), `state/` (storage),
   `local.json` (the remembered port, tunnel and public URL), and `cloudflared.token` when a named
   tunnel is used.
2. Makes `relay.env` from `.dev.vars.example` with a new random `SETUP_CODE` the first time, or a new
   code with `--new-setup-code`. Other values the person fills in by editing the file; the
   launcher prints its path. Nothing in it is ever printed except the setup code.
3. Starts the tunnel chosen by `--tunnel` (remembered in `local.json`):
   - `cloudflared` (the default when `cloudflared` is on `PATH`): with `--tunnel-token <token>`
     (stored in `cloudflared.token`, passed to cloudflared through `TUNNEL_TOKEN`, never on the
     command line) it runs the person's **named tunnel**, whose public hostname they set to
     `http://localhost:8787` in the Cloudflare dashboard and give as `--public-url`; without a token
     it starts a **quick tunnel** and reads its `https://….trycloudflare.com` URL.[^cf-tunnel]
   - `tailscale`: runs `tailscale funnel <port>` and takes the URL from `tailscale status --json`
     (`https://<machine>.<tailnet>.ts.net`).[^ts-funnel]
   - `none`: no tunnel; `--public-url` names one the person runs themselves (a reverse proxy, a VPN).
4. Starts wrangler with persistence, the env file and `PUBLIC_URL`; waits for `GET /health` (which
   also starts the Discord Gateway), and prints the local URL, the public URL, the setup code, the
   configured sources, each source's URLs to paste (as `bun run deploy` does), and how to pair.
5. Stays in the foreground and supervises: if wrangler or the tunnel exits it is started again with
   a growing delay (1 s to 30 s); a quick tunnel that comes back with a new URL restarts wrangler
   with it and prints the new URL. Ctrl+C or SIGTERM stops both children and their process trees,
   and nothing else.
6. `--json` prints one JSON object per line (`{"event":"ready","localUrl",…}`, `"tunnel"`,
   `"restart"`, `"stopped"`) instead of the text, for scripts and services; `--dry-run` prints the
   commands without running them.

## Pairing

Zomfy pairs with the **public URL** (Settings → Bots → Relay), because phones are given the paired
URL as their relay route ([pairing](../mobile/pairing.md)). A quick tunnel's URL changes on every
start, so it is for trying the relay out; for daily use the person uses a named Cloudflare tunnel (a
domain on Cloudflare, free) or Tailscale Funnel, whose URLs stay.

## Running it as a service

The README shows a systemd user unit (Linux, WSL with systemd), a launchd agent (macOS) and a
Task Scheduler task at logon (Windows), each running `node scripts/local.mjs --json` in
`apps/relay`.

## Limits

- **The machine must stay on and awake.** While it is off or asleep the relay does not exist: Slack
  and Linear retry for a while and then drop the event, GitHub does not retry (redeliver by hand from
  the app's **Advanced** page), Discord says "This interaction failed" and mentions sent meanwhile
  are missed unless the Gateway session resumes within Discord's window, webhook callers get a
  connection error, and phones cannot reach their hosts. There is **no 24 h queue while it is off**:
  the queue only holds what arrived while the relay ran (a delivery still waits up to 24 h for a
  daemon that is away, as in Cloudflare).
- Run on the same computer as the daemon, the relay gains nothing from the daemon being reachable
  while the computer sleeps; a home server that stays on is the better place for it.
- A quick tunnel's URL changes each start: the source endpoints and Zomfy's pairing must be updated
  each time, and Cloudflare gives quick tunnels no uptime guarantee.
- Tailscale Funnel serves only ports 443, 8443 and 10000 publicly and must be allowed in the
  tailnet's policy.
- `wrangler dev` is a development server: it watches `apps/relay/src` and reloads when the files
  change (for example after `git pull`), and it is updated with the repository's lockfile.

## Discord's Gateway under local workerd

- `DiscordGateway` opens Discord's Gateway with `fetch` and `Upgrade: websocket`, which workerd
  supports outside Cloudflare; its alarm (heartbeat and watchdog) runs from workerd's local alarm
  store, which is on disk with the rest of the state, so after a restart the alarm brings the
  connection back and resumes the stored session. The launcher's first `/health` also starts it.
- Locally an object is never evicted, so the connection simply stays open; the Hub's sockets use
  the same hibernation API, which workerd implements, without being hibernated.
- Fallback if the Gateway cannot connect from the machine (a firewall that blocks WebSockets out):
  slash commands and buttons still come over HTTP interactions; mentions and DMs need the Gateway.
  `/health` shows `discordGateway.state` and `lastError`.

# Non-goals

- A packaged relay inside the desktop installer (see open questions).
- Exposing the relay without a tunnel (port forwarding, TLS on the machine itself); `--tunnel none`
  with `--public-url` lets a person do that on their own.
- Queueing source events while the machine is off.

# Acceptance

- `bun run test` in `apps/relay` also runs `vitest.local.config.ts` (Node):
  - helper tests: arguments and the remembered `local.json`; `relay.env` made once with a random
    setup code and kept afterwards; the quick-tunnel URL read from cloudflared's output; the Funnel
    URL from `tailscale status --json`; wrangler's arguments carry `--persist-to`, `--env-file`,
    `PUBLIC_URL` and `X_LOCAL_EXPLORER=false`;
  - the launcher started for real on `127.0.0.1` in a temporary home: `/health` answers, a host
    registers with the setup code, the launcher is stopped and started again, and the same code is
    refused as used (storage survived the restart); `/cdn-cgi/` paths answer 404;
  - with a fake `cloudflared` on the command line the launcher reads the tunnel URL, points the
    tunnel at the proxy, and reports the public URL;
- a Worker test: `publicOrigin` reads `PUBLIC_URL`, which the Hub's `origin()` prefers to the last
  request's origin.
- The existing workerd tests (Discord Gateway with its alarm, hibernated sockets) keep passing; they
  run on the same runtime as the local relay.
- No real tunnel to the internet is opened by any test.

# Built so far

Built as above: `apps/relay/scripts/local.mjs` with its helpers in `scripts/local-lib.mjs`,
`PUBLIC_URL` and `publicOrigin` in `src/env.ts`, the root script `relay:local`
(`bun run --cwd apps/relay local`, so arguments after `--` reach the launcher), and the README's
"Run it on your own machine". Tests: `test/local/lib.test.mjs` and `test/local/launcher.test.mjs`
under `vitest.local.config.ts`, run by `bun run test` after the workerd suite, and
`test/env.test.ts`.

Checked by hand on Windows: the daemon's `phone-relay.wrangler.test.ts` passes against
`bun run relay:local -- --tunnel none` (the host link and phone sockets through the proxy), and the
launcher leaves no `workerd` process behind when stopped. workerd keeps each object's alarm in the
`_cf_ALARM` table of its `metadata.sqlite` under `state/`. Not tried: a real cloudflared or
Tailscale tunnel, and Discord's real Gateway from a local relay (the Gateway's tests use a fake
Discord in workerd, the same runtime).

# Open questions

1. **Settings → Bots → Relay → "Run on this computer"** (Zomfy starting and stopping the relay and
   the tunnel as child processes, with status). Not built: the installed app has neither wrangler,
   workerd nor the relay's source, so it would need workerd (about 100 MB per platform) and a
   pre-built Worker in the installer, or the path to a clone. `--json` is the interface such a
   button would drive. Recommended: later, once someone runs the local relay for a while.

[^workerd]: workerd on GitHub
[^wrangler-dev]: `wrangler dev` reference
[^cf-tunnel]: Cloudflare Tunnel documentation
[^ts-funnel]: Tailscale Funnel documentation
[^person]: The person's request of 2026-11-22
