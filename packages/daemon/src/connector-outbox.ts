// Events and replies on their way to the relay, `<home>/connector/outbox/` (docs/specs/bots/daemon.md#connector-client):
// one file per event, so they survive a quit; sent oldest first in batches of at most the event
// batch budget, which halves on `too_large`. A file goes once its batch was sent on a live link;
// a reply sent twice still posts once, by its idempotency key.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { limits, type BotEvent } from '@zomfy/relay-contract'

export function outboxDir(home: string): string {
  return join(home, 'connector', 'outbox')
}

export interface OutboxItem {
  file: string
  event: BotEvent
  bytes: number
}

export class Outbox {
  private counter = 0
  private budget: number = limits.maxEventBatchBytes

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  add(event: BotEvent, now = Date.now()): void {
    // Sortable by name: time, then a counter for events in the same millisecond.
    const name = `${String(now).padStart(15, '0')}-${String(this.counter++ % 1e6).padStart(6, '0')}-${process.pid}.json`
    const temp = join(this.dir, `${name}.tmp`)
    writeFileSync(temp, JSON.stringify(event))
    renameSync(temp, join(this.dir, name))
  }

  /** Waiting events, oldest first; an unreadable file is dropped. */
  pending(): OutboxItem[] {
    const items: OutboxItem[] = []
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const text = readFileSync(join(this.dir, file), 'utf8')
        items.push({ file, event: JSON.parse(text) as BotEvent, bytes: Buffer.byteLength(text) })
      } catch {
        rmSync(join(this.dir, file), { force: true })
      }
    }
    return items
  }

  /** The next batch within the budget; always at least one event. */
  nextBatch(): OutboxItem[] {
    const batch: OutboxItem[] = []
    let bytes = 0
    for (const item of this.pending()) {
      if (batch.length && bytes + item.bytes > this.budget) break
      batch.push(item)
      bytes += item.bytes
    }
    return batch
  }

  done(items: OutboxItem[]): void {
    for (const item of items) rmSync(join(this.dir, item.file), { force: true })
  }

  /** The relay said a batch was too large: later batches are half the size. */
  shrink(): void {
    this.budget = Math.max(limits.minEventBatchBytes, Math.floor(this.budget / 2))
  }

  get batchBudget(): number {
    return this.budget
  }
}
