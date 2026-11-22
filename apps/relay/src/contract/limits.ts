// Every number of the contract, copied from Orca's `connector-limits.ts` where it has one. Both
// the Worker and the daemon import these; nothing hard-codes a limit of its own.

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const KiB = 1024
const MiB = 1024 * KiB

/** Largest WebSocket frame either side sends or accepts, in bytes (UTF-8). */
export const maxMessageBytes = 1 * MiB
/** Largest HTTP request body a route accepts. */
export const maxRequestBytes = 1 * MiB

/** Deliveries carried by one `delivery` message, and their total size. */
export const maxDeliveriesPerMessage = 20
export const maxDeliveryBatchBytes = 8 * MiB

/** A leased delivery with no `received` is re-sent after the lease plus its grace. */
export const leaseMs = 30 * SECOND
export const leaseGraceMs = 30 * SECOND

/** How long `start`, `send` and `trigger` wait for the host. */
export const requestWaitMs = DAY
export const maxTriggerWaitMs = DAY
/** How long `answer` and `cancel` live: a late answer or Stop is worse than none. */
export const deliveryTtlMs = 5 * MINUTE

/** Event batches; halved on `too_large`. */
export const maxEventBatchBytes = 192 * KiB
export const minEventBatchBytes = 4 * KiB

/** Reply text. */
export const maxLastAssistantMessageBytes = 8 * KiB
export const maxLongAnswerBytes = 32 * KiB

/** Live activity. */
export const maxActivityChars = 120
export const maxActivitySteps = 20
/** Minimum gap between activity edits in a source, per conversation. */
export const activityThrottleMs = 3 * SECOND

/** Questions and approvals. */
export const maxPromptTextBytes = 1500
export const maxAnswerTextChars = 4000

/** Work links and review notes on a reply. */
export const maxWorkLinks = 5
export const maxReviewNotes = 30
export const maxReviewNotePathChars = 256
export const maxReviewNoteChars = 1000

/** Bots in one `hello` (more follow in `hello-bots` pages). */
export const maxBotsPerHello = 20
export const maxHelloBotPages = 100
export const maxMembersPerBot = 200
export const maxHandleChars = 64

/** Trigger rules. */
export const maxRulesPerHello = 100
export const maxPlacesPerRule = 10
export const maxRuleTextChars = 4096
export const maxRuleGraceMs = DAY

/** Snapshot after each hello: conversations active in the last 7 days. */
export const maxSnapshotConversations = 200
export const snapshotWindowMs = 7 * DAY

/** Earlier messages of the bot's own, sent as context. */
export const maxEarlierOwnMessages = 10
export const maxEarlierOwnMessageChars = 4000
export const maxContextFiles = 10

/** Dedupe rows and webhook bodies are purged after this. */
export const retentionMs = 7 * DAY

/** Host invites live this long. */
export const hostInviteTtlMs = 10 * MINUTE
/** How far a signed request's timestamp may be from the Hub's clock. */
export const signedRequestSkewMs = 5 * MINUTE

/** The daemon's link: reconnect backoff and ping. */
export const reconnectMinMs = 1 * SECOND
export const reconnectMaxMs = 30 * SECOND
export const pingIntervalMs = 30 * SECOND

/** WebSocket close code for a link or device that failed authentication. */
export const closeUnauthorized = 4401
/** Close code when a newer link of the same host replaced this one. */
export const closeReplaced = 4409

/** Phone relay (docs/specs/mobile/relay.md): devices one host may register at the Hub. */
export const maxDevicesPerHost = 50
/** Phones pairing over the relay at once, per host. */
export const maxPairingSocketsPerHost = 4
/** Close code for a phone whose device the host revoked. */
export const closeRevoked = 4403
/** Close code the daemon asks for when a phone's end-to-end channel broke (bad, replayed or reordered frame). */
export const closeChannelBroken = 4400
