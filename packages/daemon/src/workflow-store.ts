import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { replaceFile } from './replace-file.ts'
import { dirname, join } from 'node:path'
import type { Workflow } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'

/** Workflows by project id; they live with the projects on this host, outside the repositories. */
const FILE = join(HARNESS_HOME, 'workflows.json')

export class WorkflowStore {
  private all: Promise<Record<string, Workflow[]>> | null = null

  private load(): Promise<Record<string, Workflow[]>> {
    this.all ??= readFile(FILE, 'utf8')
      .then((text) => {
        const parsed: unknown = JSON.parse(text)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Workflow[]>) : {}
      })
      .catch(() => ({}))
    return this.all
  }

  async list(projectId: string): Promise<Workflow[]> {
    return (await this.load())[projectId] ?? []
  }

  async save(workflow: Workflow): Promise<Workflow[]> {
    const list = await this.list(workflow.projectId)
    const index = list.findIndex((w) => w.id === workflow.id)
    const next = index === -1 ? [...list, workflow] : list.map((w, i) => (i === index ? workflow : w))
    return this.write(workflow.projectId, next)
  }

  async remove(projectId: string, workflowId: string): Promise<Workflow[]> {
    return this.write(projectId, (await this.list(projectId)).filter((w) => w.id !== workflowId))
  }

  private async write(projectId: string, list: Workflow[]): Promise<Workflow[]> {
    const all = { ...(await this.load()), [projectId]: list }
    this.all = Promise.resolve(all)
    await mkdir(dirname(FILE), { recursive: true })
    const temp = `${FILE}.tmp`
    await writeFile(temp, JSON.stringify(all, null, 2))
    await replaceFile(temp, FILE)
    return list
  }
}
