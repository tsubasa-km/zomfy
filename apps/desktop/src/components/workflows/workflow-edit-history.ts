import type { Workflow } from '@acp-harness/protocol'

// The editor's undo and redo. Changes that come in a quick burst (a drag, typing a name) undo as one.

const BURST_MS = 600

export class EditHistory {
  private past: Workflow[] = []
  private future: Workflow[] = []
  private lastAt = 0

  /** Notes that `before` became something else; a change right after the last one joins its step. */
  record(before: Workflow, now = Date.now()): void {
    if (now - this.lastAt > BURST_MS || this.past.length === 0) {
      this.past.push(before)
      if (this.past.length > 200) this.past.shift()
    }
    this.lastAt = now
    this.future = []
  }

  undo(current: Workflow): Workflow | null {
    const previous = this.past.pop()
    if (!previous) return null
    this.future.push(current)
    this.lastAt = 0
    return previous
  }

  redo(current: Workflow): Workflow | null {
    const next = this.future.pop()
    if (!next) return null
    this.past.push(current)
    this.lastAt = 0
    return next
  }

  /** A different workflow in the editor starts with no history. */
  reset(): void {
    this.past = []
    this.future = []
    this.lastAt = 0
  }
}
