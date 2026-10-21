// Ported from Orca's shared/native-chat-task-list.ts (TodoWrite only; Claude has no update_plan).

export type NativeChatTaskStatus = 'pending' | 'in_progress' | 'completed'
export type NativeChatTask = { content: string; status: NativeChatTaskStatus; activeForm?: string }
export type NativeChatTaskList = { tasks: NativeChatTask[] }
export type NativeChatTaskChange = {
  kind: 'added' | 'removed' | 'started' | 'completed' | 'pending' | 'updated'
  task: NativeChatTask
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function isTaskListTool(name: string | undefined): boolean {
  return name?.trim().toLowerCase() === 'todowrite'
}

export function normalizeNativeChatTaskList(input: unknown): NativeChatTaskList | null {
  const entries = record(input)?.todos
  if (!Array.isArray(entries)) return null
  const tasks: NativeChatTask[] = []
  for (const entry of entries) {
    const item = record(entry)
    const content = nonemptyString(item?.content)
    if (!item || !content) continue
    const status = item.status === 'in_progress' ? 'in_progress' : item.status === 'completed' ? 'completed' : 'pending'
    const activeForm = nonemptyString(item.activeForm)
    tasks.push({ content, status, ...(activeForm ? { activeForm } : {}) })
  }
  if (entries.length > 0 && tasks.length === 0) return null
  return { tasks }
}

export function nativeChatTaskLabel(task: NativeChatTask): string {
  return task.status === 'in_progress' && task.activeForm ? task.activeForm : task.content
}

/** Which sentence a change reads as. */
export function nativeChatTaskChangeLabel(change: NativeChatTaskChange): string {
  switch (change.kind) {
    case 'added':
      return `Added ${change.task.content}`
    case 'removed':
      return `Removed ${change.task.content}`
    case 'started':
      return `Started ${change.task.content}`
    case 'completed':
      return `Completed ${change.task.content}`
    case 'pending':
      return `Marked pending: ${change.task.content}`
    case 'updated':
      return `Updated ${nativeChatTaskLabel(change.task)}`
  }
}

/** Content plus occurrence is the only identity the provider gives these entries. */
export function diffNativeChatTaskLists(
  previous: NativeChatTaskList,
  current: NativeChatTaskList
): NativeChatTaskChange[] {
  const byContent = new Map<string, NativeChatTask[]>()
  for (const task of previous.tasks) byContent.set(task.content, [...(byContent.get(task.content) ?? []), task])
  const occurrences = new Map<string, number>()
  const consumed = new Set<NativeChatTask>()
  const changes: NativeChatTaskChange[] = []
  for (const task of current.tasks) {
    const occurrence = occurrences.get(task.content) ?? 0
    occurrences.set(task.content, occurrence + 1)
    const before = byContent.get(task.content)?.[occurrence]
    if (!before) {
      changes.push({ kind: 'added', task })
      continue
    }
    consumed.add(before)
    if (before.status !== task.status) {
      changes.push({
        kind: task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'started' : 'pending',
        task
      })
    } else if (before.activeForm !== task.activeForm) {
      changes.push({ kind: 'updated', task })
    }
  }
  for (const task of previous.tasks) if (!consumed.has(task)) changes.push({ kind: 'removed', task })
  return changes
}
