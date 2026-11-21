import { diffFromToolCall, type NativeChatDiffLine } from '@/shared/native-chat-diff'
import type { TurnEndMeta } from '@acp-harness/protocol'
import type { ThreadItem } from '@/session-store'
import { EXPIRED_APPROVAL } from '@/lib/expired-approval'
import { QUESTION_OPTION_IDS } from '@acp-harness/protocol'
import { questionsToAnswer } from './agent-questions'
import {
  isTaskListTool,
  normalizeNativeChatTaskList,
  type NativeChatTaskList
} from './native-chat-task-list'
import { splitTaskNotifications } from './native-chat-task-notification'
import { t } from '@/i18n/i18n'

export type ToolItem = Extract<ThreadItem, { kind: 'tool' }>
export type UserItem = Extract<ThreadItem, { kind: 'user' }>

/** A top-level tool call; a Task call carries the calls its subagent made. */
/** `decision` is the approval asked for this call, when there was one. */
export type ToolNode = { tool: ToolItem; children: ToolItem[]; decision?: { title: string; outcome: ApprovalOutcome } }

/**
 * How an answered approval ended; 'expired' when nobody answered before its ask went away.
 * An agent's questions are 'answered' or 'skipped'.
 */
export type ApprovalOutcome = 'allowed' | 'rejected' | 'expired' | 'answered' | 'skipped'

export function approvalOutcome(item: Extract<ThreadItem, { kind: 'permission' }>): ApprovalOutcome {
  if (item.chosen === EXPIRED_APPROVAL) return 'expired'
  if (item.answers) return 'answered'
  if (questionsToAnswer(item).length > 0 && item.chosen === QUESTION_OPTION_IDS.skip) return 'skipped'
  const option = item.options.find((o) => o.optionId === item.chosen)
  // Other agents name their options freely; the kind says what the pick meant.
  if (option) return option.kind.startsWith('reject') ? 'rejected' : 'allowed'
  return item.chosen === 'reject' ? 'rejected' : 'allowed'
}

export type TurnDiffFile = { path: string; added: number; removed: number; edits: NativeChatDiffLine[][] }
export type TurnDiff = { files: TurnDiffFile[]; added: number; removed: number }

export type TranscriptRowModel =
  | { kind: 'user'; item: UserItem }
  | { kind: 'background'; status: string | null; summary: string }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tools'; tools: ToolNode[] }
  | { kind: 'tasks'; list: NativeChatTaskList; previous: NativeChatTaskList | null; fromBoard?: boolean }
  | { kind: 'decision'; title: string; outcome: ApprovalOutcome }
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

/** Each top-level tool call's subagent calls, in order, from `items[from]` on. */
function childrenOf(items: readonly ThreadItem[], from = 0): Map<string, ToolItem[]> {
  const children = new Map<string, ToolItem[]>()
  for (let i = from; i < items.length; i++) {
    const item = items[i]!
    if (item.kind === 'tool' && item.parentId) {
      const list = children.get(item.parentId)
      if (list) list.push(item)
      else children.set(item.parentId, [item])
    }
  }
  return children
}

/**
 * Groups the flat transcript the way Orca draws it: consecutive tools fold into one run, a
 * subagent's calls sit under its Task, TodoWrite reads as a task list, and each finished turn
 * that edited files ends with a changed-files rollup.
 */
export function buildTranscript(items: ThreadItem[], turnRunning: boolean, cwd: string): TranscriptModel {
  const builder = new TranscriptBuilder(cwd, true)
  const children = childrenOf(items)
  for (const item of items) builder.feed(item, children)
  return builder.finish(turnRunning)
}

/**
 * buildTranscript for one chat that is rebuilt as it streams. The items up to the latest prompt
 * do not change while a turn streams, so they are grouped once and their rows kept (the same
 * objects, which rows compare by identity); each build groups only the latest turn. A change to
 * any of those earlier items groups everything again.
 */
export function createTranscriptBuilder(): (items: ThreadItem[], turnRunning: boolean, cwd: string) => TranscriptModel {
  let cwd: string | null = null
  /** The items `settled` has grouped: none, or up to and including a prompt. */
  let settledItems: readonly ThreadItem[] = []
  let settled = new TranscriptBuilder('', true)
  return (items, turnRunning, nextCwd) => {
    const boundary = items.findLastIndex((item) => item.kind === 'user') + 1
    let reuse = nextCwd === cwd && boundary >= settledItems.length
    for (let i = 0; reuse && i < settledItems.length; i++) reuse = items[i] === settledItems[i]
    // A subagent call that arrives after its Task was settled belongs in a settled row.
    for (let i = settledItems.length; reuse && i < items.length; i++) {
      const item = items[i]!
      if (item.kind === 'tool' && item.parentId && settled.topLevelTools.has(item.parentId) && !settled.childTools.has(item)) reuse = false
    }
    if (!reuse) {
      cwd = nextCwd
      settledItems = []
      settled = new TranscriptBuilder(nextCwd, true)
    }
    if (boundary > settledItems.length) {
      const children = childrenOf(items, settledItems.length)
      const next = settled.fork(true)
      for (let i = settledItems.length; i < boundary; i++) next.feed(items[i]!, children)
      settled = next
      settledItems = items.slice(0, boundary)
    }
    const latest = settled.fork(false)
    const children = childrenOf(items, boundary)
    for (let i = boundary; i < items.length; i++) latest.feed(items[i]!, children)
    return latest.finish(turnRunning)
  }
}

/** The grouping state carried from item to item. */
class TranscriptBuilder {
  rows: TranscriptRowModel[] = []
  taskList: NativeChatTaskList | null = null
  board = new TaskBoard()
  turnEdits: ToolItem[] = []
  /** With `trackTools`: the top-level tool calls grouped, and the subagent calls put under them. */
  topLevelTools = new Set<string>()
  childTools = new Set<ToolItem>()

  constructor(
    private readonly cwd: string,
    private readonly trackTools: boolean
  ) {}

  /**
   * A builder that goes on from this one, which is left as it was. Rows made so far are shared,
   * not copied: forks are only made after a prompt, and nothing changes a row before a prompt.
   * A tracking fork takes over the tracked tools; this builder is dropped once it has one.
   */
  fork(trackTools: boolean): TranscriptBuilder {
    const copy = new TranscriptBuilder(this.cwd, trackTools)
    copy.rows = this.rows.slice()
    copy.taskList = this.taskList
    copy.board = this.board.clone()
    copy.turnEdits = this.turnEdits.slice()
    if (trackTools) {
      copy.topLevelTools = this.topLevelTools
      copy.childTools = this.childTools
    }
    return copy
  }

  private closeTurn(): void {
    const diff = turnDiff(this.turnEdits, this.cwd)
    if (diff) this.rows.push({ kind: 'turn-diff', diff })
    this.turnEdits = []
  }

  finish(turnRunning: boolean): TranscriptModel {
    if (!turnRunning) this.closeTurn()
    return { rows: this.rows, taskList: this.taskList }
  }

  feed(item: ThreadItem, children: Map<string, ToolItem[]>): void {
    const { rows } = this
    switch (item.kind) {
      case 'tool': {
        if (item.parentId) {
          if (item.status === 'completed') this.turnEdits.push(item)
          break
        }
        const name = toolNameOf(item)
        if (isTaskListTool(name)) {
          const list = normalizeNativeChatTaskList(item.input)
          if (list) {
            rows.push({ kind: 'tasks', list, previous: this.taskList })
            this.taskList = list
          }
          break
        }
        if (this.board.apply(name, item)) {
          // A burst of TaskCreate/TaskUpdate calls reads as one change to the list.
          const list = this.board.snapshot()
          const last = rows.at(-1)
          if (last?.kind === 'tasks' && last.fromBoard) last.list = list
          else rows.push({ kind: 'tasks', list, previous: this.taskList, fromBoard: true })
          this.taskList = list
          break
        }
        if (item.status === 'completed') this.turnEdits.push(item)
        const node: ToolNode = { tool: item, children: children.get(item.id) ?? [] }
        if (this.trackTools) {
          this.topLevelTools.add(item.id)
          for (const child of node.children) this.childTools.add(child)
        }
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
        const outcome = approvalOutcome(item)
        // Answered questions read as the answers given, not as the tool that asked.
        const decision = { title: outcome === 'answered' && item.answers ? Object.values(item.answers).join(' / ') : item.title, outcome }
        if (node && !node.decision) node.decision = decision
        else rows.push({ kind: 'decision', ...decision })
        break
      }
      case 'user': {
        this.closeTurn()
        const { notifications, rest } = splitTaskNotifications(item.text)
        for (const n of notifications) rows.push({ kind: 'background', ...n })
        if (notifications.length === 0 || rest || item.images?.length) rows.push({ kind: 'user', item: { ...item, text: rest } })
        break
      }
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
}

/**
 * Whether two builds of a row show the same thing. The model is rebuilt from every item on each
 * streamed chunk, so in a long chat nearly every row is new yet unchanged; those skip rendering.
 */
export function sameTranscriptRow(a: TranscriptRowModel, b: TranscriptRowModel): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'user':
      return shallowEqual(a.item, (b as typeof a).item)
    case 'tools': {
      const other = (b as typeof a).tools
      return a.tools.length === other.length && a.tools.every((node, i) => sameToolNode(node, other[i]!))
    }
    case 'tasks': {
      const other = b as typeof a
      return a.fromBoard === other.fromBoard && sameJson(a.list, other.list) && sameJson(a.previous, other.previous)
    }
    case 'turn-diff':
      // A turn's diff is made of completed edits, which no longer change.
      return sameJson(diffShape(a.diff), diffShape((b as typeof a).diff))
    default:
      return shallowEqual(a, b)
  }
}

function sameToolNode(a: ToolNode, b: ToolNode): boolean {
  return (
    a.tool === b.tool &&
    a.children.length === b.children.length &&
    a.children.every((child, i) => child === b.children[i]) &&
    shallowEqual(a.decision ?? {}, b.decision ?? {})
  )
}

function diffShape(diff: TurnDiff): unknown {
  return [diff.added, diff.removed, diff.files.map((f) => [f.path, f.added, f.removed, f.edits.length])]
}

function shallowEqual(a: object, b: object): boolean {
  const left = Object.entries(a)
  if (left.length !== Object.keys(b).length) return false
  const right = new Map(Object.entries(b))
  return left.every(([key, value]) => right.has(key) && right.get(key) === value)
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
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
      const content = text(input.subject) ?? text(input.description) ?? t('Task {id}', { id })
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

  clone(): TaskBoard {
    const copy = new TaskBoard()
    for (const [id, task] of this.tasks) copy.tasks.set(id, task)
    copy.created = this.created
    return copy
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
