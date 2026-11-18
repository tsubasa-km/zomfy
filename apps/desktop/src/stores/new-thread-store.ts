import { isChatAgentId, type ChatAgentId, type ChatEffort, type ChatPermissionMode, type SessionOptions } from '@acp-harness/protocol'
import { defaultChatAgent } from '@/lib/default-chat-agent'
import { getSetting, useSetting } from './settings-store'
import { createExternalStore } from './external-store'

// What the "New chat" tab's composer was last set to: the agent, and for Claude the permission
// mode, model and effort. The next new thread starts from them. Settings keep the defaults every
// other way of starting a chat uses; a pick here stands until that default is changed there.

/** The draft's entry in the chat store (its text and images), beside the sessions' own. */
export const NEW_THREAD_DRAFT = 'draft:new-thread'

/** A pick, and the Settings default it was made over: a different default since then wins. */
interface Remembered<T> {
  value: T
  over: T
}

interface NewThreadChoices {
  agent: Remembered<string> | null
  permissionMode: Remembered<ChatPermissionMode> | null
  /** Claude's model and effort; null leaves each to Claude's own settings. */
  model: string | null
  effort: ChatEffort | null
}

const STORAGE_KEY = 'acp-harness.new-thread.v1'
const EMPTY: NewThreadChoices = { agent: null, permissionMode: null, model: null, effort: null }

function load(): NewThreadChoices {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return saved && typeof saved === 'object' ? { ...EMPTY, ...saved } : EMPTY
  } catch {
    return EMPTY
  }
}

const store = createExternalStore<NewThreadChoices>(load(), (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private mode or a full disk: the pick lasts for this window.
  }
})

function picked<T>(pick: Remembered<T> | null, fallback: T): T {
  return pick && pick.over === fallback ? pick.value : fallback
}

/** What a thread started from the "New chat" tab begins with. */
export interface NewThreadStart {
  agent: ChatAgentId
  /** Claude's options; an ACP agent brings its own once its session opens. */
  options: SessionOptions
}

function resolve(choices: NewThreadChoices): NewThreadStart {
  const agent = picked(choices.agent, defaultChatAgent())
  return {
    agent: isChatAgentId(agent) ? agent : 'claude',
    options: {
      permissionMode: picked(choices.permissionMode, getSetting('defaultPermissionMode')),
      model: choices.model,
      effort: choices.effort
    }
  }
}

export function newThreadStart(): NewThreadStart {
  return resolve(store.get())
}

export function useNewThreadStart(): NewThreadStart {
  // The defaults are part of the answer: a change in Settings shows here at once.
  useSetting('defaultChatAgent')
  useSetting('defaultPermissionMode')
  return resolve(store.use((s) => s))
}

export function setNewThreadAgent(agent: ChatAgentId): void {
  store.update((s) => ({ ...s, agent: { value: agent, over: defaultChatAgent() } }))
}

export function setNewThreadOptions(patch: Partial<SessionOptions>): void {
  store.update((s) => ({
    ...s,
    ...('model' in patch ? { model: patch.model ?? null } : {}),
    ...('effort' in patch ? { effort: patch.effort ?? null } : {}),
    ...(patch.permissionMode ? { permissionMode: { value: patch.permissionMode, over: getSetting('defaultPermissionMode') } } : {})
  }))
}
