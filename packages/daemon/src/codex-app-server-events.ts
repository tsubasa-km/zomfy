import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META, MCP_TOOL_APPROVAL_META, QUESTION_OPTION_IDS, type McpToolApproval } from '@zomfy/protocol'
import { answersOf, QUESTION_OPTIONS, QUESTION_TOOL } from './ask-user-question.ts'
import { fields, list, string, type CodexFields } from './codex-app-server-rpc.ts'

const OUTPUT_CHARS = 24_000
/** A running command's output reaches the chat at most this often; its completion carries the rest. */
const OUTPUT_INTERVAL_MS = 1_000

interface Tool {
  kind: acp.ToolKind
  title: string
  rawInput?: unknown
}

export class CodexTurnEvents {
  private readonly messages = new Set<string>()
  private readonly tools = new Set<string>()
  private readonly commandOutput = new Map<string, string>()
  private readonly outputSent = new Map<string, number>()
  private readonly outputTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly emit: (update: acp.SessionUpdate) => Promise<void>,
    private readonly outputIntervalMs = OUTPUT_INTERVAL_MS
  ) {}

  async update(method: string, params: CodexFields): Promise<void> {
    const itemId = string(params.itemId)
    switch (method) {
      case 'item/agentMessage/delta':
        if (itemId && string(params.delta)) {
          this.messages.add(itemId)
          await this.message('agent_message_chunk', itemId, string(params.delta))
        }
        break
      case 'item/reasoning/summaryTextDelta':
        if (itemId && string(params.delta)) await this.message('agent_thought_chunk', itemId, string(params.delta))
        break
      case 'turn/plan/updated':
        await this.emit({
          sessionUpdate: 'plan',
          entries: list(params.plan).map(fields).filter((entry) => string(entry.step)).map((entry) => ({
            content: string(entry.step),
            priority: 'medium',
            status: entry.status === 'inProgress' ? 'in_progress' : entry.status === 'completed' ? 'completed' : 'pending'
          }))
        })
        break
      case 'item/started':
      case 'item/completed':
        await this.item(fields(params.item), method === 'item/completed')
        break
      case 'item/commandExecution/outputDelta':
        if (this.tools.has(itemId) && string(params.delta)) {
          const output = tail((this.commandOutput.get(itemId) ?? '') + string(params.delta))
          this.commandOutput.set(itemId, output)
          await this.sendOutput(itemId)
        }
        break
    }
  }

  /** Drops output still waiting to be sent: the turn is over. */
  close(): void {
    for (const timer of this.outputTimers.values()) clearTimeout(timer)
    this.outputTimers.clear()
  }

  /** Sends a running command's output now, or once the interval since the last send has passed. */
  private async sendOutput(id: string): Promise<void> {
    if (this.outputTimers.has(id)) return
    const wait = (this.outputSent.get(id) ?? -Infinity) + this.outputIntervalMs - Date.now()
    if (wait > 0) {
      this.outputTimers.set(id, setTimeout(() => {
        this.outputTimers.delete(id)
        void this.sendOutput(id)
      }, wait))
      return
    }
    const output = this.commandOutput.get(id)
    if (output === undefined) return
    this.outputSent.set(id, Date.now())
    await this.emit({ sessionUpdate: 'tool_call_update', toolCallId: id, content: outputText(output) })
  }

  private async item(item: CodexFields, complete: boolean): Promise<void> {
    const id = string(item.id)
    if (!id) return
    if (complete) {
      clearTimeout(this.outputTimers.get(id))
      this.outputTimers.delete(id)
      this.outputSent.delete(id)
    }
    if (item.type === 'agentMessage') {
      if (complete && !this.messages.has(id) && string(item.text)) await this.message('agent_message_chunk', id, string(item.text))
      return
    }
    const tool = toolOf(item)
    if (!tool) return
    const failed = item.status === 'failed' || item.status === 'declined' || item.status === 'interrupted' || item.success === false
    const status = complete ? (failed ? 'failed' : 'completed') : 'in_progress'
    const output = string(item.aggregatedOutput) || this.commandOutput.get(id)
    const update = {
      toolCallId: id,
      ...tool,
      status,
      ...(output ? { content: outputText(tail(output)) } : {})
    } satisfies Omit<acp.ToolCall, 'locations'>
    if (this.tools.has(id)) {
      await this.emit({ sessionUpdate: 'tool_call_update', ...update })
    } else {
      this.tools.add(id)
      await this.emit({ sessionUpdate: 'tool_call', ...update })
    }
    if (complete) this.commandOutput.delete(id)
  }

  private message(sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk', messageId: string, text: string): Promise<void> {
    return this.emit({ sessionUpdate, messageId, content: { type: 'text', text } })
  }
}

function toolOf(item: CodexFields): Tool | null {
  switch (item.type) {
    case 'commandExecution':
      return { kind: 'execute', title: string(item.command) || 'Run command', rawInput: { command: item.command, cwd: item.cwd } }
    case 'fileChange':
      return { kind: 'edit', title: 'Change files', rawInput: { changes: item.changes } }
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return { kind: 'other', title: string(item.tool) || 'Call tool', rawInput: item.arguments }
    case 'webSearch':
      return { kind: 'search', title: string(item.query) || 'Search the web' }
    case 'collabAgentToolCall':
    case 'collabToolCall':
      return { kind: 'other', title: string(item.tool) || 'Agent collaboration' }
    default:
      return null
  }
}

function tail(text: string): string {
  if (text.length <= OUTPUT_CHARS) return text
  return text.slice(-OUTPUT_CHARS)
}

function outputText(text: string): acp.ToolCallContent[] {
  return [{ type: 'content', content: { type: 'text', text } }]
}

const APPROVAL_OPTIONS: acp.PermissionOption[] = [
  { kind: 'allow_once', name: 'Allow once', optionId: 'accept' },
  { kind: 'allow_always', name: 'Allow for this session', optionId: 'acceptForSession' },
  { kind: 'reject_once', name: 'Decline', optionId: 'decline' },
  { kind: 'reject_once', name: 'Cancel', optionId: 'cancel' }
]

/** What an MCP elicitation needs to know of the turn: the tool call the server is running. */
export interface McpElicitationContext {
  mcpCall(server: string): { id: string; tool: string } | null
  nextElicitationId(): string
}

const NO_MCP_CONTEXT: McpElicitationContext = { mcpCall: () => null, nextElicitationId: () => 'elicitation' }

const MCP_APPROVAL_IDS = { once: 'accept', session: 'acceptForSession', cancel: 'cancel' } as const

/**
 * Codex asking to run an MCP tool comes as an elicitation with no fields: it is an approval card,
 * which the daemon answers itself for the harness's own auto-allowed tools. Other elicitations
 * (forms with fields, URLs) are declined.
 */
async function mcpElicitation(
  params: CodexFields,
  ask: (request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>,
  context: McpElicitationContext
): Promise<unknown> {
  const declined = { action: 'decline', content: null, _meta: null }
  const meta = fields(params._meta)
  const schema = params.requestedSchema
  const form = params.mode === 'form' || params.mode === 'openai/form' || params.mode === 'openaiForm'
  const noFields = schema === null || schema === undefined
    || (fields(schema).type === 'object' && Object.keys(fields(fields(schema).properties)).length === 0)
  if (meta.codex_approval_kind !== 'mcp_tool_call' || !form || !noFields) return declined
  const server = string(params.serverName)
  const call = context.mcpCall(server)
  const tool = call?.tool ?? ''
  const persist = Array.isArray(meta.persist) ? list(meta.persist) : [meta.persist]
  const options: acp.PermissionOption[] = [
    { kind: 'allow_once', name: 'Allow', optionId: MCP_APPROVAL_IDS.once },
    ...(persist.includes('session') ? [{ kind: 'allow_always' as const, name: 'Allow for this session', optionId: MCP_APPROVAL_IDS.session }] : []),
    { kind: 'reject_once', name: 'Cancel', optionId: MCP_APPROVAL_IDS.cancel }
  ]
  const approval: McpToolApproval = { server, tool }
  const response = await ask({
    sessionId: string(params.threadId),
    options,
    toolCall: {
      toolCallId: call?.id || context.nextElicitationId(),
      title: tool ? `mcp.${server}.${tool}` : `mcp.${server}`,
      kind: 'execute',
      rawInput: { server, tool, message: string(params.message) }
    },
    _meta: { [MCP_TOOL_APPROVAL_META]: approval }
  })
  const outcome = response.outcome
  if (outcome.outcome !== 'selected') return { action: 'cancel', content: null, _meta: null }
  if (outcome.optionId === MCP_APPROVAL_IDS.once) return { action: 'accept', content: null, _meta: null }
  if (outcome.optionId === MCP_APPROVAL_IDS.session && persist.includes('session')) return { action: 'accept', content: null, _meta: { persist: 'session' } }
  return { action: 'cancel', content: null, _meta: null }
}

export async function codexServerRequest(
  method: string,
  params: CodexFields,
  ask: (request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>,
  mcp: McpElicitationContext = NO_MCP_CONTEXT
): Promise<unknown> {
  const sessionId = string(params.threadId)
  const toolCallId = string(params.itemId)
  const permission = (title: string, kind: acp.ToolKind, rawInput: unknown, options: acp.PermissionOption[]) =>
    ask({
      sessionId, options,
      toolCall: {
        toolCallId, title, kind, rawInput,
        ...(title === QUESTION_TOOL ? { _meta: { [CHAT_META.toolName]: QUESTION_TOOL } } : {})
      }
    })

  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval': {
      const command = method === 'item/commandExecution/requestApproval'
      const network = fields(params.networkApprovalContext)
      const host = string(network.host)
      const title = host
        ? `Network access to ${host}`
        : command ? string(params.command) || 'Run command' : 'Change files'
      const allowed = Array.isArray(params.availableDecisions)
        ? APPROVAL_OPTIONS.filter((option) => list(params.availableDecisions).includes(option.optionId))
        : APPROVAL_OPTIONS
      if (!allowed.length) return { decision: 'cancel' }
      const response = await permission(title, host ? 'fetch' : command ? 'execute' : 'edit', {
        command: params.command, cwd: params.cwd, reason: params.reason, path: params.grantRoot, network: params.networkApprovalContext
      }, allowed)
      const outcome = response.outcome
      return { decision: outcome.outcome === 'selected' && allowed.some((o) => o.optionId === outcome.optionId) ? outcome.optionId : 'cancel' }
    }
    case 'item/permissions/requestApproval': {
      const response = await permission('Grant Codex permissions', 'other', { reason: params.reason, permissions: params.permissions }, [
        APPROVAL_OPTIONS[0]!, APPROVAL_OPTIONS[2]!
      ])
      const allowed = response.outcome.outcome === 'selected' && response.outcome.optionId === 'accept'
      return { permissions: allowed ? fields(params.permissions) : {}, scope: 'turn' }
    }
    case 'item/tool/requestUserInput': {
      const questions = list(params.questions).map(fields).flatMap((item) => {
        const id = string(item.id)
        const question = string(item.question)
        const options = list(item.options).map(fields).filter((option) => string(option.label))
        return id && question && item.isSecret !== true
          ? [{ id, question, header: string(item.header), options, allowOther: item.isOther === true || options.length === 0 }]
          : []
      })
      if (questions.length === 0) return { answers: {} }
      // Chat clients answer by question text, so each question shown must read differently.
      const seen = new Map<string, number>()
      for (const entry of questions) {
        const count = (seen.get(entry.question) ?? 0) + 1
        seen.set(entry.question, count)
        if (count > 1) entry.question = `${entry.question} (${entry.header || count})`
        while (questions.some((other) => other !== entry && other.question === entry.question)) entry.question += ` (${count})`
      }
      const response = await permission(QUESTION_TOOL, 'other', { questions }, QUESTION_OPTIONS)
      if (response.outcome.outcome !== 'selected' || response.outcome.optionId !== QUESTION_OPTION_IDS.answer) return { answers: {} }
      const reply = answersOf(response)
      return { answers: Object.fromEntries(questions.flatMap(({ id, question, options, allowOther }) => {
        const answer = reply && Object.hasOwn(reply, question) ? reply[question] : undefined
        return answer && (allowOther || options.some((option) => option.label === answer)) ? [[id, { answers: [answer] }]] : []
      })) }
    }
    case 'mcpServer/elicitation/request':
      return mcpElicitation(params, ask, mcp)
    default:
      throw new Error(`Unsupported Codex App Server request: ${method}`)
  }
}
