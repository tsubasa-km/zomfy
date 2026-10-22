import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProjectLink } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'

/** Which host projects form one project; the desktop keeps it on this computer's daemon only. */
const FILE = join(HARNESS_HOME, 'project-links.json')

export class ProjectLinkStore {
  private links: Promise<ProjectLink[]> | null = null

  list(): Promise<ProjectLink[]> {
    this.links ??= readFile(FILE, 'utf8')
      .then((text) => {
        const parsed: unknown = JSON.parse(text)
        return Array.isArray(parsed) ? (parsed as ProjectLink[]) : []
      })
      .catch(() => [])
    return this.links
  }

  /** A host project belongs to one link at most, so saving takes its members out of any other. */
  async save(link: ProjectLink): Promise<ProjectLink[]> {
    const same = (a: ProjectLink['members'][number], b: ProjectLink['members'][number]) =>
      a.hostId === b.hostId && a.projectId === b.projectId
    const others = (await this.list())
      .filter((l) => l.id !== link.id)
      .map((l) => ({ ...l, members: l.members.filter((m) => !link.members.some((n) => same(m, n))) }))
      .filter((l) => l.members.length > 1)
    return this.write(link.members.length > 1 ? [...others, link] : others)
  }

  async remove(id: string): Promise<ProjectLink[]> {
    return this.write((await this.list()).filter((l) => l.id !== id))
  }

  private async write(list: ProjectLink[]): Promise<ProjectLink[]> {
    this.links = Promise.resolve(list)
    await mkdir(dirname(FILE), { recursive: true })
    const temp = `${FILE}.tmp`
    await writeFile(temp, JSON.stringify(list, null, 2))
    await rename(temp, FILE)
    return list
  }
}
