import { HARNESS_METHODS, type SessionInfo, type SessionOptions, type TurnResumeKind } from '@acp-harness/protocol'
import { isExternalAgentSession } from '@/lib/chat-agents'
import { cancelTurn, ensureSessionLoaded, harnessRequest, sendPrompt } from '@/daemon-connection'
import {
  addSession,
  getState,
  onSessionTransition,
  selectSession,
  updateSession,
  type ChatImage,
  type Session
} from '@/session-store'
import { relayPromptToLead } from '@/lib/project-lead'
import {
  chatSession,
  getChatState,
  patchChatSession,
  setCatalog,
  setMentionFiles,
  type QueuedMessage
} from '@/stores/chat-store'

function session(sessionId: string): Session | undefined {
  return getState().sessions.find((s) => s.id === sessionId)
}

export function isWorking(s: Pick<Session, 'status'>): boolean {
  return s.status === 'working' || s.status === 'needs-you'
}

/** Sends now, or queues behind the running turn the way Orca queues follow-ups. */
export function submitPrompt(sessionId: string, text: string, images: ChatImage[]): void {
  const target = session(sessionId)
  if (!target || (!text.trim() && images.length === 0)) return
  if (isWorking(target)) {
    const message: QueuedMessage = { id: crypto.randomUUID(), text, images }
    patchChatSession(sessionId, (c) => ({ queue: [...c.queue, message] }))
    return
  }
  patchChatSession(sessionId, { queuePaused: false })
  relayPromptToLead(sessionId, text)
  void sendPrompt(sessionId, text, images)
}

/** Stop pauses the queue, so what was typed for this turn doesn't run into the next. */
export function stopTurn(sessionId: string): void {
  if (chatSession(sessionId).queue.length > 0) patchChatSession(sessionId, { queuePaused: true })
  cancelTurn(sessionId)
}

/** Sends a queued message now; a running turn is interrupted for it (the daemon replaces it). */
export function steerQueued(sessionId: string, messageId: string): void {
  const message = chatSession(sessionId).queue.find((m) => m.id === messageId)
  if (!message) return
  removeQueued(sessionId, messageId)
  void sendPrompt(sessionId, message.text, message.images)
}

export function removeQueued(sessionId: string, messageId: string): void {
  patchChatSession(sessionId, (c) => ({ queue: c.queue.filter((m) => m.id !== messageId) }))
}

export function clearQueue(sessionId: string): void {
  patchChatSession(sessionId, { queue: [], queuePaused: false })
}

export function resumeQueue(sessionId: string): void {
  patchChatSession(sessionId, { queuePaused: false })
  const target = session(sessionId)
  if (target && !isWorking(target)) sendNextQueued(sessionId)
}

function sendNextQueued(sessionId: string): void {
  const [next] = chatSession(sessionId).queue
  if (!next) return
  removeQueued(sessionId, next.id)
  void sendPrompt(sessionId, next.text, next.images)
}

onSessionTransition(({ session: s, to }) => {
  if (to !== 'idle') return
  const chat = chatSession(s.id)
  if (chat.queue.length > 0 && !chat.queuePaused) sendNextQueued(s.id)
})

export function appendToDraft(sessionId: string, text: string): void {
  patchChatSession(sessionId, (c) => ({
    draft: c.draft && !c.draft.endsWith('\n') ? `${c.draft}\n${text}` : `${c.draft}${text}`
  }))
}

// Composers that should take focus once their chat is on screen (it may not be mounted yet).
const pendingComposerFocus = new Set<string>()
const composerFocusListeners = new Set<(sessionId: string) => void>()

export function requestComposerFocus(sessionId: string): void {
  pendingComposerFocus.add(sessionId)
  for (const listener of composerFocusListeners) listener(sessionId)
}

/** Called by a mounted chat view; `focus` runs now if its focus was already asked for, and on later asks. */
export function onComposerFocusRequest(sessionId: string, focus: () => void): () => void {
  const listener = (id: string) => {
    if (id !== sessionId || !pendingComposerFocus.delete(id)) return
    requestAnimationFrame(focus)
  }
  composerFocusListeners.add(listener)
  listener(sessionId)
  return () => composerFocusListeners.delete(listener)
}

export async function setSessionOptions(sessionId: string, options: Partial<SessionOptions>): Promise<void> {
  const target = session(sessionId)
  if (!target?.options) return
  const previous = target.options
  // The pick shows at once; the daemon's broadcast confirms or reverts it.
  updateSession(sessionId, (s) => ({ ...s, options: { ...previous, ...options } }))
  try {
    await harnessRequest(HARNESS_METHODS.sessionSetOptions, { sessionId, options }, target.hostId)
  } catch {
    updateSession(sessionId, (s) => ({ ...s, options: previous }))
  }
}

/** An external agent's own option (model, effort, mode); shown at once, reverted if the agent refuses. */
export async function setAgentOption(sessionId: string, optionId: string, value: string): Promise<void> {
  const target = session(sessionId)
  const previous = target?.agentState
  if (!target || !previous) return
  updateSession(sessionId, (s) => ({
    ...s,
    agentState: { ...previous, options: previous.options.map((o) => (o.id === optionId ? { ...o, currentValue: value } : o)) }
  }))
  try {
    await harnessRequest(HARNESS_METHODS.sessionSetAgentOption, { sessionId, optionId, value }, target.hostId)
  } catch (error) {
    updateSession(sessionId, (s) => ({
      ...s,
      agentState: previous,
      items: [...s.items, { kind: 'notice', text: `Couldn't change that option: ${String(error)}`, severity: 'error' }]
    }))
  }
}

export async function loadCatalog(workspaceId: string, refresh = false): Promise<void> {
  const current = getChatState().catalogs[workspaceId]
  if (current && !refresh && current.status !== 'error') return
  setCatalog(workspaceId, { status: 'loading', value: current?.value ?? null })
  try {
    const value = await harnessRequest(HARNESS_METHODS.sessionCatalog, { workspaceId, refresh })
    setCatalog(workspaceId, { status: 'ready', value })
  } catch (error) {
    setCatalog(workspaceId, { status: 'error', value: current?.value ?? null, error: String(error) })
  }
}

export async function loadMentionFiles(workspaceId: string): Promise<void> {
  const current = getChatState().mentionFiles[workspaceId]
  if (current?.status === 'loading') return
  setMentionFiles(workspaceId, { status: 'loading', value: current?.value ?? null })
  try {
    const value = await harnessRequest(HARNESS_METHODS.sessionMentionFiles, { workspaceId })
    setMentionFiles(workspaceId, { status: 'ready', value })
  } catch (error) {
    setMentionFiles(workspaceId, { status: 'error', value: current?.value ?? null, error: String(error) })
  }
}

/** Opens a harness session the daemon just made (fork, resumed conversation) as the active tab. */
function openSession(info: SessionInfo, hostId: string): void {
  if (info.workspaceId === null) return
  if (!getState().sessions.some((s) => s.id === info.id)) {
    addSession({ ...info, hostId, workspaceId: info.workspaceId, items: [], loaded: false })
  }
  selectSession(info.id)
  void ensureSessionLoaded(info.id)
}

/** Why a chat cannot fork, or null: ACP has no stable fork, so other agents' chats go without (as in Orca). */
export function forkUnavailableReason(s: Pick<Session, 'agent'>): string | null {
  return isExternalAgentSession(s) ? 'Forking works in Claude chats only' : null
}

/** A new tab continuing a copy of the conversation; `fromMessageId` ends the copy with that prompt's exchange. */
export async function forkChat(sessionId: string, fromMessageId?: string): Promise<void> {
  const source = session(sessionId)
  if (!source) return
  const reason = forkUnavailableReason(source)
  if (reason) {
    updateSession(sessionId, (s) => ({ ...s, items: [...s.items, { kind: 'notice', text: reason, severity: 'error' }] }))
    return
  }
  try {
    const info = await harnessRequest(
      HARNESS_METHODS.sessionFork,
      { sessionId, ...(fromMessageId ? { fromMessageId } : {}) },
      source.hostId
    )
    openSession(info, source.hostId)
  } catch (error) {
    const text = `Couldn't fork this chat: ${error instanceof Error ? error.message : String(error)}`
    updateSession(sessionId, (s) => ({ ...s, items: [...s.items, { kind: 'notice', text, severity: 'error' }] }))
  }
}

export async function resumeConversation(workspaceId: string, claudeSessionId: string, hostId: string): Promise<void> {
  const info = await harnessRequest(HARNESS_METHODS.sessionResume, { workspaceId, claudeSessionId }, hostId)
  openSession(info, hostId)
}

/** Drops this prompt and everything after it, and puts its words back in the composer. */
export async function rewindTo(sessionId: string, messageId: string): Promise<void> {
  const target = session(sessionId)
  if (!target) return
  const { text } = await harnessRequest(HARNESS_METHODS.sessionRewind, { sessionId, messageId }, target.hostId)
  patchChatSession(sessionId, { usage: null, draft: text })
  await reloadTranscript(sessionId)
}

/** Replays the daemon's transcript into this window from scratch. */
export function reloadTranscript(sessionId: string): Promise<void> {
  updateSession(sessionId, (s) => ({ ...s, loaded: false }))
  return ensureSessionLoaded(sessionId)
}

// Dev-only hook so scripts/cdp.ts can drive chat actions without hover-only controls.
if (import.meta.env.DEV) {
  Object.assign(window, { __chat: { reloadTranscript, forkChat, rewindTo, submitPrompt } })
}

function noteFailure(sessionId: string, what: string, error: unknown): void {
  const text = `${what}: ${error instanceof Error ? error.message : String(error)}`
  updateSession(sessionId, (s) => ({ ...s, items: [...s.items, { kind: 'notice', text, severity: 'error' }] }))
}

/** Continue / Retry / Resume: the daemon re-sends an unanswered prompt, else asks the agent to go on. */
export async function resumeTurn(sessionId: string, kind: Exclude<TurnResumeKind, 'auto'>): Promise<void> {
  const target = session(sessionId)
  if (!target) return
  // Shown at once; the daemon's broadcast confirms (or the failure below reverts) it.
  updateSession(sessionId, (s) => ({ ...s, status: 'working', turnStartedAt: Date.now() }))
  try {
    await harnessRequest(HARNESS_METHODS.sessionResumeTurn, { sessionId, kind }, target.hostId)
  } catch (error) {
    updateSession(sessionId, (s) => ({ ...s, status: target.status, turnStartedAt: null }))
    noteFailure(sessionId, "Couldn't pick this chat back up", error)
  }
}

/** The daemon resumes the chat once the usage limit resets (or retries with backoff when unknown). */
export async function setAutoResume(sessionId: string, enabled: boolean, resetsAt: number | null): Promise<void> {
  const target = session(sessionId)
  if (!target) return
  try {
    await harnessRequest(HARNESS_METHODS.sessionSetAutoResume, { sessionId, enabled, resetsAt }, target.hostId)
  } catch (error) {
    noteFailure(sessionId, "Couldn't change automatic resume", error)
  }
}
