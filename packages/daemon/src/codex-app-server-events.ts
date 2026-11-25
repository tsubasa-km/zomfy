import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META, QUESTION_OPTION_IDS } from '@zomfy/protocol'
import { answersOf, QUESTION_OPTIONS, QUESTION_TOOL } from './ask-user-question.ts'
import { fields, list, string, type CodexFields } from './codex-app-server-rpc.ts'

const OUTPUT_CHARS = 24_000

interface Tool {
  kind: acp.ToolKind
  title: string
  rawInput?: unknown
}

export class CodexTurnEvents {
  private readonly messages = new Set<string>()
  private readonly tools = new Set<string>()
  private readonly commandOutput = new Map<string, string>()

  constructor(private readonly emit: (update: acp.SessionUpdate) => Promise<void>) {}

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
          await this.emit({ sessionUpdate: 'tool_call_update', toolCallId: itemId, content: outputText(output) })
        }
        break
    }
  }

  private async item(item: CodexFields, complete: boolean): Promise<void> {
    const id = string(item.id)
    if (!id) return
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

export async function codexServerRequest(
  method: string,
  params: CodexFields,
  ask: (request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>
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
      const response = await permission(QUESTION_TOOL, 'other', { questions }, QUESTION_OPTIONS)
      if (response.outcome.outcome !== 'selected' || response.outcome.optionId !== QUESTION_OPTION_IDS.answer) return { answers: {} }
      const reply = answersOf(response)
      return { answers: Object.fromEntries(questions.flatMap(({ id, question, options, allowOther }) => {
        const answer = reply && Object.hasOwn(reply, question) ? reply[question] : undefined
        return answer && (allowOther || options.some((option) => option.label === answer)) ? [[id, { answers: [answer] }]] : []
      })) }
    }
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null }
    default:
      throw new Error(`Unsupported Codex App Server request: ${method}`)
  }
}
