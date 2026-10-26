import { diffFromToolCall, type NativeChatDiffLine } from '@/shared/native-chat-diff'
import type { TurnEndMeta } from '@acp-harness/protocol'
import type { ThreadItem } from '@/session-store'
import {
  isTaskListTool,
  normalizeNativeChatTaskList,
  type NativeChatTaskList
} from './native-chat-task-list'

export type ToolItem = Extract<ThreadItem, { kind: 'tool' }>
export type UserItem = Extract<ThreadItem, { kind: 'user' }>

/** A top-level tool call; a Task call carries the calls its subagent made. */
/** `decision` is the approval asked for this call, when there was one. */
export type ToolNode = { tool: ToolItem; children: ToolItem[]; decision?: { title: string; chosen: string } }

export type TurnDiffFile = { path: string; added: number; removed: number; edits: NativeChatDiffLine[][] }
export type TurnDiff = { files: TurnDiffFile[]; added: number; removed: number }

export type TranscriptRowModel =
  | { kind: 'user'; item: UserItem }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tools'; tools: ToolNode[] }
  | { kind: 'tasks'; list: NativeChatTaskList; previous: NativeChatTaskList | null; fromBoard?: boolean }
  | { kind: 'decision'; title: string; chosen: string }
  | { kind: 'notice'; text: string; severity?: string; turnEnd?: TurnEndMeta; runId?: string }
  | { kind: 'compaction'; status: string }
  | { kind: 'turn-diff'; diff: TurnDiff }

export type TranscriptModel = {
  rows: TranscriptRowModel[]
  /** The newest TodoWrite list, docked above the composer. */
  taskList: NativeChatTaskList | null
}

const SUBAGENT_TOOLS = new Set(['Task', 'Agent'])

/** The tool's Claude name: reported by the daemon, else the title's prefix (older transcripts). */
export function toolNameOf(tool: ToolItem): string {
  return tool.toolName ?? tool.title.split(': ')[0] ?? tool.title
}

export function isSubagentTool(tool: ToolItem): boolean {
  return SUBAGENT_TOOLS.has(toolNameOf(tool))
}

/**
 * Groups the flat transcript the way Orca draws it: consecutive tools fold into one run, a
 * subagent's calls sit under its Task, TodoWrite reads as a task list, and each finished turn
 * that edited files ends with a changed-files rollup.
 */
export function buildTranscript(items: ThreadItem[], turnRunning: boolean, cwd: string): TranscriptModel {
  const children = new Map<string, ToolItem[]>()
  for (const item of items) {
    if (item.kind === 'tool' && item.parentId) {
      children.set(item.parentId, [...(children.get(item.parentId) ?? []), item])
    }
  }

  const rows: TranscriptRowModel[] = []
  let taskList: NativeChatTaskList | null = null
  const board = new TaskBoard()
  let turnEdits: ToolItem[] = []
  const closeTurn = (): void => {
    const diff = turnDiff(turnEdits, cwd)
    if (diff) rows.push({ kind: 'turn-diff', diff })
    turnEdits = []
  }

  for (const item of items) {
    switch (item.kind) {
      case 'tool': {
        if (item.parentId) {
          if (item.status === 'completed') turnEdits.push(item)
          break
        }
        const name = toolNameOf(item)
        if (isTaskListTool(name)) {
          const list = normalizeNativeChatTaskList(item.input)
          if (list) {
            rows.push({ kind: 'tasks', list, previous: taskList })
            taskList = list
          }
          break
        }
        if (board.apply(name, item)) {
          // A burst of TaskCreate/TaskUpdate calls reads as one change to the list.
          const list = board.snapshot()
          const last = rows.at(-1)
          if (last?.kind === 'tasks' && last.fromBoard) last.list = list
          else rows.push({ kind: 'tasks', list, previous: taskList, fromBoard: true })
          taskList = list
          break
        }
        if (item.status === 'completed') turnEdits.push(item)
        const node: ToolNode = { tool: item, children: children.get(item.id) ?? [] }
        const last = rows.at(-1)
        if (last?.kind === 'tools') last.tools.push(node)
        else rows.push({ kind: 'tools', tools: [node] })
        break
      }
      case 'permission': {
        if (!item.chosen) break
        // The answer belongs to the call that asked, so it stays inside that run of tools.
        const last = rows.at(-1)
        const node = last?.kind === 'tools' ? last.tools.at(-1) : undefined
        if (node && !node.decision) node.decision = { title: item.title, chosen: item.chosen }
        else rows.push({ kind: 'decision', title: item.title, chosen: item.chosen })
        break
      }
      case 'user':
        closeTurn()
        rows.push({ kind: 'user', item })
        break
      case 'agent':
      case 'thought':
        // An empty reply between two calls would split one run of tools into several.
        if (item.text.trim()) rows.push({ kind: item.kind, text: item.text })
        break
      case 'notice':
        rows.push({
          kind: 'notice',
          text: item.text,
          ...(item.severity ? { severity: item.severity } : {}),
          ...(item.turnEnd ? { turnEnd: item.turnEnd } : {}),
          ...(item.runId ? { runId: item.runId } : {})
        })
        break
      case 'compaction':
        rows.push({ kind: 'compaction', status: item.status })
        break
    }
  }
  if (!turnRunning) closeTurn()
  return { rows, taskList }
}

function turnDiff(tools: ToolItem[], cwd: string): TurnDiff | null {
  const files = new Map<string, TurnDiffFile>()
  for (const tool of tools) {
    const name = toolNameOf(tool)
    const lines = diffFromToolCall(name, tool.input, 400)
    const absolute = filePathOf(tool.input)
    if (!lines || !absolute) continue
    const path = workspaceRelative(absolute, cwd)
    const file = files.get(path) ?? { path, added: 0, removed: 0, edits: [] }
    file.added += lines.filter((l) => l.kind === 'add').length
    file.removed += lines.filter((l) => l.kind === 'del').length
    file.edits.push(lines.filter((l) => l.kind !== 'meta' || l.text !== absolute))
    files.set(path, file)
  }
  if (files.size === 0) return null
  const list = [...files.values()]
  return {
    files: list,
    added: list.reduce((n, f) => n + f.added, 0),
    removed: list.reduce((n, f) => n + f.removed, 0)
  }
}

/**
 * Claude Code's task tools (TaskCreate/TaskUpdate), which replaced TodoWrite: the list is the fold
 * of every call, keyed by the id the create call's result announces ("Task #3 created…").
 */
class TaskBoard {
  private readonly tasks = new Map<string, NativeChatTaskList['tasks'][number]>()
  private created = 0

  apply(name: string, tool: ToolItem): boolean {
    const input = record(tool.input)
    if (name === 'TaskCreate') {
      this.created += 1
      const id = /#(\d+)/.exec(tool.output)?.[1] ?? String(this.created)
      const content = text(input.subject) ?? text(input.description) ?? `Task ${id}`
      const activeForm = text(input.activeForm)
      this.tasks.set(id, { content, status: 'pending', ...(activeForm ? { activeForm } : {}) })
      return true
    }
    if (name !== 'TaskUpdate') return false
    const id = text(input.taskId)
    const task = id ? this.tasks.get(id) : undefined
    if (!id || !task) return true
    if (input.status === 'deleted') {
      this.tasks.delete(id)
      return true
    }
    const status = input.status === 'in_progress' || input.status === 'completed' || input.status === 'pending' ? input.status : task.status
    const activeForm = text(input.activeForm) ?? task.activeForm
    this.tasks.set(id, { content: text(input.subject) ?? task.content, status, ...(activeForm ? { activeForm } : {}) })
    return true
  }

  snapshot(): NativeChatTaskList {
    return { tasks: [...this.tasks.values()] }
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** A title or path with the workspace's own prefix dropped, the way Orca shows workspace files. */
export function shortenPaths(value: string, cwd: string): string {
  if (!cwd) return value
  const variants = [cwd, cwd.replaceAll('\\', '/'), cwd.replaceAll('/', '\\')]
  let out = value
  for (const root of new Set(variants)) {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`${escaped}[\\\\/]`, 'gi'), '')
  }
  return out
}

/** Claude reports absolute paths; the workspace's own files read (and open) relative to it. */
export function workspaceRelative(path: string, cwd: string): string {
  const file = path.replaceAll('\\', '/')
  const root = cwd.replaceAll('\\', '/').replace(/\/$/, '')
  return file.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? file.slice(root.length + 1) : file
}

export function filePathOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const fields = Object.fromEntries(Object.entries(input))
  const path = fields.file_path ?? fields.path ?? fields.notebook_path
  return typeof path === 'string' ? path : null
}
