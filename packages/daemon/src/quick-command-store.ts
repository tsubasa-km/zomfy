import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { QuickCommand } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'

/** Saved terminal commands live on the host that runs them, as Orca keeps them per execution host. */
const FILE = join(HARNESS_HOME, 'quick-commands.json')

export class QuickCommandStore {
  private commands: Promise<QuickCommand[]> | null = null

  list(): Promise<QuickCommand[]> {
    this.commands ??= readFile(FILE, 'utf8')
      .then((text) => {
        const parsed: unknown = JSON.parse(text)
        return Array.isArray(parsed) ? (parsed as QuickCommand[]) : []
      })
      .catch(() => [])
    return this.commands
  }

  async save(command: QuickCommand): Promise<QuickCommand[]> {
    const list = await this.list()
    const index = list.findIndex((c) => c.id === command.id)
    return this.write(index === -1 ? [...list, command] : list.map((c, i) => (i === index ? command : c)))
  }

  async remove(id: string): Promise<QuickCommand[]> {
    return this.write((await this.list()).filter((c) => c.id !== id))
  }

  private async write(list: QuickCommand[]): Promise<QuickCommand[]> {
    this.commands = Promise.resolve(list)
    await mkdir(dirname(FILE), { recursive: true })
    const temp = `${FILE}.tmp`
    await writeFile(temp, JSON.stringify(list, null, 2))
    await rename(temp, FILE)
    return list
  }
}
