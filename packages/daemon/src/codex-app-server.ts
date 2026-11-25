import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_AGENT_OPTION_IDS, type ChatAgentOption } from '@zomfy/protocol'
import { CodexTurnEvents, codexServerRequest } from './codex-app-server-events.ts'
import { CodexAppServerRpc, CodexRpcError, fields, list, string, type CodexFields } from './codex-app-server-rpc.ts'

export const CODEX_APP_SERVER_CAPABILITIES: acp.AgentCapabilities = {
  promptCapabilities: { image: true },
  mcpCapabilities: { http: true }
}

const EFFORT_OPTION = 'reasoning_effort'
type Ask = (request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>

interface TurnResult {
  stopReason: acp.StopReason
  usage?: { inputTokens: number; outputTokens: number; cachedReadTokens: number }
}

interface Turn {
  id: string | null
  interrupt: boolean
  interruptSent: boolean
  events: CodexTurnEvents
  finished: PromiseWithResolvers<TurnResult>
  usage?: TurnResult['usage']
  error?: string
}

export class CodexAppServer {
  private readonly rpc: CodexAppServerRpc
  private threadId = ''
  private active: Turn | null = null
  private model = ''
  private effort = ''
  private overrideModel = false
  private overrideEffort = false
  private models: CodexFields[] = []

  constructor(
    input: WritableStream<Uint8Array>,
    output: ReadableStream<Uint8Array>,
    private readonly emit: (update: acp.SessionUpdate) => Promise<void>,
    private readonly ask: Ask
  ) {
    this.rpc = new CodexAppServerRpc(
      input,
      output,
      (method, params) => this.notification(method, params),
      (method, params) => this.serverRequest(method, params),
      (error) => this.active?.finished.reject(error)
    )
  }

  get drained(): Promise<void> {
    return this.rpc.drained
  }

  get closed(): boolean {
    return this.rpc.closed
  }

  close(): void {
    this.rpc.close()
  }

  async open(cwd: string, previous: string | null, mcpServers: acp.McpServer[]): Promise<string> {
    await this.rpc.request('initialize', {
      clientInfo: { name: 'zomfy', title: 'Zomfy', version: '0.1.0' },
      capabilities: { experimentalApi: true }
    })
    await this.rpc.initialized()
    const { config, skipped } = mcpConfig(mcpServers)
    for (const name of skipped) {
      await this.emit({ sessionUpdate: 'notice', severity: 'warning', title: `Codex App Server cannot connect to the MCP server ${name}; it runs without it` })
    }
    const params = { cwd, ...(Object.keys(config).length ? { config } : {}) }
    const opened = await this.rpc.request(
      previous ? 'thread/resume' : 'thread/start',
      previous ? { ...params, threadId: previous, excludeTurns: true } : params
    ).catch((error: unknown) => {
      if (!previous) throw error
      throw new Error(`Codex could not resume its thread: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.threadId = string(fields(opened.thread).id)
    if (!this.threadId || (previous && this.threadId !== previous)) throw new Error('Codex App Server returned an invalid thread ID')
    this.model = string(opened.model)
    this.effort = string(opened.reasoningEffort)
    const catalog = await this.rpc.request('model/list', { limit: 100 }).catch((error: unknown): CodexFields => {
      if (this.closed) throw error
      return {}
    })
    this.models = list(catalog.data).map(fields).filter((model) => !model.hidden && modelId(model))
    return this.threadId
  }

  options(): ChatAgentOption[] {
    const modelOptions = this.models.map((model) => ({
      value: modelId(model),
      name: string(model.displayName) || modelId(model),
      description: string(model.description) || null
    }))
    if (this.model && !modelOptions.some((option) => option.value === this.model)) {
      modelOptions.unshift({ value: this.model, name: this.model, description: null })
    }
    const effortOptions = this.effortOptions()
    return [
      ...(modelOptions.length ? [{
        id: CHAT_AGENT_OPTION_IDS.model,
        name: 'Model',
        category: 'model',
        currentValue: this.model || modelId(this.models.find((model) => model.isDefault === true) ?? this.models[0] ?? {}),
        choices: modelOptions
      }] : []),
      ...(effortOptions.length ? [{
        id: EFFORT_OPTION,
        name: 'Reasoning effort',
        category: 'thought_level',
        currentValue: this.effort || string(this.selectedModel()?.defaultReasoningEffort) || effortOptions[0]!.value,
        choices: effortOptions
      }] : [])
    ]
  }

  setOption(id: string, value: string): void {
    if (!this.options().some((option) => option.id === id && option.choices.some((choice) => choice.value === value))) {
      throw new Error('Codex App Server does not offer this option')
    }
    if (id === CHAT_AGENT_OPTION_IDS.model) {
      this.model = value
      this.overrideModel = true
      if (!this.effortOptions().some((choice) => choice.value === this.effort)) {
        this.effort = ''
        this.overrideEffort = false
      }
    } else {
      this.effort = value
      this.overrideEffort = true
    }
  }

  async prompt(blocks: acp.ContentBlock[]): Promise<TurnResult> {
    if (this.active) throw new Error('Codex already has a turn in progress')
    const input = blocks.flatMap((block): CodexFields[] => {
      if (block.type === 'text') return [{ type: 'text', text: block.text, text_elements: [] }]
      if (block.type === 'image' || (block.type === 'audio' && list(this.selectedModel()?.inputModalities).includes('audio'))) {
        return [{ type: block.type, url: `data:${block.mimeType};base64,${block.data}` }]
      }
      if (block.type === 'resource_link') return [{ type: 'text', text: `@${block.uri}`, text_elements: [] }]
      return []
    })
    if (!input.length) throw new Error('Codex needs text or an attachment supported by the selected model')
    const turn: Turn = {
      id: null, interrupt: false, interruptSent: false, finished: Promise.withResolvers(), events: new CodexTurnEvents(this.emit)
    }
    // The connection may close before turn/start returns and before the completion is awaited.
    void turn.finished.promise.catch(() => undefined)
    this.active = turn
    try {
      if (blocks.some((block) => block.type === 'audio') && !input.some((item) => item.type === 'audio')) {
        await this.emit({ sessionUpdate: 'notice', severity: 'warning', title: 'The selected Codex model does not advertise audio input' })
      }
      if (turn.interrupt) return { stopReason: 'cancelled' }
      const result = await this.rpc.request('turn/start', {
        threadId: this.threadId, input,
        ...(this.overrideModel ? { model: this.model } : {}),
        ...(this.overrideEffort ? { effort: this.effort } : {})
      }).catch((error: unknown) => {
        // The server refusing the turn leaves the connection usable; a timeout or a broken pipe does not.
        if (!(error instanceof CodexRpcError)) this.close()
        throw error
      })
      const id = string(fields(result.turn).id)
      if (!id || (turn.id && turn.id !== id)) {
        this.close()
        throw new Error('Codex App Server returned an invalid turn ID')
      }
      turn.id = id
      this.interrupt(turn)
      return await turn.finished.promise
    } finally {
      turn.events.close()
      this.active = null
    }
  }

  cancel(): void {
    if (!this.active) return
    this.active.interrupt = true
    this.interrupt(this.active)
  }

  private interrupt(turn: Turn): void {
    if (!turn.interrupt || !turn.id || turn.interruptSent) return
    turn.interruptSent = true
    // The outer session handles an unresponsive server and waits before starting another turn.
    void this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: turn.id }).catch(() => undefined)
  }

  private async notification(method: string, params: CodexFields): Promise<void> {
    const turn = this.active
    if (!turn || params.threadId !== this.threadId) return
    const nativeTurn = fields(params.turn)
    const turnId = string(params.turnId) || string(nativeTurn.id)
    // Until turn/started (or the turn/start response) names this turn, an event is a previous turn's.
    if (!turnId || (turn.id ? turn.id !== turnId : method !== 'turn/started')) return
    turn.id = turnId
    this.interrupt(turn)
    if (method === 'turn/completed') {
      if (nativeTurn.status === 'interrupted') turn.finished.resolve({ stopReason: 'cancelled', usage: turn.usage })
      else if (nativeTurn.status === 'completed') turn.finished.resolve({ stopReason: 'end_turn', usage: turn.usage })
      else turn.finished.reject(new Error(string(fields(nativeTurn.error).message) || turn.error || 'Codex did not complete the turn'))
      return
    }
    if (method === 'error' && params.willRetry !== true) turn.error = string(fields(params.error).message)
    if (method === 'thread/tokenUsage/updated') {
      const usage = fields(fields(params.tokenUsage).last)
      if (typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number') {
        turn.usage = {
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
          cachedReadTokens: typeof usage.cachedInputTokens === 'number' ? usage.cachedInputTokens : 0
        }
      }
    }
    await turn.events.update(method, params)
  }

  private async serverRequest(method: string, params: CodexFields): Promise<unknown> {
    if (method === 'item/tool/requestUserInput' && params.threadId === this.threadId && this.active
      && list(params.questions).some((question) => fields(question).isSecret === true)) {
      await this.emit({ sessionUpdate: 'notice', severity: 'warning', title: 'Codex requested a secret answer. Zomfy skipped that question.' })
    }
    return codexServerRequest(method, params, (request) => {
      const turn = this.active
      if (!turn || params.threadId !== this.threadId || (turn.id && params.turnId !== turn.id)) {
        return Promise.resolve({ outcome: { outcome: 'cancelled' } })
      }
      return this.ask(request)
    })
  }

  private selectedModel(): CodexFields | undefined {
    return this.models.find((model) => this.model ? modelId(model) === this.model : model.isDefault === true) ?? (!this.model ? this.models[0] : undefined)
  }

  private effortOptions(): ChatAgentOption['choices'] {
    return list(this.selectedModel()?.supportedReasoningEfforts).map(fields).flatMap((entry) => {
      const value = string(entry.reasoningEffort)
      return value ? [{ value, name: value, description: string(entry.description) || null }] : []
    })
  }
}

function modelId(model: CodexFields): string {
  return string(model.model) || string(model.id)
}

function mcpConfig(servers: acp.McpServer[]): { config: CodexFields; skipped: string[] } {
  const skipped: string[] = []
  const config = Object.fromEntries(servers.flatMap((server): [string, unknown][] => {
    const name = `mcp_servers.${server.name}`
    if ('type' in server && server.type === 'http') {
      return [[name, { url: server.url, http_headers: Object.fromEntries(server.headers.map(({ name, value }) => [name, value])) }]]
    }
    if ('command' in server) {
      return [[name, { command: server.command, args: server.args, env: Object.fromEntries(server.env.map(({ name, value }) => [name, value])) }]]
    }
    skipped.push(server.name)
    return []
  }))
  return { config, skipped }
}
