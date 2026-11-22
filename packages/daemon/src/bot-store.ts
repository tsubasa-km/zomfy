// Bot records, `<home>/bots.json` (docs/specs/bots/daemon.md#bot-records), and the access requests
// waiting for the owner. A bot lives on the host whose daemon holds its record.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isChatAgentId, type Bot, type BotAccessRequest, type BotAsker, type BotInput, type BotSource, type ChatPermissionMode } from '@zomfy/protocol'
import { limits, type HelloBot } from '@zomfy/relay-contract'
import { refuseUnattended } from './chat-agent-launch-specs.ts'

const SOURCES: readonly BotSource[] = ['discord', 'slack', 'github', 'linear']
const HANDLE = /^[a-z0-9][a-z0-9_-]*$/
const PERMISSION_MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] satisfies ChatPermissionMode[]

interface Saved {
  bots: Bot[]
  accessRequests: BotAccessRequest[]
}

export function botsPath(home: string): string {
  return join(home, 'bots.json')
}

export type BotPatch = Partial<Omit<BotInput, 'homeWorkspaceId' | 'homePath'>>

/** Throws the reason a bot's fields are not usable, as the settings form shows it. */
export function validateBotFields(fields: BotPatch & Pick<Bot, 'name' | 'handle' | 'agent'>): void {
  if (!fields.name.trim()) throw new Error('Give the bot a name')
  if (!HANDLE.test(fields.handle) || fields.handle.length > limits.maxHandleChars) {
    throw new Error(`A handle is lower-case letters, digits, - and _, starting with a letter or digit, at most ${limits.maxHandleChars} long`)
  }
  if (!isChatAgentId(fields.agent)) throw new Error(`Unknown agent ${String(fields.agent)}`)
  refuseUnattended(fields.agent, 'bots')
  if (fields.permissionMode !== undefined && !PERMISSION_MODES.includes(fields.permissionMode)) {
    throw new Error(`Unknown permission mode ${String(fields.permissionMode)}`)
  }
  for (const [source, list] of Object.entries(fields.askers ?? {})) {
    if (!SOURCES.includes(source as BotSource)) throw new Error(`Unknown source ${source}`)
    if ((list ?? []).length > limits.maxMembersPerBot) throw new Error(`At most ${limits.maxMembersPerBot} people per source`)
    for (const asker of list ?? []) if (!asker.id?.trim()) throw new Error('Every person needs their id on the source')
  }
  for (const source of Object.keys(fields.owner ?? {})) {
    if (!SOURCES.includes(source as BotSource)) throw new Error(`Unknown source ${source}`)
  }
}

export class BotStore {
  private data: Saved
  private readonly listeners = new Set<() => void>()

  constructor(private readonly path: string) {
    this.data = load(path)
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): Bot[] {
    return this.data.bots
  }

  get(id: string): Bot | undefined {
    return this.data.bots.find((b) => b.id === id)
  }

  require(id: string): Bot {
    const bot = this.get(id)
    if (!bot) throw new Error(`Unknown bot ${id}`)
    return bot
  }

  byHandle(handle: string): Bot | undefined {
    return this.data.bots.find((b) => b.handle === handle.toLowerCase())
  }

  /** Checks a new bot's fields before its home is made. */
  checkNew(input: BotInput): void {
    validateBotFields({ ...input, handle: input.handle.trim().toLowerCase() })
    if (this.byHandle(input.handle.trim())) throw new Error(`Another bot is already @${input.handle.trim().toLowerCase()}`)
  }

  add(input: BotInput, homeWorkspaceId: string, now = Date.now()): Bot {
    this.checkNew(input)
    const bot: Bot = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      handle: input.handle.trim().toLowerCase(),
      avatar: input.avatar ?? null,
      purpose: input.purpose?.trim() || null,
      agent: input.agent,
      model: input.model ?? null,
      // Others can ask a bot, so it asks for approval unless told otherwise (the person's decision).
      permissionMode: input.permissionMode ?? 'default',
      homeWorkspaceId,
      owner: { ...input.owner },
      askers: normalizeAskers(input.askers),
      paused: false,
      createdAt: now
    }
    this.data.bots = [...this.data.bots, bot]
    this.save()
    return bot
  }

  update(id: string, patch: BotPatch): Bot {
    const current = this.require(id)
    const next: Bot = {
      ...current,
      ...patch,
      name: (patch.name ?? current.name).trim(),
      handle: (patch.handle ?? current.handle).trim().toLowerCase(),
      purpose: patch.purpose === undefined ? current.purpose : patch.purpose?.trim() || null,
      askers: patch.askers ? normalizeAskers(patch.askers) : current.askers,
      id: current.id,
      homeWorkspaceId: current.homeWorkspaceId,
      createdAt: current.createdAt
    }
    validateBotFields(next)
    const clash = this.byHandle(next.handle)
    if (clash && clash.id !== id) throw new Error(`Another bot is already @${next.handle}`)
    this.data.bots = this.data.bots.map((b) => (b.id === id ? next : b))
    this.save()
    return next
  }

  /** A paused bot refuses new requests; its running turns go on. */
  setPaused(id: string, paused: boolean): Bot {
    const next = { ...this.require(id), paused }
    this.data.bots = this.data.bots.map((b) => (b.id === id ? next : b))
    this.save()
    return next
  }

  setAskers(id: string, source: BotSource, askers: BotAsker[]): Bot {
    const bot = this.require(id)
    return this.update(id, { askers: { ...bot.askers, [source]: askers } })
  }

  remove(id: string): Bot {
    const bot = this.require(id)
    this.data.bots = this.data.bots.filter((b) => b.id !== id)
    this.data.accessRequests = this.data.accessRequests.filter((r) => r.botId !== id)
    this.save()
    return bot
  }

  accessRequests(): BotAccessRequest[] {
    return this.data.accessRequests
  }

  /** One request per person per bot: a second one replaces the first. */
  addAccessRequest(request: Omit<BotAccessRequest, 'id'>): BotAccessRequest {
    const kept = this.data.accessRequests.filter(
      (r) => !(r.botId === request.botId && r.source === request.source && r.requester.id === request.requester.id)
    )
    const added = { ...request, id: crypto.randomUUID() }
    this.data.accessRequests = [...kept, added]
    this.save()
    return added
  }

  /** Allow adds the requester to Who can ask as a member; either way the request goes. */
  answerAccessRequest(id: string, allow: boolean): void {
    const request = this.data.accessRequests.find((r) => r.id === id)
    if (!request) throw new Error('That access request was already answered')
    this.data.accessRequests = this.data.accessRequests.filter((r) => r.id !== id)
    const bot = this.get(request.botId)
    if (allow && bot) {
      const list = bot.askers[request.source] ?? []
      if (!list.some((a) => a.id === request.requester.id) && bot.owner[request.source] !== request.requester.id) {
        this.setAskers(bot.id, request.source, [...list, { id: request.requester.id, name: request.requester.name, role: 'member' }])
        return
      }
    }
    this.save()
  }

  private save() {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(this.data, null, 2))
    renameSync(temp, this.path)
    for (const listener of this.listeners) listener()
  }
}

function load(path: string): Saved {
  if (!existsSync(path)) return { bots: [], accessRequests: [] }
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Partial<Saved>
    return { bots: saved.bots ?? [], accessRequests: saved.accessRequests ?? [] }
  } catch {
    return { bots: [], accessRequests: [] }
  }
}

function normalizeAskers(askers: BotInput['askers']): Bot['askers'] {
  const out: Bot['askers'] = {}
  for (const [source, list] of Object.entries(askers ?? {}) as [BotSource, BotAsker[] | undefined][]) {
    const seen = new Set<string>()
    out[source] = (list ?? [])
      .map((a) => ({ ...a, id: a.id.trim() }))
      .filter((a) => a.id && !seen.has(a.id) && seen.add(a.id))
  }
  return out
}

/** A bot as `hello` announces it. Sources Zomfy has no relay route for yet are left out. */
export function helloBot(bot: Bot): HelloBot {
  return {
    id: bot.id,
    name: bot.name,
    handle: bot.handle,
    ...(bot.avatar && bot.avatar.length <= 2048 ? { avatar: bot.avatar } : {}),
    agent: bot.agent,
    paused: bot.paused,
    owner: { ...bot.owner },
    askers: Object.fromEntries(
      Object.entries(bot.askers).map(([source, list]) => [source, (list ?? []).map((a) => ({ id: a.id, role: a.role }))])
    ),
    places: []
  }
}
