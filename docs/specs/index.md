# Specs

* [Documentation-driven development](documentation-driven-development.md) - how specs, decisions and research are written and kept true
* [One right sidebar per split pane](pane-sidebars.md) - each split pane has its own right sidebar, opened from its own tab strip

# Bots

* [Zomfy Bots](bots/overview.md) - named agents in a folder on the person's computer, asked from Zomfy, Discord, Slack, GitHub, Linear, webhooks and schedules, copied from Orca Bots
* [Bots connector (Zomfy Relay Worker)](bots/connector.md) - the Cloudflare Worker and Durable Object each person deploys to receive source events, check Who can ask, queue deliveries and post replies
* [Running Zomfy Relay on your own machine](bots/self-host.md) - the same Relay Worker on local workerd with durable storage, behind a Cloudflare Tunnel or Tailscale Funnel, started with `bun run relay:local`
* [Bots connector contract](bots/contract.md) - the versioned messages between the daemon and Zomfy Relay, in packages/relay-contract
* [Bots in the daemon](bots/daemon.md) - bot records and homes, deliveries to chats and turns, replies, questions and approvals, schedules and triggers
* [Bots in the desktop app](bots/desktop.md) - the Bots settings pane, the sidebar's bots, Needs you, and talking to a bot from Zomfy itself

## Sources

* [Discord source](bots/sources/discord.md) - mention, DM or slash command in Discord, threads, buttons, through one Discord application per deployment
* [Slack source](bots/sources/slack.md) - mention or DM in Slack, thread replies, Block Kit questions, approvals, Stop and status edits, one Slack app per deployment
* [GitHub source](bots/sources/github.md) - mentions on issues and PRs through the person's own GitHub App, replies, review notes, PR events and triggers
* [Linear source](bots/sources/linear.md) - mention or bot label on a Linear issue, replies with an asked-by line, Linear triggers
* [Webhook source](bots/sources/webhooks.md) - a keyed URL per hook that starts a bot run, with signatures, filters, redaction, caps and retention

# Phone

* [Zomfy for Android](mobile/overview.md) - an APK-sideloaded Android app that watches and steers the agents on the person's hosts from anywhere
* [Pairing hosts and phones](mobile/pairing.md) - host-key registration with the relay at first run, QR pairing into revocable, scoped device records
* [Phone relay](mobile/relay.md) - the phone routes on the shared Worker, splicing end-to-end encrypted frames to the host's link
* [The Android app](mobile/app.md) - screens, Expo stack, connection and offline behaviour, APK build
* [Push notifications on the phone](mobile/push.md) - when the daemon notifies a phone, sent through Expo's free push service by the relay
* [Usage limits by the context ring, and connector icons](usage-limits-and-connector-icons.md) - the context card shows the account's usage limits; Connectors show each server's icon
* [Retire the acp-harness home and executable name](retire-legacy-home.md) - rewrites stored paths to ~/.zomfy, removes the old home's link, and installs the app as zomfy.exe
* [Wake a Claude chat when its background work finishes](background-task-wake.md) - a turn that ends with background tasks running keeps its Claude process, and the chat resumes on its own when a task finishes
* [Tool calls a stopped turn leaves open read as stopped](stopped-tool-calls.md) - Stop, a failed turn or a daemon restart closes every pending or running tool call as stopped, live and on replay
* [The Next steps card](next-steps-card.md) - the card a turn ends with: recap sections open by default, "Ask to do this" and "Add to Inbox" that say what they do
* [Zomfy's own skills, and worktrees that do not fill the disk](worktree-skills-and-storage.md) - bundled skills turned on per agent and scope from Settings, worktree sizes, cleanup by prompt or policy, freed build output, shared dependencies and a low-disk warning
* [Thinking that holds the answer shows open](visible-thinking.md) - a short reply after long thinking shows that thinking expanded and marked; Settings picks collapsed, expand when the reply is short, or always expanded
