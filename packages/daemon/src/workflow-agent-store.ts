import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WorkflowAgentProfile } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'

/** Agents workflow steps use, defined once on this host for every project's workflows. */
const FILE = join(HARNESS_HOME, 'workflow-agents.json')

export class WorkflowAgentStore {
  private all: Promise<WorkflowAgentProfile[]> | null = null

  list(): Promise<WorkflowAgentProfile[]> {
    this.all ??= readFile(FILE, 'utf8')
      .then((text) => {
        const parsed: unknown = JSON.parse(text)
        return Array.isArray(parsed) ? (parsed as WorkflowAgentProfile[]) : []
      })
      .catch(() => [])
    return this.all
  }

  async save(agent: WorkflowAgentProfile): Promise<WorkflowAgentProfile[]> {
    const list = await this.list()
    const saved = { ...agent, updatedAt: Date.now() }
    const index = list.findIndex((a) => a.id === agent.id)
    return this.write(index === -1 ? [...list, saved] : list.map((a, i) => (i === index ? saved : a)))
  }

  async remove(id: string): Promise<WorkflowAgentProfile[]> {
    return this.write((await this.list()).filter((a) => a.id !== id))
  }

  private async write(list: WorkflowAgentProfile[]): Promise<WorkflowAgentProfile[]> {
    this.all = Promise.resolve(list)
    await mkdir(dirname(FILE), { recursive: true })
    const temp = `${FILE}.tmp`
    await writeFile(temp, JSON.stringify(list, null, 2))
    await rename(temp, FILE)
    return list
  }
}
