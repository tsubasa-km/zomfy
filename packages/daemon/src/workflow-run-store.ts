import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WorkflowRun } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'

/** Workflow runs on this host, newest last; old finished ones are dropped past a project's cap. */
const FILE = join(HARNESS_HOME, 'workflow-runs.json')
const KEEP_PER_PROJECT = 30

export class WorkflowRunStore {
  private runs: Promise<WorkflowRun[]> | null = null
  private writing: Promise<void> = Promise.resolve()

  all(): Promise<WorkflowRun[]> {
    this.runs ??= readFile(FILE, 'utf8')
      .then((text) => {
        const parsed: unknown = JSON.parse(text)
        return Array.isArray(parsed) ? (parsed as WorkflowRun[]) : []
      })
      .catch(() => [])
    return this.runs
  }

  async get(id: string): Promise<WorkflowRun | null> {
    return (await this.all()).find((r) => r.id === id) ?? null
  }

  async save(run: WorkflowRun): Promise<void> {
    const list = await this.all()
    const others = list.filter((r) => r.id !== run.id)
    const mine = [...others.filter((r) => r.projectId === run.projectId), run]
    const live = (r: WorkflowRun) => r.status === 'running' || r.status === 'waiting'
    const dropped = new Set(
      mine
        .filter((r) => !live(r))
        .slice(0, Math.max(0, mine.length - KEEP_PER_PROJECT))
        .map((r) => r.id)
    )
    const next = [...others.filter((r) => !dropped.has(r.id)), run]
    this.runs = Promise.resolve(next)
    // Writes queue, so a later snapshot never lands before an earlier one.
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await mkdir(dirname(FILE), { recursive: true })
      const temp = `${FILE}.tmp`
      await writeFile(temp, JSON.stringify(next, null, 2))
      await rename(temp, FILE)
    })
    await this.writing
  }
}
