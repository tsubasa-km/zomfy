import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { TodoItem } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'

/** The person's todo list. Windows keep it on this computer's daemon; other hosts' stay empty. */
const FILE = join(HARNESS_HOME, 'todos.json')

export class TodoStore {
  private items: Promise<TodoItem[]> | null = null
  private writes: Promise<unknown> = Promise.resolve()

  list(): Promise<TodoItem[]> {
    this.items ??= readFile(FILE, 'utf8')
      .then((text) => {
        const parsed: unknown = JSON.parse(text)
        return Array.isArray(parsed) ? (parsed as TodoItem[]) : []
      })
      .catch(() => [])
    return this.items
  }

  async add(fields: Pick<TodoItem, 'text' | 'link' | 'fromAgent'>): Promise<TodoItem> {
    const text = fields.text?.trim()
    if (!text) throw new Error('A todo needs text')
    const item: TodoItem = {
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: Date.now(),
      ...(fields.link ? { link: fields.link } : {}),
      ...(fields.fromAgent ? { fromAgent: fields.fromAgent } : {})
    }
    await this.write([...(await this.list()), item])
    return item
  }

  async update(id: string, patch: Partial<Pick<TodoItem, 'text' | 'done'>> & { link?: TodoItem['link'] | null }): Promise<TodoItem> {
    const list = await this.list()
    const current = list.find((t) => t.id === id)
    if (!current) throw new Error(`Unknown todo ${id}`)
    const { link, ...rest } = patch
    const next: TodoItem = { ...current, ...rest }
    if (link === null) delete next.link
    else if (link) next.link = link
    if (patch.done !== undefined) {
      if (patch.done) next.doneAt = Date.now()
      else delete next.doneAt
    }
    await this.write(list.map((t) => (t.id === id ? next : t)))
    return next
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.list()).filter((t) => t.id !== id))
  }

  private async write(list: TodoItem[]): Promise<void> {
    this.items = Promise.resolve(list)
    // Serialized so an older list never lands after a newer one.
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(FILE), { recursive: true })
      const temp = `${FILE}.tmp`
      await writeFile(temp, JSON.stringify(list, null, 2))
      await rename(temp, FILE)
    })
    await this.writes
  }
}
