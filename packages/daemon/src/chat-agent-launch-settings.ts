import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatAgentId } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'
import { log } from './log.ts'

// Orca's per-host agent launch settings (HostAgentLaunchSettings): a command override and
// environment variables. Kept apart from settings.json because that file is broadcast to every
// client, and these values (API keys, account folders) stay on the host.

const PATH = join(HARNESS_HOME, 'chat-agents.json')

export interface ChatAgentLaunch {
  command: string | null
  env: Record<string, string>
}

type Store = Partial<Record<ChatAgentId, ChatAgentLaunch>>

let loaded: Promise<Store> | null = null

function load(): Promise<Store> {
  loaded ??= readFile(PATH, 'utf8')
    .then((text): Store => JSON.parse(text))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') log(`chat-agents.json unreadable: ${error.message}`)
      return {}
    })
  return loaded
}

export async function chatAgentLaunch(agent: ChatAgentId): Promise<ChatAgentLaunch> {
  const saved = (await load())[agent]
  return { command: saved?.command ?? null, env: { ...saved?.env } }
}

export async function updateChatAgentLaunch(
  agent: ChatAgentId,
  patch: { command?: string | null; env?: { name: string; value: string | null } }
): Promise<void> {
  const store = await load()
  const next = await chatAgentLaunch(agent)
  if (patch.command !== undefined) next.command = patch.command?.trim() || null
  if (patch.env) {
    const name = patch.env.name.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`${name || 'An empty name'} is not a variable name`)
    if (patch.env.value === null) delete next.env[name]
    else next.env[name] = patch.env.value
  }
  store[agent] = next
  await mkdir(HARNESS_HOME, { recursive: true })
  await writeFile(PATH, JSON.stringify(store, null, 2), { mode: 0o600 })
}
