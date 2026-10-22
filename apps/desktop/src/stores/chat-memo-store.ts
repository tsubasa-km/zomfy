import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { createExternalStore } from './external-store'

// Chat memos (experimental): one markdown note per session, stored by the session's host. This
// window keeps the loaded text, autosaves it after a pause, and remembers which memos are open.

export interface ChatMemo {
  /** 'unavailable' when the host predates memos or cannot read it; the button then hides. */
  status: 'loading' | 'ready' | 'unavailable'
  text: string
  /** Edits not yet written to the host. */
  dirty: boolean
  saving: boolean
  error: string | null
  open: boolean
}

const SAVE_DELAY_MS = 600
const EMPTY: ChatMemo = { status: 'loading', text: '', dirty: false, saving: false, error: null, open: false }

const store = createExternalStore<Record<string, ChatMemo>>({})
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** One write at a time per memo, so an older text never lands after a newer one. */
const writes = new Map<string, Promise<void>>()

function patch(sessionId: string, change: Partial<ChatMemo>): void {
  store.update((all) => ({ ...all, [sessionId]: { ...(all[sessionId] ?? EMPTY), ...change } }))
}

export function useChatMemo(sessionId: string): ChatMemo | undefined {
  return store.use((all) => all[sessionId])
}

export function loadChatMemo(sessionId: string): void {
  if (store.get()[sessionId]) return
  patch(sessionId, { status: 'loading' })
  harnessRequest(HARNESS_METHODS.sessionNoteRead, { sessionId }).then(
    ({ text }) => {
      // Typing may have started while the read was in flight; keep the newer text.
      if (!store.get()[sessionId]?.dirty) patch(sessionId, { status: 'ready', text })
      else patch(sessionId, { status: 'ready' })
    },
    () => patch(sessionId, { status: 'unavailable' })
  )
}

export function setChatMemoOpen(sessionId: string, open: boolean): void {
  patch(sessionId, { open })
  if (!open) void flushChatMemo(sessionId)
}

export function editChatMemo(sessionId: string, text: string): void {
  patch(sessionId, { text, dirty: true })
  clearTimeout(timers.get(sessionId))
  timers.set(sessionId, setTimeout(() => void flushChatMemo(sessionId), SAVE_DELAY_MS))
}

export function flushChatMemo(sessionId: string): Promise<void> {
  clearTimeout(timers.get(sessionId))
  timers.delete(sessionId)
  const previous = writes.get(sessionId) ?? Promise.resolve()
  const next = previous.then(async () => {
    const memo = store.get()[sessionId]
    if (!memo?.dirty) return
    const text = memo.text
    patch(sessionId, { saving: true, dirty: false })
    try {
      await harnessRequest(HARNESS_METHODS.sessionNoteWrite, { sessionId, text })
      patch(sessionId, { saving: false, error: null })
    } catch (error) {
      // Left dirty, so the next edit or close retries it.
      patch(sessionId, { saving: false, error: String(error), dirty: true })
    }
  })
  writes.set(sessionId, next)
  return next
}

// A pending autosave still goes out when the window closes or reloads.
window.addEventListener('beforeunload', () => {
  for (const [sessionId, memo] of Object.entries(store.get())) if (memo.dirty) void flushChatMemo(sessionId)
})
