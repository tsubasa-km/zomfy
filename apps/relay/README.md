# Zomfy Relay

The Cloudflare Worker each person deploys to their own account: the bots connector and the phone
relay in one Worker with one Durable Object, `Hub`, plus `DiscordGateway`, which holds Discord's
Gateway connection ([decision](../../docs/decisions/one-relay-worker.md),
[connector spec](../../docs/specs/bots/connector.md), [Discord spec](../../docs/specs/bots/sources/discord.md)).

It builds on its own: the contract is vendored into `src/contract/` by `bun run relay:vendor` at the
repository root, so there is no `workspace:*` dependency.

## Deploy

Either way works on the Workers Free plan for one person. Holding the Discord Gateway all day uses
about 11,000 of the free 13,000 GB-s of Durable Object time a day; if Cloudflare reports going over,
move the account to Workers Paid (5 USD a month). `GET /health` shows the Gateway's uptime.

### Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tsubasa-km/zomfy/tree/main/apps/relay)

Cloudflare copies this directory into a repository of yours, creates the Worker and its Durable
Objects, and asks for the secrets in [`.dev.vars.example`](.dev.vars.example). Fill in
`SETUP_CODE` (make one with `openssl rand -hex 16`) and the secrets of the sources you want, from
each source's steps below; leave the rest empty. Then continue with each source's steps (Discord
from step 2).

### `bun run deploy`

From a clone of the repository:

```sh
cd apps/relay
npx wrangler login     # once
bun run deploy         # or npm run deploy
```

It checks that wrangler is signed in, runs `wrangler deploy`, makes a new single-use `SETUP_CODE`
(the first time, or when you ask), asks for the Discord secrets if you want Discord, and prints the
Worker URL, the setup code, the Interactions Endpoint URL and the link that adds the app to your
server. `bun run deploy -- --dry-run` prints the steps without running them.

## Run it on your own machine

The same Worker also runs on a computer of yours, on [workerd](https://github.com/cloudflare/workerd)
(the open-source Workers runtime) through `wrangler dev --local`, with its storage on disk, reached
from the internet through a tunnel you control ([spec](../../docs/specs/bots/self-host.md)). No
Cloudflare Workers account is needed.

**Limits.** The relay is off whenever that machine is off or asleep: there is no 24-hour queue then.
Slack and Linear retry a little and give up, GitHub does not retry, Discord says "This interaction
failed", webhook callers get an error, and phones cannot reach their hosts. A machine that stays on
(a home server, a desktop that does not sleep, WSL on one) suits it; on the same laptop as Zomfy it
gains little.

You need Node 20+, Bun, a clone of this repository with `bun install` run, and one of the tunnels.

### Quick try (Cloudflare quick tunnel)

Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(`winget install Cloudflare.cloudflared`, `brew install cloudflared`, or your distribution's
package), then at the repository root:

```sh
bun run relay:local
```

It makes `~/.zomfy/relay/relay.env` with a new setup code, starts a quick tunnel and the relay, and
prints the public URL (`https://….trycloudflare.com`) and the setup code. In Zomfy: **Settings →
Bots → Relay**, paste that URL and the code, **Pair**. A quick tunnel gets a **new URL every
start**, so use it only to try things out.

### Daily use: a named Cloudflare tunnel

Free, with a stable URL on a domain you have on Cloudflare (no Workers involved):

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**,
   name it `zomfy-relay`, and copy the token from the install command it shows (the long string
   after `--token`). Skip installing it as a service: the launcher runs it.
2. **Public Hostname**: e.g. `relay.example.com`, service **HTTP** `localhost:8787`.
3. Once:

   ```sh
   bun run relay:local -- --tunnel-token <token> --public-url https://relay.example.com
   ```

   The token is kept in `~/.zomfy/relay/cloudflared.token` and the choice in `local.json`, so
   afterwards plain `bun run relay:local` does the same.

### Or: Tailscale Funnel

With Tailscale signed in and [Funnel](https://tailscale.com/kb/1223/funnel) allowed for this machine
in the tailnet's policy:

```sh
bun run relay:local -- --tunnel tailscale
```

The URL is `https://<machine>.<tailnet>.ts.net` and stays the same: the launcher runs
`tailscale funnel 8787`, which serves it on port 443 and forwards to the relay on 127.0.0.1.

### Or: your own

`--tunnel none --public-url https://…` when something else of yours (a reverse proxy, a VPS with
SSH forwarding) forwards that URL to `http://127.0.0.1:8787`.

### Sources and secrets

Put the secrets of the sources you want in `~/.zomfy/relay/relay.env` (the same names as
[`.dev.vars.example`](.dev.vars.example), from each source's steps below), then stop the relay
(Ctrl+C) and start it again; it prints each source's URL to paste, with your public URL in place of
the Worker URL. For Slack, put your public URL in [`slack-manifest.yaml`](slack-manifest.yaml); for
GitHub, make the app by hand from [`github-app-manifest.json`](github-app-manifest.json)'s
permissions and events with webhook URL `<public URL>/github/webhook` (`bun run deploy --github`
writes to Cloudflare, not to `relay.env`). `--new-setup-code` makes a new single-use code for pairing
another computer.

Pair Zomfy with the **public** URL, not `127.0.0.1`: phones are given the paired URL as their relay
route. Storage is in `~/.zomfy/relay/state` (`--dir` or `ZOMFY_RELAY_HOME` moves the whole home);
deleting it forgets every paired host. The launcher keeps the Local Explorer of `wrangler dev` off
and answers `/cdn-cgi/…` with 404, so nothing but the relay's own routes is reachable through the
tunnel. If wrangler or the tunnel exits it is started again; a quick tunnel that comes back with a
new URL prints it.

### Keep it running

`--json` prints one JSON line per event (`ready`, `tunnel`, `restart`, `stopped`) and stops on a
`stop` line on stdin; run it from `apps/relay` so the service needs no Bun:

- **Linux / WSL (systemd)**: `~/.config/systemd/user/zomfy-relay.service` with
  `WorkingDirectory=<clone>/apps/relay`, `ExecStart=/usr/bin/node scripts/local.mjs --json`,
  `Restart=on-failure`; then `systemctl --user enable --now zomfy-relay` and
  `loginctl enable-linger $USER` so it runs while you are logged out.
- **macOS (launchd)**: a `~/Library/LaunchAgents/dev.zomfy.relay.plist` with `ProgramArguments`
  `node scripts/local.mjs --json`, `WorkingDirectory` `<clone>/apps/relay`, `RunAtLoad` and
  `KeepAlive` true; `launchctl load` it.
- **Windows**: `schtasks /create /tn "Zomfy Relay" /sc onlogon /tr "cmd /c cd /d <clone>\apps\relay && node scripts\local.mjs --json >> %USERPROFILE%\.zomfy\relay\relay.log 2>&1"`,
  and turn off sleep in **Settings → System → Power**.

`wrangler dev` reloads when `apps/relay/src` changes, so a `git pull` takes effect by itself.

### Discord on your own machine

The Gateway object runs as it does in Cloudflare: it opens Discord's Gateway from your machine, its
heartbeat alarm is stored with the rest of the state, and after a restart it resumes the session
(the launcher's first `/health` starts it). If a firewall blocks outgoing WebSockets, `/ask` and
buttons still work (they come over HTTPS); mentions and DMs need the Gateway. `<public URL>/health`
shows `discordGateway.state` and `lastError`.

## Discord

1. At [discord.com/developers/applications](https://discord.com/developers/applications) →
   **New Application** ("Zomfy"). Copy **Application ID** and **Public Key** from General
   Information. On **Bot**: **Reset Token** and copy it, and turn on **Message Content Intent**
   (free for bots in fewer than 100 servers). Give these to `bun run deploy` (or the button).
2. **General Information → Interactions Endpoint URL**: `<worker URL>/discord/interactions`, then
   **Save** (Discord checks it with a signed PING the Worker answers).
3. Add the app to your server with the link `bun run deploy` printed, or **OAuth2 → URL Generator**:
   scopes `bot` and `applications.commands`; permissions View Channels, Send Messages, Send Messages
   in Threads, Create Public Threads, Read Message History, Add Reactions, Embed Links, Attach Files.
4. Open `<worker URL>/health` once: `discordGateway.state` should be `ready`. The Worker registers
   `/ask` and the message command **Ask bot** when the Gateway first connects.
5. In Zomfy: **Settings → Bots → Relay**, paste the Worker URL and the setup code, **Pair**. For each
   bot, **Who can ask → Discord**: your own user id (Discord **Settings → Advanced → Developer
   Mode**, then right-click yourself → **Copy User ID**) as owner, and members the same way.

Then `@Zomfy fix the typo in README` in a channel opens a thread with a status and a Stop button;
`@Zomfy reviewer …` names a bot by handle, otherwise the default bot answers. A DM to the app is a
conversation of its own until you write `new`.

## Slack

One Slack app serves every bot ([spec](../../docs/specs/bots/sources/slack.md)); bots are named by
handle (`@Zomfy reviewer …`).

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From a manifest**, pick the
   workspace, and paste [`slack-manifest.yaml`](slack-manifest.yaml) with your Worker URL in place
   of `https://YOUR-WORKER.workers.dev` (`bun run deploy` prints it filled in). Nothing else in it
   needs editing.
2. **Install to Workspace** (an admin may have to approve). Copy **OAuth & Permissions → Bot User
   OAuth Token** (`xoxb-…`) and **Basic Information → App Credentials → Signing Secret**, and give
   them to `bun run deploy` (or `wrangler secret put SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`).
3. Back in the app: **Event Subscriptions** shows the Request URL `<worker URL>/slack/events`; press
   **Retry** if Slack checked it before the secrets were set. **Interactivity** is
   `<worker URL>/slack/interactivity`.
4. Invite the app to the channels it should hear (`/invite @Zomfy`); a DM to the app works anywhere.
5. In Zomfy, each bot's **Who can ask → Slack**: your member id (your profile → **⋯** → **Copy member
   ID**) as owner; members the same way.

Then `@Zomfy fix the typo in README` in a channel answers in that message's thread, with a status
line and a **Stop** button; questions and approvals come as buttons. A bare `@Zomfy` takes your own
last messages before it as the request.

## GitHub

Your own GitHub App ([spec](../../docs/specs/bots/sources/github.md)); people ask with
`@<app-slug> <handle> …` on issues and pull requests.

1. `bun run deploy --github` (or answer **y** to GitHub in `bun run deploy`): give the app a name
   that is free on GitHub (e.g. `zomfy-bots-<you>`) and, if an organization should own it, its
   login. Your browser opens GitHub's **Create GitHub App** page filled in from
   [`github-app-manifest.json`](github-app-manifest.json) (webhook URL, permissions, events); press
   **Create**. GitHub sends the browser back to the script on your computer, which stores
   `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` as
   Worker secrets.
2. **Install** the app on the repositories it should hear (the link the script prints, or the app's
   page → **Install App**); an organization owner may have to approve.
3. In Zomfy, each bot's **Who can ask → GitHub**: your login as owner; members by login.

The app may read issues, pull requests, checks, contents, Actions, deployments and security
alerts, and write issues and pull requests. It answers in comments (review notes as one review),
shows 👀 while it works, asks questions as numbered comments (reply with the number), and
leaves approvals to Zomfy. A failed check on a pull request you opened wakes the worker on that
branch. Code work (pushes, new pull requests) uses your own `gh` sign-in on the computer, never the
app.

## Linear

Your own Linear app ([spec](../../docs/specs/bots/sources/linear.md)); people ask with
`@Zomfy <handle> …` in a comment or description, or by adding the label `bot:<handle>` to an issue.

1. Linear → **Settings → API → OAuth applications → New**: name it "Zomfy", any callback URL (the
   Worker URL will do), and turn on **Client credentials**. Copy the client id and secret. (Or,
   just for yourself: **Settings → Security & access → Personal API keys**; comments then come from
   you, with an "asked by" line for others.)
2. **Settings → API → Webhooks → New**: URL `<worker URL>/linear/webhook`, resources **Issues**,
   **Comments** and **Issue labels**; copy the signing secret.
3. `bun run deploy --linear` asks for these and stores them (`LINEAR_CLIENT_ID`,
   `LINEAR_CLIENT_SECRET` or `LINEAR_ACCESS_TOKEN`, and `LINEAR_WEBHOOK_SECRET`). With the app, the
   Worker gets its own 30-day app token from Linear and renews it by itself.
4. In Zomfy, each bot's **Who can ask → Linear**: pick yourself as owner, and members, from the list
   the relay reads.

The bot answers with an "On it…" comment that shows its progress and becomes the answer;
questions are numbered comments you answer by replying; approvals are answered in Zomfy.

## Webhooks

Any system can wake a bot with one HTTP call ([spec](../../docs/specs/bots/sources/webhooks.md));
nothing needs setting up in Cloudflare. In Zomfy, a bot → **New trigger → Webhook** makes the hook
and shows its URL and key once. Callers send

```sh
curl -X POST <worker URL>/hooks/<hookId> -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"level":"error"}'
```

or put the key in the path (`<worker URL>/hooks/<hookId>/<key>`) when they cannot set headers. A
hook can also check the sender's own signature (Standard Webhooks, GitHub, Sentry, Linear,
PagerDuty, Stripe). The answer is `{callId, status}` with `queued`, `ignored` (filters),
`duplicate` or `paused`; 401 is a bad key or signature, 413 a body over 1 MiB, 429 more than the
hook's runs for the hour (200 at most, 300 for the deployment). Bodies are kept at most 7 days,
without the key or credential headers.

## Phones

The Android app reaches your computer through the same Worker when it is away from your Wi-Fi and
tailnet ([spec](../../docs/specs/mobile/relay.md)). Nothing needs setting up in Cloudflare: once
Zomfy is paired with the relay (Settings → Bots → Relay), Settings → Devices → **Pair a phone**
lists the relay as the last route, and phones paired before that pick it up when you pair them
again. The relay only splices end-to-end encrypted frames; it keeps each phone's public key and
nothing it says.

## Develop

```sh
bun run test        # Worker tests in workerd (@cloudflare/vitest-plugin), with a fake Discord,
                    # then the local launcher's tests in Node (vitest.local.config.ts)
cp .dev.vars.example .dev.vars   # put a made-up SETUP_CODE in it; leave Discord empty
bun run dev         # wrangler dev
bun scripts/fake-daemon.ts http://127.0.0.1:8787 <that setup code>
```

Routes: `GET /health`, `POST /v1/hosts/register`, `POST /v1/hosts/invite`, the daemon's link
`GET /v1/host`, `POST /discord/interactions`, `POST /slack/events` and `/slack/interactivity`,
`POST /github/webhook`, `POST /linear/webhook` (each source's routes answer 404 until its secrets
are set), and
`POST /hooks/<hookId>` for webhooks, and a phone's socket `GET /v1/device/<hostId>/ws`. The daemon's
end-to-end check against `wrangler dev` is `packages/daemon/src/phone-relay.wrangler.test.ts`
(its header says how to run it). Tests reach fake Slack, GitHub and
Linear APIs (`test/fake-apis.mjs`) through the `SOURCES_TRANSPORT` binding.
