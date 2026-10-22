import { HARNESS_METHODS, type TodoItem, type TodoLink, type TodoRequests } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST } from '@/session-store'
import { createExternalStore } from './external-store'

// The inbox panel's open state, and the person's todos as this computer's daemon broadcasts them.
// Todos live on the local daemon (not in webview storage) so every window and the manager share
// one list that survives a storage reset; links still point at any host.

interface InboxState {
  open: boolean
  todos: TodoItem[]
}

const store = createExternalStore<InboxState>({ open: false, todos: [] })

export const useInbox = store.use
export const getInbox = store.get

export function setInboxOpen(open: boolean): void {
  store.update((s) => ({ ...s, open }))
}

export function setTodos(todos: TodoItem[]): void {
  store.update((s) => ({ ...s, todos }))
}

export async function addTodo(text: string, link?: TodoLink, fromAgent?: string): Promise<TodoItem> {
  const params: TodoRequests[typeof HARNESS_METHODS.todoAdd]['params'] = { text, ...(link ? { link } : {}), ...(fromAgent ? { fromAgent } : {}) }
  return harnessRequest(HARNESS_METHODS.todoAdd, params, LOCAL_HOST)
}

export function setTodoDone(id: string, done: boolean): void {
  // Optimistic: the daemon's broadcast confirms it.
  store.update((s) => ({ ...s, todos: s.todos.map((t) => (t.id === id ? { ...t, done } : t)) }))
  void harnessRequest(HARNESS_METHODS.todoUpdate, { id, patch: { done } }, LOCAL_HOST).catch(() => undefined)
}

export function removeTodo(id: string): void {
  store.update((s) => ({ ...s, todos: s.todos.filter((t) => t.id !== id) }))
  void harnessRequest(HARNESS_METHODS.todoRemove, { id }, LOCAL_HOST).catch(() => undefined)
}
