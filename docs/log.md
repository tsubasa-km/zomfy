# Directory Update Log

## 2026-11-22
* **Update**: Built the Worker side of the [GitHub source](specs/bots/sources/github.md) (App webhooks, mentions, review replies, PR events, triggers, JWT and installation tokens, and `bun run deploy --github` with GitHub's manifest flow); in progress with a "Built so far" section.
* **Update**: Built the Worker side of the [Slack source](specs/bots/sources/slack.md) (Events API, Block Kit buttons, status edits, actions, the app manifest and deploy steps); in progress with a "Built so far" section. The relay's outbound queue, triggers and actions are now shared by every source, and the [contract](specs/bots/contract.md) gained the pieces the remaining sources need.
* **Update**: Built the Worker side of phase B1 of Zomfy Bots: the [Discord source](specs/bots/sources/discord.md) (Gateway object, interactions, replies, buttons, rate limits) is in progress with a "Built so far" section, the [connector](specs/bots/connector.md) gains its deploy flow, and the [contract](specs/bots/contract.md) gains `isDefault` on a hello's bots.
* **Update**: Built phase B0 of [Zomfy Bots](specs/bots/overview.md): the [contract](specs/bots/contract.md) is done; the [connector](specs/bots/connector.md), [daemon](specs/bots/daemon.md) and [pairing](specs/mobile/pairing.md) specs are in progress, each with a "Built so far" section and the details that changed while building (link channel, `hello-bots` pages, `helloRev` on every later message, `@cloudflare/vitest-plugin`).
* **Update**: Phone phases M0 and M1 are implemented: every window and phone is asked at once ([Zomfy for Android](specs/mobile/overview.md)), the remote gateway and Settings → Devices ([pairing](specs/mobile/pairing.md)), and the app shell in `apps/mobile` ([app](specs/mobile/app.md)); the specs stay in progress for M2–M4.
* **Update**: Folded the person's answers into the [bots](specs/bots/overview.md) and [phone](specs/mobile/overview.md) specs: Discord Gateway on the Cloudflare side, Deploy button on the public repo, APK on EAS cloud, Expo and Firebase accounts, one Discord and one Slack app per deployment, bot homes, approval by default, Bots in the sidebar navigation.
* **Creation**: Specs for [Zomfy Bots](specs/bots/overview.md) (connector, contract, daemon, desktop, and the Discord, Slack, GitHub, Linear and webhook sources) and the [Android app](specs/mobile/overview.md) (pairing, relay, app, push), all planned; the decision on [one Cloudflare Worker for bots and the phone relay](decisions/one-relay-worker.md).
* **Initialization**: Made `docs/` an OKF v0.3 bundle: [index](index.md), [specs](specs/), [decisions](decisions/), and front matter on the [research](research/) notes.
* **Creation**: [Documentation-driven development](specs/documentation-driven-development.md) and the decision to [adopt OKF](decisions/adopt-okf.md).
* **Creation**: [One right sidebar per split pane](specs/pane-sidebars.md).
* **Update**: [One right sidebar per split pane](specs/pane-sidebars.md) is implemented.
* **Creation**: [Usage limits by the context ring, and connector icons](specs/usage-limits-and-connector-icons.md).
* **Update**: [Usage limits by the context ring, and connector icons](specs/usage-limits-and-connector-icons.md) is implemented.
* **Creation**: [Retire the acp-harness home and executable name](specs/retire-legacy-home.md), in progress.
