// The person's own todo list for the inbox. Kept by this computer's daemon (HARNESS_HOME/todos.json),
// so every window shares it and it outlives webview storage; links may point at any host.

export interface TodoLink {
  /** Host of the linked session or workspace ('local', 'wsl:<distro>', 'ssh:<target>'). */
  hostId: string
  workspaceId?: string
  sessionId?: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
  createdAt: number
  doneAt?: number
  link?: TodoLink
  /** Set when an agent forwarded it to the person (the calling session's title). */
  fromAgent?: string
}

export const TODO_METHODS = {
  todosList: '_harness/todos/list',
  todoAdd: '_harness/todos/add',
  todoUpdate: '_harness/todos/update',
  todoRemove: '_harness/todos/remove'
} as const

export const TODO_NOTIFICATIONS = {
  todosChanged: '_harness/todos/changed'
} as const

export interface TodoRequests {
  [TODO_METHODS.todosList]: { params: Record<string, never>; result: TodoItem[] }
  [TODO_METHODS.todoAdd]: { params: Pick<TodoItem, 'text' | 'link' | 'fromAgent'>; result: TodoItem }
  [TODO_METHODS.todoUpdate]: {
    params: { id: string; patch: Partial<Pick<TodoItem, 'text' | 'done'>> & { link?: TodoLink | null } }
    result: TodoItem
  }
  [TODO_METHODS.todoRemove]: { params: { id: string }; result: Record<string, never> }
}
