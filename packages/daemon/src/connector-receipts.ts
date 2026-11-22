// Durable receipts of connector deliveries, `<home>/connector/receipts.sqlite`. A delivery is
// written here before it is acked `received`, so one replayed after a crash or a reconnect is acked
// again but never run twice (docs/specs/bots/daemon.md#connector-client).

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { limits, type AckOutcome, type Failure } from '@zomfy/relay-contract'

export interface Receipt {
  id: string
  kind: string
  receivedAt: number
  doneAt: number | null
  outcome: AckOutcome | null
  failure: Failure | null
}

interface Row {
  id: string
  kind: string
  received_at: number
  done_at: number | null
  outcome: string | null
  failure: string | null
}

export function receiptsPath(home: string): string {
  return join(home, 'connector', 'receipts.sqlite')
}

export class ReceiptStore {
  private readonly db: Database

  /** `path` may be `:memory:` in tests. */
  constructor(path: string, now = Date.now()) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS receipts (
         id TEXT PRIMARY KEY, kind TEXT NOT NULL, received_at INTEGER NOT NULL,
         done_at INTEGER, outcome TEXT, failure TEXT)`
    )
    // The Hub forgets settled deliveries after the same span.
    this.db.query('DELETE FROM receipts WHERE received_at < ?').run(now - limits.retentionMs)
  }

  get(id: string): Receipt | null {
    const row = this.db.query<Row, [string]>('SELECT * FROM receipts WHERE id = ?').get(id)
    if (!row) return null
    return {
      id: row.id,
      kind: row.kind,
      receivedAt: row.received_at,
      doneAt: row.done_at,
      outcome: row.outcome as AckOutcome | null,
      failure: row.failure ? (JSON.parse(row.failure) as Failure) : null
    }
  }

  /** Records a new delivery; false when it already had a receipt. */
  receive(id: string, kind: string, now = Date.now()): boolean {
    return this.db.query('INSERT OR IGNORE INTO receipts (id, kind, received_at) VALUES (?, ?, ?)').run(id, kind, now).changes > 0
  }

  finish(id: string, outcome: AckOutcome, failure?: Failure, now = Date.now()): void {
    this.db
      .query('UPDATE receipts SET done_at = ?, outcome = ?, failure = ? WHERE id = ?')
      .run(now, outcome, failure ? JSON.stringify(failure) : null, id)
  }

  close(): void {
    this.db.close()
  }
}
