// Zomfy Bots on this host (docs/specs/bots/daemon.md): the bot records and their homes, the
// `_harness/bots/*` methods' work, chats with a bot from Zomfy itself, and — when a relay is paired —
// the connector client, started with the daemon, whose deliveries become chats and turns.

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, relative, resolve, isAbsolute } from 'node:path'
import {
  BOT_NOTIFICATIONS,
  type Bot,
  type BotAccessRequest,
  type BotAsker,
  type BotChatFrom,
  type BotInput,
  type BotSource,
  type ConnectorStatus
} from '@zomfy/protocol'
import { ConnectorClient, type ConnectorClientOptions } from './connector-client'
import { Outbox, outboxDir } from './connector-outbox'
import { ReceiptStore, receiptsPath } from './connector-receipts'
import { loadOrCreateHostKey, pairWithRelay, readRelayConfig, unpairRelay } from './relay-pairing'
import { BotDeliveries, linksPath, type BotChats } from './bot-deliveries'
import { botsPath, BotStore, helloBot, type BotPatch } from './bot-store'
import { defaultBotsRoot, homeLayout, SIDE_RULES, writeBotHome } from './bot-home'

export interface BotWorkspaces {
  workspacePath(workspaceId: string): string | null
  /** The workspace whose folder is `path`, added as a project when it is not one yet. */
  workspaceForFolder(path: string): Promise<{ id: string }>
}

/** The chats layer, plus how a new chat starts: its first turn's hidden seed. */
export interface BotServiceChats extends Omit<BotChats, 'create'> {
  create(bot: Bot, init: { title: string; from?: BotChatFrom; seed?: string }): string
}

export interface BotServiceOptions {
  /** Zomfy's home (`~/.zomfy`): bots.json, relay/ and connector/. */
  home: string
  /** Where new bot homes go; `~/zomfy/bots` by default. */
  botsRoot?: string
  workspaces: BotWorkspaces
  chats: BotServiceChats
  broadcast(method: string, params: unknown): void
  hostName?: string
  log?: (message: string) => void
  /** For tests. */
  fetch?: typeof fetch
  link?: ConnectorClientOptions['link']
  /** The link's other channels (the phone relay). */
  channels?: ConnectorClientOptions['channels']
}

const UNPAIRED: ConnectorStatus = {
  state: 'unpaired',
  relayUrl: null,
  hostId: null,
  sources: [],
  lastConnectedAt: null,
  retryAt: null,
  error: null
}

export class BotService {
  readonly store: BotStore
  readonly deliveries: BotDeliveries
  private client: ConnectorClient | null = null
  private receipts: ReceiptStore | null = null
  private readonly botsRoot: string

  constructor(private readonly options: BotServiceOptions) {
    this.botsRoot = options.botsRoot ?? defaultBotsRoot()
    this.store = new BotStore(botsPath(options.home))
    this.deliveries = new BotDeliveries({
      bot: (id) => this.store.get(id),
      chats: {
        create: (bot, init) => this.openChat(bot, init),
        exists: (sessionId) => options.chats.exists(sessionId),
        busy: (sessionId) => options.chats.busy(sessionId),
        waitIdle: (sessionId) => options.chats.waitIdle(sessionId),
        run: (sessionId, text) => options.chats.run(sessionId, text),
        stop: (sessionId) => options.chats.stop(sessionId)
      },
      emit: (event) => this.events().queueEvent(event),
      accessRequest: (request) => {
        this.store.addAccessRequest({ ...request, createdAt: Date.now() })
        this.options.broadcast(BOT_NOTIFICATIONS.accessRequestsChanged, { requests: this.store.accessRequests() })
      },
      linksPath: linksPath(options.home),
      log: options.log
    })
    this.store.onChange(() => {
      this.options.broadcast(BOT_NOTIFICATIONS.botsChanged, { bots: this.store.list() })
      this.client?.botsChanged()
    })
  }

  /** Connects to the relay when this host is paired; bots answer in Zomfy either way. */
  start(): void {
    if (readRelayConfig(this.options.home)) this.startClient()
  }

  stop(): void {
    this.client?.stop()
    this.client = null
    this.receipts?.close()
    this.receipts = null
  }

  // Bots

  list(): Bot[] {
    return this.store.list()
  }

  async create(input: BotInput): Promise<Bot> {
    this.store.checkNew(input)
    let path: string
    if (input.homeWorkspaceId) {
      const found = this.options.workspaces.workspacePath(input.homeWorkspaceId)
      if (!found) throw new Error('That workspace does not exist on this host')
      path = found
    } else if (input.homePath) {
      if (!existsSync(input.homePath)) throw new Error(`No folder at ${input.homePath}`)
      path = resolve(input.homePath)
    } else {
      path = join(this.botsRoot, input.handle.trim().toLowerCase())
      // A folder left by a deleted bot of the same handle is reused, SOUL and MEMORY included.
      if (existsSync(path) && readdirSync(path).length && !existsSync(join(path, 'bot.json'))) {
        throw new Error(`${path} already exists and is not a bot's home; choose it as an existing folder instead`)
      }
      mkdirSync(path, { recursive: true })
    }
    const workspace = input.homeWorkspaceId ? { id: input.homeWorkspaceId } : await this.options.workspaces.workspaceForFolder(path)
    const bot = this.store.add(input, workspace.id)
    try {
      writeBotHome(path, bot)
    } catch (error) {
      this.store.remove(bot.id)
      throw error
    }
    return bot
  }

  update(id: string, patch: BotPatch): Bot {
    const bot = this.store.update(id, patch)
    const path = this.homePath(bot)
    if (path) writeBotHome(path, bot)
    return bot
  }

  pause(id: string, paused: boolean): Bot {
    return this.store.setPaused(id, paused)
  }

  setAskers(id: string, source: BotSource, askers: BotAsker[]): Bot {
    return this.store.setAskers(id, source, askers)
  }

  /** Forgets the bot; its home goes too only when asked and Zomfy made it (under `~/zomfy/bots`). */
  remove(id: string, deleteHome = false): void {
    const bot = this.store.require(id)
    const path = this.homePath(bot)
    this.store.remove(id)
    if (deleteHome && path && this.madeByZomfy(path)) rmSync(path, { recursive: true, force: true })
  }

  accessRequests(): BotAccessRequest[] {
    return this.store.accessRequests()
  }

  answerAccessRequest(id: string, allow: boolean): void {
    this.store.answerAccessRequest(id, allow)
    this.options.broadcast(BOT_NOTIFICATIONS.accessRequestsChanged, { requests: this.store.accessRequests() })
  }

  /** A chat with the bot from Zomfy itself: no relay needed. */
  chatCreate(id: string, text?: string, fromSessionId?: string): { sessionId: string } {
    const bot = this.store.require(id)
    if (bot.paused) throw new Error(`${bot.name} is paused`)
    const prompt = text?.trim()
    const sessionId = this.openChat(bot, {
      title: prompt ? prompt.replace(/\s+/g, ' ').slice(0, 40) : `${bot.name} chat`,
      ...(fromSessionId ? { from: { source: 'zomfy', fromSessionId } } : {})
    })
    if (prompt) {
      const asked = fromSessionId ? `[Asked from another Zomfy chat (zomfy:${fromSessionId})]\n\n${prompt}` : prompt
      void this.options.chats.run(sessionId, asked).catch((error) => this.options.log?.(`bot chat ${sessionId}: ${String(error)}`))
    }
    return { sessionId }
  }

  // Connector

  connectorStatus(): ConnectorStatus {
    if (this.client) return this.client.status()
    const config = readRelayConfig(this.options.home)
    return config ? { ...UNPAIRED, state: 'offline', relayUrl: config.relayUrl, hostId: config.hostId } : UNPAIRED
  }

  async connectorPair(params: { relayUrl: string; setupCode?: string; invite?: string; hostName?: string }): Promise<ConnectorStatus> {
    if (!params.setupCode?.trim() && !params.invite?.trim()) throw new Error('Paste the setup code or a host invite')
    this.stop()
    await pairWithRelay(this.options.home, {
      relayUrl: params.relayUrl,
      setupCode: params.setupCode,
      invite: params.invite,
      hostName: params.hostName?.trim() || this.hostName(),
      fetch: this.options.fetch
    })
    this.startClient()
    return this.connectorStatus()
  }

  connectorUnpair(): ConnectorStatus {
    this.stop()
    unpairRelay(this.options.home)
    const status = this.connectorStatus()
    this.options.broadcast(BOT_NOTIFICATIONS.connectorStatusChanged, status)
    return status
  }

  /** The running client, for tests. */
  get connector(): ConnectorClient | null {
    return this.client
  }

  private hostName() {
    return this.options.hostName ?? hostname()
  }

  /** Events go to the outbox even with no client: they are sent once a relay links. */
  private events(): { queueEvent: ConnectorClient['queueEvent'] } {
    if (this.client) return this.client
    if (!readRelayConfig(this.options.home)) return { queueEvent: () => undefined }
    const outbox = new Outbox(outboxDir(this.options.home))
    return { queueEvent: (event) => outbox.add(event) }
  }

  private startClient() {
    const config = readRelayConfig(this.options.home)
    if (!config || this.client) return
    this.receipts = new ReceiptStore(receiptsPath(this.options.home))
    this.client = new ConnectorClient({
      config,
      key: loadOrCreateHostKey(this.options.home),
      host: { id: config.hostId, name: this.hostName(), kind: 'desktop' },
      receipts: this.receipts,
      bots: () => this.store.list().map(helloBot),
      sources: () => ['discord'],
      handle: (delivery) => this.deliveries.handle(delivery),
      outbox: new Outbox(outboxDir(this.options.home)),
      snapshot: () => this.deliveries.snapshot(),
      onStatus: (status) => this.options.broadcast(BOT_NOTIFICATIONS.connectorStatusChanged, status),
      log: this.options.log,
      fetch: this.options.fetch,
      link: this.options.link,
      channels: this.options.channels
    })
    this.client.start()
  }

  private homePath(bot: Bot): string | null {
    return this.options.workspaces.workspacePath(bot.homeWorkspaceId)
  }

  private madeByZomfy(path: string): boolean {
    const rel = relative(this.botsRoot, path)
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
  }

  /** A chat in the bot's home; in a home with its own AGENTS.md, the first turn is pointed at the bot's rules. */
  private openChat(bot: Bot, init: { title: string; from?: BotChatFrom }): string {
    const path = this.homePath(bot)
    if (!path || !existsSync(path)) throw new Error(`${bot.name}'s home folder is missing`)
    const seed =
      homeLayout(path).rules === SIDE_RULES
        ? `You are the Zomfy bot ${bot.name} (@${bot.handle}). Read ${SIDE_RULES.replace(/\\/g, '/')} first and follow it, with SOUL.md and MEMORY.md.`
        : undefined
    return this.options.chats.create(bot, { ...init, ...(seed ? { seed } : {}) })
  }
}
