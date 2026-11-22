import {
  BOT_METHODS,
  type Bot,
  type BotAsker,
  type BotInput,
  type BotSource,
  type ConnectorStatus
} from '@zomfy/protocol'
import { ensureSessionLoaded, harnessRequest } from '@/daemon-connection'
import { getState, LOCAL_HOST, selectSession, subscribeStore } from '@/session-store'
import { botChats, INITIAL_BOTS_STATE, reduceBotsNotification, type BotsState } from '@/lib/bot-state'
import { createExternalStore } from './external-store'

// Zomfy Bots in this window (docs/specs/bots/desktop.md): the bots, the relay link and the access
// requests this computer's daemon holds, kept current from its `_harness/bots/*` notifications.

const store = createExternalStore<BotsState>(INITIAL_BOTS_STATE)

export const useBots = store.use
export const getBots = store.get

export function applyBotsNotification(method: string, params: unknown): void {
  store.update((s) => reduceBotsNotification(s, method, params))
}

export function setBotsPageOpen(open: boolean): void {
  store.update((s) => ({ ...s, pageOpen: open }))
}

export function selectBot(id: string | null): void {
  store.update((s) => ({ ...s, selectedId: id }))
}

/** Once this computer's daemon is up: loads the bots, the relay status and access requests. */
export async function startBots(): Promise<void> {
  try {
    const [{ bots }, connector, { requests }] = await Promise.all([
      harnessRequest(BOT_METHODS.botsList, {}, LOCAL_HOST),
      harnessRequest(BOT_METHODS.botsConnectorStatus, {}, LOCAL_HOST),
      harnessRequest(BOT_METHODS.botsAccessRequests, {}, LOCAL_HOST)
    ])
    store.update((s) => ({ ...s, bots, connector, accessRequests: requests }))
  } catch {
    // An older daemon has no bots.
  }
}

function upsert(bot: Bot): Bot {
  store.update((s) => ({ ...s, bots: s.bots?.some((b) => b.id === bot.id) ? s.bots.map((b) => (b.id === bot.id ? bot : b)) : [...(s.bots ?? []), bot] }))
  return bot
}

export async function createBot(input: BotInput): Promise<Bot> {
  return upsert(await harnessRequest(BOT_METHODS.botCreate, { input }, LOCAL_HOST))
}

export async function updateBot(id: string, patch: Partial<Omit<BotInput, 'homeWorkspaceId' | 'homePath'>>): Promise<Bot> {
  return upsert(await harnessRequest(BOT_METHODS.botUpdate, { id, patch }, LOCAL_HOST))
}

export async function pauseBot(id: string, paused: boolean): Promise<Bot> {
  return upsert(await harnessRequest(BOT_METHODS.botPause, { id, paused }, LOCAL_HOST))
}

export async function setBotAskers(id: string, source: BotSource, askers: BotAsker[]): Promise<Bot> {
  return upsert(await harnessRequest(BOT_METHODS.botAskers, { id, source, askers }, LOCAL_HOST))
}

export async function deleteBot(id: string, deleteHome: boolean): Promise<void> {
  await harnessRequest(BOT_METHODS.botDelete, { id, deleteHome }, LOCAL_HOST)
  store.update((s) => ({ ...s, bots: s.bots?.filter((b) => b.id !== id) ?? null, selectedId: s.selectedId === id ? null : s.selectedId }))
}

export async function answerAccessRequest(id: string, allow: boolean): Promise<void> {
  // Optimistic: the daemon's broadcast confirms it.
  store.update((s) => ({ ...s, accessRequests: s.accessRequests.filter((r) => r.id !== id) }))
  await harnessRequest(BOT_METHODS.botsAnswerAccessRequest, { id, allow }, LOCAL_HOST)
}

export async function pairConnector(relayUrl: string, setupCode: string): Promise<ConnectorStatus> {
  const connector = await harnessRequest(BOT_METHODS.botsConnectorPair, { relayUrl: relayUrl.trim(), setupCode: setupCode.trim() }, LOCAL_HOST)
  store.update((s) => ({ ...s, connector }))
  return connector
}

export async function unpairConnector(): Promise<ConnectorStatus> {
  const connector = await harnessRequest(BOT_METHODS.botsConnectorUnpair, {}, LOCAL_HOST)
  store.update((s) => ({ ...s, connector }))
  return connector
}

/** Brings a chat the daemon just made to the front once this window has heard of it. */
export function showChatWhenKnown(sessionId: string, timeoutMs = 10_000): Promise<boolean> {
  const known = () => getState().sessions.some((s) => s.id === sessionId)
  const show = () => {
    selectSession(sessionId)
    void ensureSessionLoaded(sessionId)
  }
  if (known()) {
    show()
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const stop = subscribeStore(() => {
      if (!known()) return
      stop()
      clearTimeout(timer)
      show()
      resolve(true)
    })
    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, timeoutMs)
  })
}

/** A new chat with the bot in its home; with `text`, the daemon runs it as the first turn. */
export async function startBotChat(botId: string, text?: string, fromSessionId?: string): Promise<string> {
  const { sessionId } = await harnessRequest(
    BOT_METHODS.botChatCreate,
    { id: botId, ...(text ? { text } : {}), ...(fromSessionId ? { fromSessionId } : {}) },
    LOCAL_HOST
  )
  await showChatWhenKnown(sessionId)
  return sessionId
}

/** Opens the bot's newest chat, or a new one when it has none. */
export async function openBot(bot: Bot): Promise<void> {
  const newest = botChats(getState().sessions, bot.id)[0]
  if (newest) {
    selectSession(newest.id)
    void ensureSessionLoaded(newest.id)
    return
  }
  await startBotChat(bot.id)
}
