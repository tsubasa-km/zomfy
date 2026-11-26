import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatAgentId, ChatAgentLaunchPatch, CodexConnection, Project } from '@zomfy/protocol'
import { HARNESS_HOME } from './harness-home.ts'
import { log } from './log.ts'

// Orca's per-host agent launch settings (HostAgentLaunchSettings): a command override and
// environment variables. Kept apart from settings.json because that file is broadcast to every
// client, and these values (API keys, account folders) stay on the host.

const PATH = join(HARNESS_HOME, 'chat-agents.json')

export interface ChatAgentLaunch {
  command: string | null
  env: Record<string, string>
  /** A guarded agent (GUARDED_CHAT_AGENTS) the person turned on for this host. */
  consent?: boolean
  codexConnection?: CodexConnection
  /** Claude only: this host's Claude chats start with Claude in Chrome (`--chrome`). */
  claudeChrome?: boolean
}

type Store = Partial<Record<ChatAgentId, ChatAgentLaunch>>

let loaded: Promise<Store> | null = null
let writing = Promise.resolve()

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
  return {
    command: saved?.command ?? null,
    env: { ...saved?.env },
    ...(saved?.consent ? { consent: true } : {}),
    ...(agent === 'codex' ? { codexConnection: saved?.codexConnection === 'app-server' ? 'app-server' : 'acp' } : {}),
    ...(agent === 'claude' && saved?.claudeChrome === true ? { claudeChrome: true } : {})
  }
}

export function updateChatAgentLaunch(agent: ChatAgentId, patch: ChatAgentLaunchPatch): Promise<void> {
  const updated = writing.then(() => saveLaunch(agent, patch))
  writing = updated.catch(() => undefined)
  return updated
}

async function saveLaunch(agent: ChatAgentId, patch: ChatAgentLaunchPatch): Promise<void> {
  const store = await load()
  const next = await chatAgentLaunch(agent)
  if (patch.command !== undefined) next.command = patch.command?.trim() || null
  if (patch.consent === true) next.consent = true
  if (patch.consent === false) delete next.consent
  if (patch.codexConnection !== undefined) {
    if (agent !== 'codex' || (patch.codexConnection !== 'acp' && patch.codexConnection !== 'app-server')) {
      throw new Error('Invalid Codex connection setting')
    }
    next.codexConnection = patch.codexConnection
  }
  if (patch.claudeChrome !== undefined) {
    if (agent !== 'claude' || typeof patch.claudeChrome !== 'boolean') throw new Error('Invalid Claude in Chrome setting')
    if (patch.claudeChrome) next.claudeChrome = true
    else delete next.claudeChrome
  }
  if (patch.env) {
    const name = patch.env.name.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`${name || 'An empty name'} is not a variable name`)
    if (patch.env.value === null) delete next.env[name]
    else next.env[name] = patch.env.value
  }
  await mkdir(HARNESS_HOME, { recursive: true })
  const temporary = `${PATH}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ ...store, [agent]: next }, null, 2), { mode: 0o600 })
    await rename(temporary, PATH)
    store[agent] = next
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

/** Whether a Claude chat starts with Claude in Chrome: its project's choice, else the host's. */
export function claudeChromeOn(launch: Pick<ChatAgentLaunch, 'claudeChrome'>, project: Pick<Project, 'claudeChrome'> | null): boolean {
  return project?.claudeChrome ?? launch.claudeChrome === true
}
