# Research: a phone app for Zomfy

Status: research, 2026-11-21. No product code was changed.

Question: Zomfy needs a phone app for watching and steering its agents. Should it copy the **Orca
mobile app** ([stablyai/orca](https://github.com/stablyai/orca), `mobile/` + `cloud/`, MIT) or
**T3 Code**'s mobile app ([pingdotgg/t3code](https://github.com/pingdotgg/t3code), `apps/mobile` +
`infra/relay`, MIT)? And how should it reach the daemon, given that we also want a self-hosted
Cloudflare relay for chat bots?

Sources are linked inline. Orca paths are relative to
`https://github.com/stablyai/orca/blob/main/`, T3 Code paths to
`https://github.com/pingdotgg/t3code/blob/main/`, and Zomfy paths to this repo. Store numbers come
from Apple's iTunes lookup API (US storefront) and the Google Play listing pages, read on
2026-11-21. GitHub numbers come from the GitHub API on the same day.

## TL;DR

- **Both apps are the same kind of product:** a native Expo / React Native remote control for a
  desktop that stays the source of truth. Both pair with a QR code, chat with many agents, show
  terminals, answer approvals and questions, create worktrees, and send push notifications through
  the vendor's cloud.
- **T3 Code's app is better regarded.** It has 4.90 from 247 ratings on iOS (US) and 4.9 from 167
  ratings with 50K+ downloads on Google Play. Orca has 4.67 from 82 and 5.0 from 41 with 5K+.
  T3's reviews are almost all 5-star and several say it beats the official Claude and Codex apps.
  Orca's reviews mention lost pairing, bugs after updates and "Mobile App feels like second
  thought".
- **The two architectures differ in one important way.** T3 tries a list of direct routes first
  (LAN, Tailscale, public URL, SSH), and its hosted relay only bootstraps a Cloudflare Tunnel; the
  relay is not in the data path. Orca uses LAN direct or a relay that splices end-to-end-encrypted
  frames between the phone and the desktop. Push needs the vendor cloud in both.
- **Recommendation: a mix.** Copy **T3 Code's client design**: the Expo app, an ordered route
  list, one-time pairing links with scopes, and the offline queue. Copy **Orca's relay design**:
  an outbound WebSocket from each side, end-to-end encryption, and the relay only splicing
  ciphertext. Rebuild that relay as **one self-hosted Cloudflare Worker with Durable Objects**,
  which also carries the chat-bot connector and sends push. The phone speaks **ACP plus Zomfy's
  `_` extensions** to the daemon, so `packages/protocol` is shared and no new protocol is invented.

## 1. Feature comparison

| Feature | Orca mobile ("Orca IDE") | T3 Code mobile ("T3 Code - Remote Claude & more") |
|---|---|---|
| What it is | iOS/Android "remote control" for a running desktop Orca, labelled Beta; the desktop is the source of truth (`docs/site/content/docs/mobile.mdx`) | Native Expo app; "The phone is a remote. Your computer does the work and needs to stay on." (`docs/user/faq.md`). A hosted web client at app.t3.codes is the alternative (`docs/user/remote-access.md`) |
| Chat with agents | Transcript view of desktop sessions for claude, openclaude, codex, grok, omp, opencode, zcode (`src/shared/native-chat/native-chat-agent-support.ts`). It is built by **parsing agent transcripts and driving the PTY**, not ACP. Streams over `nativeChat.subscribe`. Composer has `@` files, `/` commands, model pill, images, voice, quick commands | All host providers: Codex, Claude Code, Cursor, OpenCode, Grok, Kiro, ACP Registry agents and more (`docs/user/install.md#providers`). Subagents and side chats (`docs/user/thread-sidebar.md`). Dictation (`docs/user/composer.md`) |
| Terminals | View and type. xterm.js 6.1-beta with WebGL in a WebView (`mobile/src/terminal/webview`), scrollback hydration, "Live" per-key mode, key row, pinch zoom (`terminal.*` RPCs) | Native terminal module (`apps/mobile/modules/t3-terminal`, `src/features/terminal/NativeTerminalSurface.tsx`); long-press to paste (`docs/user/terminal.md`) |
| Approvals and questions | Permission and Question cards in chat (#46063); orchestration approvals (`orchestration.approvalAnswer`); quick replies. For Claude, Codex and OpenCode, answers to Ask prompts are sent as keystrokes | `PendingApprovalCard.tsx`, `ChildThreadApprovals.tsx`, question cards with photo and file attachments (`docs/user/question-attachments.md`); four permission modes (`docs/user/permission-modes.md`) |
| Notifications and push | Native APNs/FCM. The **desktop** sends pushes through the hosted gateway `push.onorca.dev` (`src/main/runtime/push/push-gateway-origin.ts`, `cloud/apps/push`). No account is needed, but the gateway sees titles and bodies | Push when an agent finishes, fails, needs approval or asks; iOS Live Activities, widget, Android Live Updates (`docs/user/mobile-notifications.md`). **"Background delivery requires T3 Connect; a direct or Tailscale connection alone does not enable push notifications."** |
| Worktree / project navigation | Many hosts in one list; per-host routes for session, files, source control, review, PR, history, tasks, automations (`mobile/app/h/[hostId]/`) | Projects, threads, worktree setup card, PRs, issues, diffs and review, files, usage (`apps/mobile/src/features/`) |
| New session / task from the phone | New worktree (Smart / GitHub / Linear / GitLab / Branch modes), new terminal or agent tab, automations, stage/commit/push/merge. Cannot add projects yet ([#41686](https://github.com/stablyai/orca/issues/41686)) | New thread in a project or "No project"; worktree setup |
| Offline behaviour | Reconnects when the desktop comes back; Retry / Re-pair banner; TanStack Query persistence. iOS backgrounding drops the link ([#13354](https://github.com/stablyai/orca/issues/13354)) | Drafts and queued messages, attachments included, survive restarts and send on reconnect (`docs/user/composer.md`). Cached projections readable offline. Jittered backoff capped at 5 min; re-probe on foreground or network change (`docs/internals/connection-runtime.md`) |
| Pairing / connection | Desktop shows a QR code with `orca://pair?code=<offer>`. The offer holds the LAN endpoint (`ws://…:6768`), a device token, a pinned X25519 key, and an optional relay invite that expires in 10 min or less (`src/shared/remote-runtime/pairing/mobile-relay-pairing-offer.ts`). The device stays authorized until revoked. **Relay mode requires an Orca account** | `t3 pair` prints a URL and QR code (`https://host/#token=<code>`). The link is one-time, carries scopes (`terminal:operate`, `orchestration:operate`, …) and is DPoP-bound; the session renews up to 30 days (`docs/internals/environment-auth.md`). Routes: LAN, Tailscale, VPN, public URL, SSH, T3 Connect, tried in order (`docs/user/remote-access.md`) |
| iOS / Android | [App Store id6766130217](https://apps.apple.com/us/app/orca-ide/id6766130217) (since 2026-05-07, iPad supported); [Google Play `dev.orca.app`](https://play.google.com/store/apps/details?id=dev.orca.app); APKs as `android-v*` GitHub pre-releases | App Store id6787819824 (since 2026-07-29); Google Play `com.t3tools.t3code`; TestFlight by invite; `android-beta-*` APK releases |
| Extras | Browser screencast, agent account switching and usage | Live view of the host's iOS Simulator or Android Emulator (`docs/user/devices.md`); host browser tabs streamed to the phone; "Open on this device" preview tunnel |

## 2. Reception

### Store ratings (2026-11-21)

| | Orca IDE | T3 Code |
|---|---|---|
| App Store US | **4.67 from 82 ratings** (GB 4.83 / 12, JP 4.68 / 25); v0.0.65, updated 2026-11-17 | **4.90 from 247 ratings** (GB 4.92 / 36, JP 4.69 / 13); v2.3.0, updated 2026-11-10 |
| Google Play | **5.0 from 41 ratings, 5K+ downloads**, updated 2026-11-15. The listing looks new: an earlier issue asked for it ([#25705](https://github.com/stablyai/orca/issues/25705), 2026-10-05) | **4.9 from 167 ratings, 50K+ downloads**, updated 2026-11-10 |
| Written US App Store reviews (RSS feed) | 23: 11× 5★, 6× 4★, 4× 3★, 1× 2★, 1× 1★ | 49: 46× 5★, 1× 4★, 1× 3★, 1× 1★ |

App Store review quotes (US feed):

- Orca, 2026-10-12, 5★: "the best remote access tool to control and maintain AI agents. Auto
  reconnects, fast and easy setup".
- Orca, 2026-10-17, 4★, "Mobile App feels like second thought": "I love Orca - don't get me wrong
  there…".
- Orca, 2026-11-09, 2★, "keeps loosing pairing": "it keep dropping the pairing when i really need it
  (away from my laptop) and requires being back at it to pair it again".
- Orca, 2026-10-27, 3★: "Buggy mess but getting better."
- T3, 2026-11-10, 5★, "What the Codex app should have been": "the snappiest agentic workflow client
  I've ever used".
- T3, 2026-10-21, 5★: "Tried Claude and codex mobile apps but this is much, much better".
- T3, 2026-07-31, 5★: "a small team that's not charging for this app just shipped the best mobile
  coding experience on the market".
- T3, 2026-11-05, 1★: "Same thing as Paseo basically. Nothing special."
- T3, 2026-08-26, 3★: "the current 1.04 version is really slow and often requires me to force quit
  the app".

### GitHub

| | stablyai/orca | pingdotgg/t3code |
|---|---|---|
| Stars / forks | 131,463 / 8,356 (created 2026-03-17) | 68,632 / 11,794 (created 2026-02-08) |
| Mobile history | `mobile/` started 2026-05-04 ("feat(mobile): Expo companion app [beta] (#1245)"); about 2,591 commits since | `apps/mobile`; many `fix(mobile)` PRs in v0.1.11 (2026-11-20) |
| Notable mobile issues | Relay pairing fails `relay_control_not_active` ([#11714](https://github.com/stablyai/orca/issues/11714), open, 18 comments); iOS disconnects in background over Tailscale ([#13354](https://github.com/stablyai/orca/issues/13354)); lost events while backgrounded ([#8129](https://github.com/stablyai/orca/issues/8129)); iOS slow ([#24303](https://github.com/stablyai/orca/issues/24303)); app bundle re-downloaded on every host switch ([#44682](https://github.com/stablyai/orca/issues/44682)) | Pairs but WebSocket fails ([#5093](https://github.com/pingdotgg/t3code/issues/5093), launch week); can't reach relays ([#5031](https://github.com/pingdotgg/t3code/issues/5031)); T3 Connect relay 504s ([#16810](https://github.com/pingdotgg/t3code/issues/16810), 54 comments); 30-day pairing expiry silently falls back to T3 Connect ([#33183](https://github.com/pingdotgg/t3code/issues/33183)); Live Activity does not reappear ([#39900](https://github.com/pingdotgg/t3code/issues/39900)) |

Orca's stars are for the whole desktop product, so they say little about the phone app. Issue
trackers in both repos hold bug reports and requests, not praise.

### Hacker News, YouTube, blogs

- Neither app had its own large HN story. Orca's Show HN "Open Source 'Conductor + Ghostty'"
  (2026-03-27) got [21 points, 10 comments](https://news.ycombinator.com/item?id=47549197).
- HN comments on Orca: "It does super well at letting me remote in across 3 computers and phone"
  ([item 50412665](https://news.ycombinator.com/item?id=50412665), 2026-11-08) and "Orca has a lot of
  UI bugs, buttons that don't work" ([item 50371064](https://news.ycombinator.com/item?id=50371064),
  2026-11-04).
- HN comments on T3: "Really impressed with the desktop app and the mobile app experience"
  ([item 49298335](https://news.ycombinator.com/item?id=49298335), 2026-08-14) and "Mobile app that
  works well" ([item 50412340](https://news.ycombinator.com/item?id=50412340), 2026-11-08).
- YouTube: Theo's "T3 Code broke me" (2026-10-29) had about 478K views; it covers remote and mobile
  access. "Exploring T3 Code: … + Mobile App" (2026-08-10) had about 16.6K. Orca's own "Orca Product
  Hunt Launch" had about 3.7K; no Orca video was specifically about mobile. A head-to-head, "I
  Tested Orca vs T3 Code (Not Even Close)" (2026-10-29, about 67K views), exists; we did not read
  its transcript, so its verdict is unknown.
- A blog (smartscope.blog) reported that public T3 store builds could not reach V2 servers for a
  while, so users needed TestFlight or beta builds.

### Missing data

- **Reddit:** not checked. Both the JSON API and search were blocked from this environment.
- **X/Twitter:** no original posts could be fetched. Search snippets of mirrors say T3 mobile early
  access went to a "small wave of testers" in July 2026, but there are no engagement numbers.
- **Product Hunt:** no page found for either app's mobile launch.
- **Play Store** release dates are not shown on the listings.

### Verdict

**T3 Code's app is better regarded**, on every number we could get: higher ratings with about 3×
the ratings on iOS, 10× the Play downloads, almost no critical reviews, and explicit comparisons in
its favour against the official Claude and Codex apps. Orca's app is liked as an extra for a
desktop people already love, but its reviews and issues keep coming back to pairing and relay
reliability and backgrounding. Both share the hardest problems: keeping a link alive on iOS, and
push depending on the vendor's cloud.

## 3. Architecture

### Orca

- **App:** Expo ~58, React Native 0.88, React 19.3 (new architecture), expo-router, TanStack Query
  with persistence, zod, i18next (ja included), expo-secure-store, expo-camera
  (`mobile/package.json`).
- **Terminal:** xterm.js in `react-native-webview`, plus a custom native web-shell module.
- **UI delivery:** the paired desktop can serve the mobile web bundle over the pairing link; the
  bundle is hash-checked but not separately signed
  (`src/main/runtime/rpc/methods/mobile-delivery/mobile-web-bundle.ts`). This lets the phone UI match
  the desktop version without a store update, but it is also the cause of #44682.
- **Transport:**
  - LAN: a WebSocket RPC server in Electron on port 6768. ATS exceptions allow Tailscale
    (`mobile/app.json`). No account is needed.
  - Relay: the phone and the desktop both dial **outbound** WSS to a relay "cell" chosen by a
    "director". The cell splices frames (`cloud/README.md`). Production is Node (Hono, `ws`,
    Postgres, jose) in one image with the roles `director`, `cell` or `combined`
    (`cloud/apps/relay/src/config.ts`), apparently on GCP Cloud Run (inferred from the README and GCP
    identity code). `cloud/apps/relay-edge` is a **Cloudflare Workers + Durable Objects** port
    (HostRelay, SpliceRelay, UserHosts DOs, Hyperdrive). It is local/test-only today.
- **Encryption:** NaCl box over X25519 (tweetnacl). v2 adds an HKDF-SHA256 key schedule with
  directional keys bound to the handshake transcript
  (`src/shared/remote-runtime/e2ee/paired-e2ee-v2-key-schedule.ts`). The relay sees only ciphertext.
- **Auth:** device token plus a pinned desktop key from the QR code. The desktop authenticates to
  the relay with an ES256 JWT from `login.onorca.dev`, an auth server that is **not open source**.
- **Wire protocol:** JSON RPC inside the encrypted channel, in namespaces like `terminal.*`,
  `nativeChat.*`, `worktree.*`, `git.*`, `orchestration.*`. The routing table doubles as the
  allowlist (`src/main/runtime/rpc/server/runtime-rpc-mobile-method-routing.ts`).
- **Push:** the desktop proves its relay key to the push gateway, registers each phone's native
  token, and asks the gateway to send through APNs or FCM (`cloud/apps/push/src/providers/*`).
- **Self-hosting:** the relay and push code is MIT and runs locally in `combined` mode, but
  production deploy config is private (`stablyai/orca-cloud`), and you would need your own JWT
  issuer, APNs key, FCM project and your own iOS build.

### T3 Code

- **App:** Expo 58, React Native 0.88, Effect, Clerk, expo-notifications, expo-camera, expo-widgets,
  plus many custom native modules (`t3-terminal`, `t3-web-socket`, `t3-agent-notifications`, …).
  Expo Go is not supported; it needs a dev client (`apps/mobile/README.md`).
- **Shared client runtime:** web, desktop and mobile share `packages/client-runtime`, with one
  connection owner per environment (driver, supervisor, registry) and an Effect RPC session over
  WebSocket. Schemas are Effect Schema in `packages/contracts` (`docs/internals/connection-runtime.md`).
- **Transport:** a saved environment has an **ordered list of routes**; the client uses the first that
  answers and returns to a preferred one when it recovers (`packages/client-runtime/src/connection/driver.ts`).
  The server listens on all interfaces but accepts only loopback, private and tailnet peers
  (`docs/internals/remote.md`). Tailscale HTTPS via `t3 serve --tailscale-serve`.
- **T3 Connect:** a Cloudflare Worker with Clerk identity, managed Cloudflare Tunnels per environment,
  and PlanetScale Postgres (`infra/relay/README.md`, `docs/internals/t3-connect.md`). **The relay is
  not in the data path:** it asks the environment to mint a one-time credential bound to the client's
  DPoP key, and the client then talks to the tunnel hostname directly. Free accounts can link 3
  machines.
- **Push:** the host server publishes agent activity (`apps/server/src/relay/AgentAwarenessRelay.ts`)
  and the relay delivers through APNs or FCM (`infra/relay/src/agentActivity/`).
- **Self-hosting:** direct, Tailscale and SSH pairing need no hosted service, and T3 Connect is off in
  a fresh clone (`docs/operations/connect-setup.md`). Self-hosting T3 Connect needs your own Clerk,
  Cloudflare tunnels/DNS, Postgres, APNs/FCM keys and app builds.

### Where Zomfy stands today

- The daemon listens on **127.0.0.1 only**, with a random token **regenerated at every start**. The
  token is sent as a WebSocket subprotocol, and the server checks an `Origin` allowlist
  ([websocket-server.ts](../../packages/daemon/src/websocket-server.ts)). A phone can neither
  reach it nor keep a credential.
- The wire is **ACP** (`@agentclientprotocol/sdk`) plus `_`-prefixed harness extensions composed in
  [packages/protocol/src/index.ts](../../packages/protocol/src/index.ts): sessions, terminals,
  workspaces, git, todos, workflows and more. Everything a phone needs already exists as methods.
- Remote hosts are already supported **over SSH**: the desktop runs the daemon bound to the remote's
  127.0.0.1 and reaches it with `ssh -W` ([ssh_daemon.rs](../../apps/desktop/src-tauri/src/ssh_daemon.rs)).
- Permission requests go to **one window at a time**: the window that started the turn, or for
  automations the newest window, trying each in turn, then denied after 5 minutes
  ([harness-agent.ts](../../packages/daemon/src/harness-agent.ts), `askAnyClient`). A phone needs
  the request **sent to every client at once, with the first answer winning**, and a push.
- Desktop notifications use `tauri-plugin-notification`; there is no push path.

### What maps onto Zomfy

| Need | Take from | Zomfy form |
|---|---|---|
| Wire protocol | Neither. Orca's RPC namespaces and T3's Effect RPC both play the role ACP already plays | The phone is **an ACP client** using the same `packages/protocol` types as the desktop. A phone-specific allowlist of methods, like Orca's routing table, limits what a device may call |
| Device credential | T3 (one-time, scoped pairing link, renewable session) and Orca (device token, revocable from the desktop, pinned host key) | A persistent **device record** in the harness home: id, name, scopes, public key. The per-start daemon token stays for local windows |
| Reaching the daemon | T3's ordered routes | Routes: LAN (opt-in listener), Tailscale, and **our relay**. SSH hosts are reached through the desktop host's daemon, or through their own relay link |
| Relay | Orca's splice + E2EE design, on Orca's `relay-edge` shape (Workers + Durable Objects) | One self-hosted Worker: a Durable Object per host that holds the daemon's outbound socket and splices phone sockets onto it. Payloads stay end-to-end encrypted with X25519 + HKDF, as in Orca v2 |
| Push | Orca (the host decides to send; the gateway only delivers) | The daemon tells the relay "notify device X: approval needed in session Y". The Worker sends through FCM HTTP v1 / APNs, or Expo's push service in the MVP. Keep notification bodies short and generic, since the relay sees them |
| Offline | T3 (queued messages, cached projections, backoff + re-probe) | Queue prompts on the phone; replay `session/load` history on reconnect |
| Terminal | Orca (xterm.js in a WebView; also works in Expo Go) | Same, fed by the existing terminal extension methods |

### One relay for the phone and the chat bots

The same person wants a self-hosted Cloudflare relay/connector for chat bots (Discord, Slack and so
on). One Worker can do both, because both are the same problem: **something on the internet must
reach a daemon behind NAT that only dials out.**

```
            ┌──────────────── Cloudflare (your account) ────────────────┐
 phone ─WSS─┤ Worker: /pair, /device/:id/ws   ──▶ HostDO(host id) ◀──WSS── zomfy daemon
            │ Worker: /bots/discord|slack/...  ──▶ HostDO(host id)       │   (outbound only)
 Discord/ ──┤ (verify signature, map to host)                            │
 Slack      │ Worker → FCM / APNs / Expo push (asked by the daemon)      │
            └────────────────────────────────────────────────────────────┘
```

- **Shared:** the host's single outbound WebSocket (a hibernatable WebSocket in its Durable Object),
  host registration with a host key, reconnect handling, the push sender, and one deployment
  (`wrangler deploy`, free tier for one person).
- **Kept separate:** **phone traffic is end-to-end encrypted** and the relay only splices it. Bot
  traffic **cannot be**, because Discord and Slack send plaintext webhooks to the Worker. So the
  Worker verifies the platform signature and forwards a small, typed bot event on its own channel,
  and the daemon treats bot input like a prompt from a lower-trust client, with its own scopes.
- **Scope this as one product:** "Zomfy Relay". Phase 2 below builds it for the phone; the bots
  connector then adds routes to the same Worker and Durable Object instead of being a second
  service.

## 4. Recommendation

**Build a Zomfy app of our own on T3 Code's client design and Orca's relay design, speaking ACP.**

- Don't fork either app. Both are large and tied to their own protocols: Orca parses transcripts and
  drives PTYs, and T3 uses Effect RPC and Clerk. Zomfy's advantage is that ACP already describes
  chat, tool calls, permissions and plans as structured data, so a thin client goes far.
- Copy freely within MIT, and credit it in `THIRD_PARTY_NOTICES.md`. Worth copying: Orca's pairing
  offer format, E2EE v2 key schedule, relay splice contract (`cloud/packages/relay-contract`) and
  xterm WebView bridge; T3's route list and connection supervisor logic, its pairing link and scope
  model, and its offline queue.
- Avoid what reviews and issues punish: pairing that silently expires (T3 #33183, Orca's 2★ review),
  links that die in the background (Orca #13354), and UI bundles downloaded from the host (Orca
  #44682).

### Tech stack

- **App:** Expo (current SDK) + React Native + TypeScript, expo-router, TanStack Query with
  persistence, expo-secure-store for device keys, expo-camera for QR, expo-notifications, and
  `react-native-webview` + xterm.js for terminals. Import `packages/protocol` and the ACP SDK's
  types as a workspace package, so the phone and the desktop cannot drift. i18n with en and ja, like
  the desktop.
- **Keep the MVP inside Expo Go** (no custom native modules) so it runs on a real iPhone from
  Windows without a Mac or an Apple developer account. Move to a dev client and EAS Build only when
  push or native modules need it.
- **Relay:** a Cloudflare Worker + Durable Objects in TypeScript, with tweetnacl or libsodium-wrappers
  for E2EE on both ends, tested with `@cloudflare/vitest-pool-workers`. No database is needed: device
  and host records fit in Durable Object storage.
- **Daemon:** a `remote-gateway` module in `packages/daemon` with device store, pairing, LAN listener
  and relay dialer, reusing the ACP connection path from `websocket-server.ts`.

### Phased plan

Each part changes its own files and has its own tests, so parts in the same phase can run in
parallel. **Shared groundwork first:** a `packages/protocol/src/remote-devices.ts` contract (device,
scopes, pairing offer, method allowlist) and the "permission request to every client, first answer
wins" change in `harness-agent.ts`. Commit both before the parts that build on them.

**Phase 1 — MVP: chat and approvals over LAN or Tailscale**

| Part | Scope | How to test |
|---|---|---|
| 1A Daemon gateway | Device store in the harness home; one-time pairing grant (expires in 10 min) → long-lived device credential; opt-in listener on a LAN or Tailscale address, accepting only private and tailnet peers (as T3 does); method allowlist per scope; revoke | `bun test` in `packages/daemon`: pairing, expiry, revoke, allowlist, peer filter. Drive it with a small Bun WebSocket client against `acp-fake-agent.fixture.ts` |
| 1B Desktop pairing UI | Settings → Devices: show QR + link, list devices, revoke, toggle the LAN listener | `bun test` in `apps/desktop`; check in the running app over CDP, as for other desktop UI |
| 1C Mobile app shell | Expo app in `apps/mobile`: scan or paste the pairing link; host list; workspace and session list; chat view rendering ACP `session/update` (messages, tool calls, plans); send a prompt; Stop; permission cards; ask-user-question cards | Unit tests for the ACP client and reducers with `bun test`, fed recorded `session/update` streams. Manually on Windows: **Expo Go on a real iPhone or Android phone** on the same Wi-Fi or tailnet, plus the **Android Emulator** (Android Studio, `npx expo start --android`). `expo start --web` for quick layout checks in a browser. There is no iOS Simulator on Windows |

Done when you can pair a phone, open a running chat, approve a tool call and send a follow-up from
the phone while the desktop is in another room.

**Phase 2 — Zomfy Relay (reach the daemon from anywhere)**

| Part | Scope | How to test |
|---|---|---|
| 2A Relay Worker | Host Durable Object holding the daemon's outbound socket; device sockets spliced onto it; host and device registration; pairing invite; close codes | `@cloudflare/vitest-pool-workers` tests; `wrangler dev` locally; then deploy to your own Cloudflare account |
| 2B Daemon relay dialer + E2EE | Outbound WSS with backoff; X25519 + HKDF channel on the daemon side; the relay offered as a second route in the pairing offer | `bun test` with an in-process fake relay; end-to-end against `wrangler dev` |
| 2C App routes + E2EE | Ordered routes (LAN → Tailscale → relay) with fall-back and return to a preferred route; E2EE on the phone side; reconnect on foreground or network change; offline prompt queue | Unit tests for the route chooser and the queue; manually on a phone switched between Wi-Fi and mobile data |

**Phase 3 — Push notifications**

| Part | Scope | How to test |
|---|---|---|
| 3A Daemon events | Decide when to notify (approval needed, question, turn finished or failed, usage limit); per-device settings; short generic bodies | `bun test` on the event rules |
| 3B Relay push sender | Expo push service first (simplest, works with an EAS project); FCM HTTP v1 / APNs direct later if Expo's servers should not see the text | Worker tests with a mocked push API; real delivery on the **Android Emulator with a Google Play image** (FCM works there) |
| 3C App | Register the token; tap a notification to open the session; badge for pending approvals | Android Emulator and an Android phone. iOS push needs an Apple developer account and an EAS build installed on a real iPhone |

**Phase 4 — Depth** (each part separate): terminals (xterm.js in a WebView over the terminal
methods); new chat and new worktree from the phone; git changes and diff view; attachments and voice
input; iPad layout; store releases through EAS Submit.

**Phase 2b — bots on the same relay:** add the Discord and Slack webhook routes to the Phase 2
Worker, with a typed bot-event channel to the host Durable Object and lower-trust scopes in the
daemon. It can start as soon as 2A lands.

### Open questions for the person

- **iOS distribution:** iOS push and TestFlight need an Apple Developer Program account (99 USD a
  year). Android alone can ship as an APK, as Orca and T3 also do.
- **Push privacy:** is Expo's push service acceptable for the MVP, given it sees notification text,
  or should we go straight to FCM and APNs?
- **Relay identity:** one person, one Cloudflare account. A host key registered at first run is
  enough, with no account system like Clerk or Orca's `login.onorca.dev`. Is that acceptable?
