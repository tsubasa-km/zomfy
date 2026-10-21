import { diffFromToolCall, type NativeChatDiffLine } from '@/shared/native-chat-diff'
import type { ThreadItem } from '@/session-store'
import {
  isTaskListTool,
  normalizeNativeChatTaskList,
  type NativeChatTaskList
} from './native-chat-task-list'

export type ToolItem = Extract<ThreadItem, { kind: 'tool' }>
export type UserItem = Extract<ThreadItem, { kind: 'user' }>

/** A top-level tool call; a Task call carries the calls its subagent made. */
export type ToolNode = { tool: ToolItem; children: ToolItem[] }

export type TurnDiffFile = { path: string; added: number; removed: number; edits: NativeChatDiffLine[][] }
export type TurnDiff = { files: TurnDiffFile[]; added: number; removed: number }

export type TranscriptRowModel =
  | { kind: 'user'; item: UserItem }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tools'; tools: ToolNode[] }
  | { kind: 'tasks'; list: NativeChatTaskList; previous: NativeChatTaskList | null }
  | { kind: 'decision'; title: string; chosen: string }
  | { kind: 'notice'; text: string; severity?: string }
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
        if (item.status === 'completed') turnEdits.push(item)
        const node: ToolNode = { tool: item, children: children.get(item.id) ?? [] }
        const last = rows.at(-1)
        if (last?.kind === 'tools') last.tools.push(node)
        else rows.push({ kind: 'tools', tools: [node] })
        break
      }
      case 'permission':
        if (item.chosen) rows.push({ kind: 'decision', title: item.title, chosen: item.chosen })
        break
      case 'user':
        closeTurn()
        rows.push({ kind: 'user', item })
        break
      case 'agent':
      case 'thought':
        rows.push({ kind: item.kind, text: item.text })
        break
      case 'notice':
        rows.push({ kind: 'notice', text: item.text, ...(item.severity ? { severity: item.severity } : {}) })
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
