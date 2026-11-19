import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { HARNESS_HOME } from './harness-home.ts'
import { log } from './log.ts'

// split_work's state on disk, so a daemon restart (an update, a crash) neither leaves a chat waiting
// for a report that will never come nor forgets which chats are helpers and which worktrees hold
// parts the chat has still to bring in.

export interface RunningSplit {
  /** The chat that split the work. */
  sessionId: string
  /** The chat's folder, which the parts merge into. */
  parentPath: string
  titles: string[]
  startedAt: number
  /** Set while parts are being merged into parentPath. */
  merging?: boolean
  /** Worktrees made so far, which keep the parts' work. */
  worktrees: { workspaceId: string; name: string; branch: string | null; path: string; finished?: boolean }[]
}

/** A part's worktree the split kept (unfinished, conflicting, failed, stopped) for its chat to bring in. */
export interface KeptPart {
  sessionId: string
  workspaceId: string
}

interface Saved {
  running: RunningSplit[]
  kept: KeptPart[]
  helpers: string[]
}

export class SplitStore {
  private state: Saved = { running: [], kept: [], helpers: [] }
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path = join(HARNESS_HOME, 'splits.json')) {}

  /**
   * Reads what a previous daemon left. The splits it was running are handed back and dropped; their
   * worktrees become kept parts, so the chat can still bring them in or tidy them away.
   */
  async load(): Promise<{ interrupted: RunningSplit[]; helpers: string[] }> {
    if (!existsSync(this.path)) return { interrupted: [], helpers: [] }
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<Saved>
      const interrupted = parsed.running ?? []
      const orphaned = interrupted.flatMap((s) => s.worktrees.map((w) => ({ sessionId: s.sessionId, workspaceId: w.workspaceId })))
      // Merged with anything recorded since this daemon started, never replacing it.
      const kept = [...(parsed.kept ?? []), ...orphaned, ...this.state.kept]
      this.state = {
        running: this.state.running,
        // One entry per worktree: a crash between recording it as kept and ending the split lists it twice.
        kept: kept.filter((k, i) => kept.findIndex((o) => o.workspaceId === k.workspaceId) === i),
        helpers: [...new Set([...(parsed.helpers ?? []), ...this.state.helpers])],
      }
      await this.flush()
      return { interrupted, helpers: this.state.helpers }
    } catch (error) {
      log(`could not read ${this.path}: ${String(error)}`)
      return { interrupted: [], helpers: [] }
    }
  }

  async start(split: RunningSplit): Promise<void> {
    this.state.running = [...this.state.running.filter((s) => s.sessionId !== split.sessionId), split]
    await this.flush()
  }

  async update(sessionId: string, patch: (split: RunningSplit) => void): Promise<void> {
    const split = this.state.running.find((s) => s.sessionId === sessionId)
    if (!split) return
    patch(split)
    await this.flush()
  }

  async end(sessionId: string): Promise<void> {
    this.state.running = this.state.running.filter((s) => s.sessionId !== sessionId)
    await this.flush()
  }

  async addHelper(sessionId: string): Promise<void> {
    if (this.state.helpers.includes(sessionId)) return
    this.state.helpers.push(sessionId)
    await this.flush()
  }

  keptFor(sessionId: string): KeptPart[] {
    return this.state.kept.filter((k) => k.sessionId === sessionId)
  }

  isKept(workspaceId: string): boolean {
    return this.state.kept.some((k) => k.workspaceId === workspaceId)
  }

  async keep(parts: KeptPart[]): Promise<void> {
    if (parts.length === 0) return
    this.state.kept = [...this.state.kept.filter((k) => !parts.some((p) => p.workspaceId === k.workspaceId)), ...parts]
    await this.flush()
  }

  async unkeep(workspaceId: string): Promise<void> {
    this.state.kept = this.state.kept.filter((k) => k.workspaceId !== workspaceId)
    await this.flush()
  }

  /** A part's worktree is gone (merged, or empty): a restart note no longer lists it as kept. */
  async forgetWorktree(workspaceId: string): Promise<void> {
    for (const split of this.state.running) split.worktrees = split.worktrees.filter((w) => w.workspaceId !== workspaceId)
    await this.flush()
  }

  /** A chat or helper is gone: what was recorded for it goes too. */
  async forget(sessionId: string): Promise<void> {
    const before = JSON.stringify(this.state)
    this.state.helpers = this.state.helpers.filter((id) => id !== sessionId)
    this.state.kept = this.state.kept.filter((k) => k.sessionId !== sessionId)
    if (JSON.stringify(this.state) !== before) await this.flush()
  }

  /** One write at a time, to a temporary file renamed into place, so a crash never leaves half a file. */
  private flush(): Promise<void> {
    const text = `${JSON.stringify(this.state, null, 2)}\n`
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true })
        const temp = `${this.path}.tmp`
        await writeFile(temp, text)
        await rename(temp, this.path)
      })
      .catch((error) => log(`could not write ${this.path}: ${String(error)}`))
    return this.writing
  }
}

/** What the chat hears about a split a restart cut short. */
export function interruptedSplitNote(split: RunningSplit, abortedMerge: boolean): string {
  const where = (w: RunningSplit['worktrees'][number]) => `${w.name} (${w.branch ?? 'no branch'}, ${w.path})`
  const finished = split.worktrees.filter((w) => w.finished === true)
  const unfinished = split.worktrees.filter((w) => w.finished !== true)
  return [
    `Your split_work (${split.titles.join(', ')}) was cut short when Zomfy restarted, and its report will not come.`,
    abortedMerge
      ? 'A merge into your folder was under way; that merge was aborted. Parts merged before it stay in your branch (see git log).'
      : 'Parts merged before the restart, if any, are in your branch (see git log).',
    finished.length > 0 ? `Finished, with their work committed on their branches: ${finished.map(where).join('; ')}.` : '',
    unfinished.length > 0
      ? `Not finished (their helpers were cut off or had not said they were done): ${unfinished.map(where).join('; ')}. Do not merge these without checking them first.`
      : '',
    'Bring in what is finished and not yet merged, then call manage_split with action "tidy" to remove the worktrees whose work is in your branch, or split again.',
  ]
    .filter(Boolean)
    .join(' ')
}
