// The Hub's outbound queue (docs/specs/bots/connector.md#replies-and-status-in-the-source): every
// post, edit and reaction a source makes goes through the `outbound` table, a FIFO per lane (one
// conversation or channel) that honours each source's rate limits, retries 5xx with backoff, and
// keeps each call's idempotency key for 7 days, so a retried event never posts twice. Each source
// registers a runner for its own ops; a row names its source.

export const OUTBOUND_DUE = 'discord-out' // the timer's key; named before the queue served every source
const MAX_ATTEMPTS = 6

export type OpResult =
  | { status: 'done' }
  /** Rate limited: hold the lane (or every lane of the source) this long. */
  | { status: 'wait'; ms: number; global?: boolean }
  | { status: 'retry' }
  | { status: 'fail'; why: string }

export interface OutboundRunner {
  run(op: any, n: number): Promise<OpResult>
}

export const OUTBOUND_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS outbound (
     n INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, lane TEXT NOT NULL, kind TEXT NOT NULL,
     ref TEXT, op TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
     not_before INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, done_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS outbound_pending ON outbound (state, n)`,
  `CREATE TABLE IF NOT EXISTS outbound_lanes (lane TEXT PRIMARY KEY, blocked_until INTEGER NOT NULL)`
]

/** Rows queued before the queue served every source are Discord's. */
const SOURCE_COLUMN = `ALTER TABLE outbound ADD COLUMN source TEXT NOT NULL DEFAULT 'discord'`

const now = () => Date.now()

/** A source's lane that holds all its lanes (Discord's global rate limit kept its old name). */
export const globalLane = (source: string) => (source === 'discord' ? 'global' : `${source}:global`)

export class Outbound {
  private draining = false
  private again = false
  private readonly runners = new Map<string, OutboundRunner>()

  constructor(
    private readonly sql: SqlStorage,
    private readonly scheduleDue: (key: string, at: number) => Promise<void>
  ) {
    for (const statement of OUTBOUND_SCHEMA) sql.exec(statement)
    const columns = sql.exec<{ name: string }>('PRAGMA table_info(outbound)').toArray()
    if (!columns.some((c) => c.name === 'source')) sql.exec(SOURCE_COLUMN)
  }

  register(source: string, runner: OutboundRunner) {
    this.runners.set(source, runner)
  }

  /** Queues one call; a key already queued (or done in the last 7 days) is not queued again. */
  queue(source: string, op: { t: string } & Record<string, unknown>, key: string, lane: string, notBefore = 0, ref?: string | null) {
    this.sql.exec(
      `INSERT OR IGNORE INTO outbound (key, source, lane, kind, ref, op, state, not_before, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      key,
      source,
      lane,
      op.t,
      ref ?? (typeof op.turnId === 'string' ? op.turnId : null),
      JSON.stringify(op),
      notBefore,
      now()
    )
  }

  /** Whether a call of this kind about `ref` is still waiting. */
  hasPending(source: string, kind: string, ref: string): boolean {
    return this.sql.exec("SELECT 1 FROM outbound WHERE state = 'pending' AND source = ? AND kind = ? AND ref = ?", source, kind, ref).toArray().length > 0
  }

  /** Keeps a call's progress, so a retry after a rate limit does not repeat what was done. */
  setOp(n: number, op: unknown) {
    this.sql.exec('UPDATE outbound SET op = ? WHERE n = ?', JSON.stringify(op), n)
  }

  /** Runs the queue without the caller waiting on the source; the timer catches what is left. */
  drainSoon(): Promise<void> {
    return this.drain().catch((error) => console.log(`outbound queue: ${error instanceof Error ? error.message : String(error)}`))
  }

  /** Runs every runnable call in order; one drain at a time. Re-arms the timer for the rest. */
  async drain(): Promise<void> {
    if (this.draining) {
      this.again = true
      return
    }
    this.draining = true
    try {
      do {
        this.again = false
        await this.drainOnce()
      } while (this.again)
    } finally {
      this.draining = false
    }
    const next = this.nextRunnableAt()
    if (next !== null) await this.scheduleDue(OUTBOUND_DUE, next)
  }

  private lanes(): Map<string, number> {
    const t = now()
    return new Map(
      this.sql.exec<{ lane: string; blocked_until: number }>('SELECT lane, blocked_until FROM outbound_lanes WHERE blocked_until > ?', t).toArray().map((r) => [r.lane, r.blocked_until])
    )
  }

  private nextRunnableAt(): number | null {
    const rows = this.sql.exec<{ source: string; lane: string; not_before: number }>("SELECT source, lane, not_before FROM outbound WHERE state = 'pending'").toArray()
    if (!rows.length) return null
    const blocked = this.lanes()
    return Math.min(...rows.map((r) => Math.max(r.not_before, blocked.get(r.lane) ?? 0, blocked.get(globalLane(r.source)) ?? 0)))
  }

  private async drainOnce() {
    const rows = this.sql
      .exec<{ n: number; source: string; lane: string; op: string; attempts: number; not_before: number }>(
        "SELECT n, source, lane, op, attempts, not_before FROM outbound WHERE state = 'pending' ORDER BY n LIMIT 100"
      )
      .toArray()
    const blocked = this.lanes()
    const skip = new Set<string>()
    for (const row of rows) {
      const t = now()
      const global = globalLane(row.source)
      if (skip.has(row.lane) || skip.has(global) || (blocked.get(global) ?? 0) > t || (blocked.get(row.lane) ?? 0) > t || row.not_before > t) {
        skip.add(row.lane)
        continue
      }
      const runner = this.runners.get(row.source)
      if (!runner) {
        skip.add(row.lane) // its source is not configured now; kept until purged
        continue
      }
      let result: OpResult
      try {
        result = await runner.run(JSON.parse(row.op), row.n)
      } catch (error) {
        console.log(`${row.source} call failed: ${error instanceof Error ? error.message : String(error)}`)
        result = { status: 'retry' }
      }
      if (result.status === 'done') {
        this.sql.exec("UPDATE outbound SET state = 'done', done_at = ? WHERE n = ?", now(), row.n)
      } else if (result.status === 'wait') {
        const lane = result.global ? global : row.lane
        this.sql.exec('INSERT OR REPLACE INTO outbound_lanes (lane, blocked_until) VALUES (?, ?)', lane, now() + result.ms)
        blocked.set(lane, now() + result.ms)
        skip.add(row.lane)
        if (result.global) skip.add(global)
      } else if (result.status === 'retry' && row.attempts + 1 < MAX_ATTEMPTS) {
        this.sql.exec('UPDATE outbound SET attempts = attempts + 1, not_before = ? WHERE n = ?', now() + 1000 * 2 ** row.attempts, row.n)
        skip.add(row.lane)
      } else {
        console.log(`${row.source} call dropped (${result.status === 'fail' ? result.why : 'too many attempts'})`)
        this.sql.exec("UPDATE outbound SET state = 'failed', done_at = ? WHERE n = ?", now(), row.n)
      }
    }
  }

  /** Rows done or failed before `before` go; their keys stop deduping then. */
  purge(before: number) {
    this.sql.exec("DELETE FROM outbound WHERE state != 'pending' AND done_at < ?", before)
    this.sql.exec('DELETE FROM outbound_lanes WHERE blocked_until < ?', now())
  }

  rows() {
    return this.sql.exec<{ key: string; source: string; kind: string; state: string }>('SELECT key, source, kind, state FROM outbound ORDER BY n').toArray()
  }
}
