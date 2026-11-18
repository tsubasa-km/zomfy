import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import { HANDOFF_CLOSE, HANDOFF_OPEN } from './agent-handoff.ts'
import { chatAgentLaunch } from './chat-agent-launch-settings.ts'
import type { AgentConversation } from './agent-conversations.ts'

// Codex's own record of its threads, read and never written: one "rollout" per thread under
// `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl` (older ones zstd-compressed),
// a JSON record per line. The first record (`session_meta`) names the thread, its folder and branch.
// The thread id is what codex-acp takes as an ACP session id, so an imported thread reopens natively.

/** Newest rollouts looked at per listing; older threads are left out. */
const MAX_ROLLOUTS = 600
/** How much of a rollout a listing reads: its `session_meta` and, almost always, the first prompt. */
const HEAD_BYTES = 512 * 1024
/** A rollout larger than this is not read back as a transcript. */
const MAX_ROLLOUT_BYTES = 256 * 1024 * 1024
/** A command's output past this keeps its start; the thread's transcript is for reading, not replaying. */
const TOOL_OUTPUT_CHARS = 8_000
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** `rollout-<time>-<thread id>.jsonl`; a rewound thread's later rollouts end in `<thread id>_<rollout id>`. */
const ROLLOUT_NAME = new RegExp(`^rollout-.*-(${UUID})(?:_(${UUID}))?\\.jsonl(\\.zst)?$`, 'i')

type Json = Record<string, unknown>

interface RolloutFile {
  path: string
  /** The id other rollouts name this one by: the last id in its file name. */
  rolloutId: string
  mtimeMs: number
  size: number
}

interface RolloutSummary extends AgentConversation {
  path: string
}

/** A listing's reading of one rollout, kept until the file changes; null for one that is no thread to list. */
const summaries = new Map<string, { mtimeMs: number; size: number; summary: RolloutSummary | null }>()

/** `CODEX_HOME` as this host's Codex chats run with it, else the process's own, else `~/.codex`. */
export async function codexHome(): Promise<string> {
  return (await chatAgentLaunch('codex')).env.CODEX_HOME || process.env.CODEX_HOME || join(homedir(), '.codex')
}

/** Codex's threads, newest first; `inFolder` (told whether a cwd is the wanted one) keeps one folder's. */
export async function listCodexConversations(inFolder: ((cwd: string) => boolean) | null, limit: number): Promise<AgentConversation[]> {
  const home = await codexHome()
  const names = await threadNames(home)
  const listed = new Map<string, AgentConversation>()
  for (const file of await rolloutFiles(home)) {
    const summary = await summaryOf(file)
    if (!summary || listed.has(summary.conversationId)) continue
    if (inFolder && !(summary.cwd && inFolder(summary.cwd))) continue
    const { path: _path, ...conversation } = summary
    listed.set(summary.conversationId, { ...conversation, title: names.get(summary.conversationId) ?? summary.title })
    if (listed.size >= limit) break
  }
  return [...listed.values()]
}

export async function findCodexConversation(conversationId: string): Promise<AgentConversation | null> {
  const found = await findRollout(conversationId)
  if (!found) return null
  const { path: _path, ...conversation } = found.summary
  const name = (await threadNames(found.home)).get(conversationId)
  return { ...conversation, title: name ?? conversation.title }
}

/** A thread on disk as the ACP updates a live turn would have sent. */
export async function codexConversationUpdates(conversationId: string): Promise<acp.SessionUpdate[]> {
  const found = await findRollout(conversationId)
  if (!found) throw new Error(`Codex has no thread ${conversationId} on this host`)
  const { file } = found
  if (file.size > MAX_ROLLOUT_BYTES) throw new Error('This Codex thread is too large to import')
  const own = parseRecords(await readRollout(file.path))
  return codexUpdates([...(await inheritedRecords(own, found.files)), ...own])
}

async function findRollout(conversationId: string): Promise<{ home: string; file: RolloutFile; files: RolloutFile[]; summary: RolloutSummary } | null> {
  const home = await codexHome()
  const files = await rolloutFiles(home)
  // A thread's rollouts carry its id in their names; the newest one holds the thread as it is now.
  for (const file of files) {
    if (!file.path.toLowerCase().includes(conversationId.toLowerCase())) continue
    const summary = await summaryOf(file)
    if (summary?.conversationId === conversationId) return { home, file, files, summary }
  }
  return null
}

/** Rollout files, newest first, by the dated folders and then by when each was last written. */
async function rolloutFiles(home: string): Promise<RolloutFile[]> {
  const root = join(home, 'sessions')
  const newestFirst = async (dir: string): Promise<string[]> => (await readdir(dir).catch((): string[] => [])).sort().reverse()
  const files: RolloutFile[] = []
  scan: for (const year of await newestFirst(root)) {
    for (const month of await newestFirst(join(root, year))) {
      for (const day of await newestFirst(join(root, year, month))) {
        const dir = join(root, year, month, day)
        for (const name of await newestFirst(dir)) {
          const match = ROLLOUT_NAME.exec(name)
          if (!match) continue
          const info = await stat(join(dir, name)).catch(() => null)
          if (!info?.isFile()) continue
          files.push({ path: join(dir, name), rolloutId: (match[2] ?? match[1] ?? '').toLowerCase(), mtimeMs: info.mtimeMs, size: info.size })
          if (files.length >= MAX_ROLLOUTS) break scan
        }
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function summaryOf(file: RolloutFile): Promise<RolloutSummary | null> {
  const cached = summaries.get(file.path)
  if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) return cached.summary
  const summary = await readSummary(file).catch(() => null)
  summaries.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, summary })
  return summary
}

async function readSummary(file: RolloutFile): Promise<RolloutSummary | null> {
  const head = await readRollout(file.path, HEAD_BYTES)
  const whole = !file.path.endsWith('.zst') && file.size <= HEAD_BYTES
  // A head that stops mid-record ends in half a line.
  const records = parseRecords(whole || head.endsWith('\n') ? head : head.slice(0, head.lastIndexOf('\n') + 1))
  const meta = records.find((r) => r.type === 'session_meta')
  const payload = record(meta?.payload)
  if (!payload) return null
  // A subagent's thread is part of the thread that started it, not one the person had.
  const source = record(payload.source)
  if (source && ('subagent' in source || 'subAgent' in source)) return null
  const conversationId = text(payload.id) || text(payload.session_id) || ROLLOUT_NAME.exec(file.path.split(/[\\/]/).at(-1) ?? '')?.[1]
  if (!conversationId) return null
  const updates = codexUpdates(records)
  const prompt = updates.flatMap((u) => (u.sessionUpdate === 'user_message_chunk' && u.content.type === 'text' ? [u.content.text] : []))[0]
  // The whole file was read and nobody said anything in it: a thread opened and left.
  if (prompt === undefined && (whole || file.path.endsWith('.zst')) && !updates.some((u) => u.sessionUpdate === 'agent_message_chunk')) return null
  return {
    path: file.path,
    conversationId,
    title: titleOf(prompt ?? ''),
    lastModified: Math.round(file.mtimeMs),
    cwd: text(payload.cwd) || null,
    gitBranch: text(record(payload.git)?.branch) || null
  }
}

/** The names threads were given (`session_index.jsonl` gets a line per rename; the newest counts). */
async function threadNames(home: string): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const lines = await readFile(join(home, 'session_index.jsonl'), 'utf8').catch(() => '')
  for (const entry of parseRecords(lines)) {
    const [id, name] = [text(entry.id), text(entry.thread_name)]
    if (id && name) names.set(id, name)
  }
  return names
}

/**
 * What a rewound thread's rollout inherits: it continues in a new file that names the rollout it
 * replaced and how many of that one's bytes still stand. Oldest first; none when a link is missing.
 */
async function inheritedRecords(records: Json[], files: RolloutFile[]): Promise<Json[]> {
  const inherited: Json[][] = []
  const seen = new Set<string>()
  let base = historyBase(records)
  while (base) {
    const file = files.find((f) => f.rolloutId === base?.rolloutId)
    if (!file || seen.has(file.path) || file.size > MAX_ROLLOUT_BYTES) return []
    seen.add(file.path)
    const bytes = Buffer.from(await readRollout(file.path), 'utf8').subarray(0, base.bytes)
    const prefix = parseRecords(bytes.toString('utf8'))
    inherited.unshift(prefix.filter((r) => r.type !== 'session_meta'))
    base = historyBase(prefix)
  }
  return inherited.flat()
}

function historyBase(records: Json[]): { rolloutId: string; bytes: number } | null {
  const base = record(record(records.find((r) => r.type === 'session_meta')?.payload)?.history_base)
  const [rolloutId, bytes] = [text(base?.thread_id), base?.end_byte_offset]
  return rolloutId && typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0 ? { rolloutId: rolloutId.toLowerCase(), bytes } : null
}

/** A rollout's text, decompressed; `limit` reads only that many bytes from the start of a plain one. */
async function readRollout(path: string, limit?: number): Promise<string> {
  if (path.endsWith('.zst')) return new TextDecoder().decode(await Bun.zstdDecompress(await readFile(path)))
  if (limit === undefined) return readFile(path, 'utf8')
  const file = await open(path, 'r')
  try {
    const { bytesRead, buffer } = await file.read(Buffer.alloc(limit), 0, limit, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
}

/** One record per line; a line that is not a JSON object (a write cut short) is skipped. */
function parseRecords(lines: string): Json[] {
  const records: Json[] = []
  for (const line of lines.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = record(JSON.parse(line))
      if (parsed) records.push(parsed)
    } catch {
      // Not a record.
    }
  }
  return records
}

/**
 * A rollout's records as ACP updates. Codex wrote the same message in more than one shape over its
 * releases, and current rollouts hold several at once: `item_completed` events (what its own UI
 * shows), the `user_message` / `agent_message` events before those, and the raw `response_item`s
 * sent to the model, whose user messages also carry context the person never typed.
 */
export function codexUpdates(records: Json[]): acp.SessionUpdate[] {
  const events = records.flatMap((r) => (r.type === 'event_msg' ? [record(r.payload) ?? {}] : []))
  // With the person's prompts recorded as such, the model's copy of them is not read.
  const hasPrompts = events.some((p) => p.type === 'user_message' || (p.type === 'item_completed' && record(p.item)?.type === 'UserMessage'))
  // From the first item on, items tell what the agent said and did; a thread begun on an older
  // Codex has only response items before that.
  let itemsSeen = false
  const updates: acp.SessionUpdate[] = []
  let prompts = 0
  // What was already taken since the other side last spoke: the same message in another shape is dropped.
  let saidByUser = new Set<string>()
  let saidByAgent = new Set<string>()
  const user = (value: string): void => {
    // A chat this app handed to Codex opened with the conversation so far, which the person never typed.
    const handedOver = value.trimStart().startsWith(HANDOFF_OPEN) ? value.indexOf(HANDOFF_CLOSE) : -1
    const said = (handedOver === -1 ? value : value.slice(handedOver + HANDOFF_CLOSE.length)).trim()
    if (!said || saidByUser.has(said)) return
    saidByUser.add(said)
    saidByAgent = new Set()
    updates.push({ sessionUpdate: 'user_message_chunk', messageId: `imported-${++prompts}`, content: { type: 'text', text: said } })
  }
  const agent = (value: string): void => {
    const said = value.trim()
    if (!said || saidByAgent.has(said)) return
    saidByAgent.add(said)
    saidByUser = new Set()
    // Two messages in a row would otherwise run together as one paragraph.
    const follows = updates.at(-1)?.sessionUpdate === 'agent_message_chunk'
    updates.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: follows ? `\n\n${said}` : said } })
  }
  const thought = (value: string): void => {
    if (value.trim()) updates.push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: value.trim() } })
  }
  const calls = new Set<string>()
  const call = (id: string, fields: { title: string; kind: acp.ToolKind; rawInput?: unknown; locations?: acp.ToolCallLocation[] }): void => {
    if (!id || calls.has(id)) return
    calls.add(id)
    updates.push({ sessionUpdate: 'tool_call', toolCallId: id, status: 'in_progress', ...fields })
  }
  const result = (id: string, failed: boolean, output: string): void => {
    if (!calls.has(id)) return
    updates.push({
      sessionUpdate: 'tool_call_update',
      toolCallId: id,
      status: failed ? 'failed' : 'completed',
      ...(output.trim() ? { content: [{ type: 'content', content: { type: 'text', text: clip(output) } }] } : {})
    })
  }

  for (const entry of records) {
    const payload = record(entry.payload)
    if (!payload) continue
    if (entry.type === 'event_msg') {
      if (payload.type === 'user_message') user(text(payload.message))
      else if (payload.type === 'agent_message') agent(text(payload.message))
      else if (payload.type === 'item_completed') {
        itemsSeen = true
        const item = record(payload.item)
        if (!item) continue
        const id = text(item.id)
        if (item.type === 'UserMessage') user(blockText(item.content))
        else if (item.type === 'AgentMessage') agent(blockText(item.content))
        else if (item.type === 'Reasoning') thought(blockText(item.summary_text))
        else if (item.type === 'CommandExecution') {
          const command = commandLine(item.command)
          call(id, { title: firstLine(command) || 'Command', kind: 'execute', rawInput: { command, ...(text(item.cwd) ? { cwd: text(item.cwd) } : {}) } })
          const exit = item.exit_code
          result(id, (typeof exit === 'number' && exit !== 0) || /fail|declin|error/i.test(text(item.status)), text(item.aggregated_output))
        } else if (item.type === 'McpToolCall') {
          call(id, { title: `${text(item.server) || 'mcp'}: ${text(item.tool) || 'tool'}`, kind: 'other', rawInput: item.arguments })
          result(id, item.error != null || /fail|error/i.test(text(item.status)), '')
        }
      }
      continue
    }
    if (entry.type !== 'response_item') continue
    const id = text(payload.call_id)
    if (payload.type === 'message' && payload.role === 'user') {
      if (hasPrompts) continue
      for (const block of blocks(payload.content)) if (!isContextBlock(block)) user(block)
    } else if (itemsSeen) {
      // The items already tell this.
    } else if (payload.type === 'message' && payload.role === 'assistant') agent(blockText(payload.content))
    else if (payload.type === 'reasoning') thought(blockText(payload.summary))
    else if (payload.type === 'function_call') {
      const input = parsed(payload.arguments)
      const command = commandLine(record(input)?.command ?? record(input)?.cmd)
      if (command) call(id, { title: firstLine(command), kind: 'execute', rawInput: { command } })
      else call(id, { title: text(payload.name) || 'Tool', kind: 'other', rawInput: input })
    } else if (payload.type === 'local_shell_call') {
      const command = commandLine(record(payload.action)?.command)
      call(id, { title: firstLine(command) || 'Command', kind: 'execute', rawInput: { command } })
    } else if (payload.type === 'custom_tool_call') {
      const input = text(payload.input)
      const paths = text(payload.name) === 'apply_patch' ? [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => (m[1] ?? '').trim()) : []
      if (paths.length > 0) call(id, { title: `Edit ${paths.join(', ')}`, kind: 'edit', locations: paths.map((path) => ({ path })), rawInput: { patch: input } })
      else call(id, { title: text(payload.name) || 'Tool', kind: 'other', rawInput: { input } })
    } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      // Shell output comes wrapped: `{"output": "...", "metadata": {"exit_code": 0}}`.
      const wrapped = record(parsed(payload.output))
      const exit = record(wrapped?.metadata)?.exit_code
      result(id, typeof exit === 'number' && exit !== 0, wrapped && typeof wrapped.output === 'string' ? wrapped.output : blockText(payload.output))
    }
  }
  return updates
}

/** The thread's name when Codex has none for it: the first line of the first thing the person asked. */
function titleOf(prompt: string): string {
  return firstLine(prompt.replace(/^\s*## My request for Codex:\s*/i, '')).slice(0, 100).trim() || 'Untitled'
}

/** Context Codex puts in the model's copy of a user turn: instructions, the environment, what an app shows. */
function isContextBlock(block: string): boolean {
  const trimmed = block.trim()
  const tag = /^<([A-Za-z_][\w-]*)[\s>]/.exec(trimmed)?.[1]
  return (!!tag && trimmed.endsWith(`</${tag}>`)) || trimmed.startsWith('# AGENTS.md instructions')
}

/** The text parts of a message's content: a string, or blocks typed `text`, `input_text`, `output_text`, `summary_text`. */
function blocks(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.flatMap((block): string[] => {
    if (typeof block === 'string') return [block]
    const part = record(block)
    return part && typeof part.text === 'string' && /text$/i.test(text(part.type) || 'text') ? [part.text] : []
  })
}

function blockText(content: unknown): string {
  return blocks(content)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
}

function commandLine(command: unknown): string {
  if (typeof command === 'string') return command
  if (!Array.isArray(command)) return ''
  const parts = command.filter((part): part is string => typeof part === 'string')
  // `bash -lc "<script>"`: the script is the command the person would recognise.
  const script = parts.length === 3 && /^(-l?c|\/c|-Command)$/i.test(parts[1] ?? '') ? parts[2] : undefined
  return script ?? parts.join(' ')
}

function firstLine(value: string): string {
  const line = value.trim().split('\n')[0] ?? ''
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

function clip(output: string): string {
  return output.length > TOOL_OUTPUT_CHARS ? `${output.slice(0, TOOL_OUTPUT_CHARS)}\n[… ${output.length - TOOL_OUTPUT_CHARS} more characters in Codex's own record]` : output
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null
}
