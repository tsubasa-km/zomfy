import * as acp from '@agentclientprotocol/sdk'
import { killTree, trackChild } from './process-tree.ts'
import {
  CHAT_AGENT_OPTION_IDS,
  chatAgentLabel,
  type ChatAgentId,
  type ChatAgentOption,
  type ChatAgentSessionState,
  type CodexConnection,
  type WorkflowStepUsage
} from '@zomfy/protocol'
import { resolveChatAgent } from './chat-agent-launch-specs.ts'
import { CODEX_APP_SERVER_CAPABILITIES, CodexAppServer } from './codex-app-server.ts'
import { hostPath } from './tui-agent-detection.ts'
import { log } from './log.ts'

// One external agent process per harness session. The daemon forwards prompts, cancels and option
// changes and records the resulting chat updates. Codex can use ACP or App Server.

/** A server left idle this long exits; the next turn starts it again on the same conversation. */
const IDLE_EXIT_MS = 15 * 60_000
/** How long a cancelled turn may take to end before its server is stopped (it ignored the cancel). */
const CANCEL_GRACE_MS = 10_000

export type PromptBlocks = acp.ContentBlock[] | (() => acp.ContentBlock[])

/** Asks the person; the caller puts the harness session id on the request. */
export type AskPermission = (request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>

export interface AcpAgentSessionHooks {
  /** Records and broadcasts one update for the harness session. */
  emit(update: acp.SessionUpdate): Promise<void>
  onState(state: ChatAgentSessionState): void
  /** The agent's own id for the conversation, kept so a restarted server reopens it. */
  onAgentSessionId(id: string): void
  /**
   * The conversation the agent had could not be reopened, and it starts a new one knowing nothing of
   * the chat. Waited for before that conversation's first turn, whose prompt is read after it.
   */
  onConversationLost?(): Promise<void>
  /** MCP servers to offer the agent's session (the manager tools), per what it supports. */
  mcpServers?(capabilities: acp.AgentCapabilities): acp.McpServer[]
  /** Waited for once the session is open, before its first turn (slow MCP servers coming up). */
  ready?(): Promise<void>
}

interface Running {
  proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
  conn: acp.ClientConnection | CodexAppServer
  agentSessionId: string
  capabilities: acp.AgentCapabilities
}

type SessionSetup = Pick<acp.NewSessionResponse, 'modes' | 'configOptions'> & { models?: unknown }

export class AcpAgentSession {
  private running: Running | null = null
  private starting: Promise<Running> | null = null
  private stopping: Promise<void> | null = null
  private lastConnection: CodexConnection | null = null
  /** Updates the agent replays while `session/load` reopens a conversation the transcript has. */
  private replaying = false
  private ask: AskPermission | null = null
  /** The running turn's abort: a cancel answers the agent's open permission asks for the person. */
  private turnSignal: AbortSignal | null = null
  /** Ends when the running turn has ended; the next turn waits for it (ACP runs one prompt at a time). */
  private turn: Promise<void> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    readonly agent: Exclude<ChatAgentId, 'claude'>,
    private readonly cwd: string,
    private agentSessionId: string | null,
    private state: ChatAgentSessionState,
    private readonly hooks: AcpAgentSessionHooks
  ) {}

  /** Starts the server and opens (or reopens) its session, once. */
  ensureStarted(): Promise<Running> {
    if (this.running) return Promise.resolve(this.running)
    this.starting ??= this.start().finally(() => (this.starting = null))
    return this.starting
  }

  /** What the last turn used, when the agent reports it. */
  lastUsage: WorkflowStepUsage | null = null
  cancelGraceMs = CANCEL_GRACE_MS

  /** Resolves once no turn is running; a turn aborted for a newer prompt ends first (send now). */
  async settled(): Promise<void> {
    while (this.turn) await this.turn
  }

  /** `blocks` as a function is read once the agent's session is open, just before the prompt goes to it. */
  async prompt(blocks: PromptBlocks, abort: AbortController, ask: AskPermission): Promise<acp.StopReason> {
    while (this.turn) await this.turn
    let release!: () => void
    const turn = new Promise<void>((resolve) => (release = resolve))
    this.turn = turn
    try {
      return await this.runTurn(blocks, abort.signal, ask)
    } finally {
      if (this.turn === turn) this.turn = null
      release()
    }
  }

  private async runTurn(blocks: PromptBlocks, signal: AbortSignal, ask: AskPermission): Promise<acp.StopReason> {
    const aborted = whenAborted(signal)
    try {
      // A Stop while the server starts ends the turn now; the start goes on for the next one.
      const running = await Promise.race([this.startForTurn(signal), aborted.promise])
      if (!running || signal.aborted) return 'cancelled'
      this.clearIdle()
      const prompt = await this.promptFor(typeof blocks === 'function' ? blocks() : blocks, running.capabilities.promptCapabilities)
      if (signal.aborted) return 'cancelled'
      this.ask = ask
      this.turnSignal = signal
      const conn = running.conn
      const request = conn instanceof CodexAppServer
        ? conn.prompt(prompt)
        : conn.agent.request(acp.methods.agent.session.prompt, { sessionId: running.agentSessionId, prompt })
      const answeredAtAll = request.then(
        () => true,
        () => true
      )
      const cancelled = aborted.promise.then(async () => {
        if (conn instanceof CodexAppServer) conn.cancel()
        else void conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: running.agentSessionId }).catch(() => undefined)
        const ended = await Promise.race([answeredAtAll, Bun.sleep(this.cancelGraceMs).then(() => false)])
        if (!ended && this.running === running) {
          log(`${this.agent} ignored a cancel for ${this.cancelGraceMs}ms; stopping its server`)
          await this.stopProcess()
        }
        return 'cancelled' as const
      })
      // A cancelled turn whose server was stopped fails its request; that is still just a Stop.
      const answered = request.catch(async (error: unknown) => {
        if (conn instanceof CodexAppServer && conn.closed && this.running === running) await this.stopProcess()
        if (signal.aborted) return 'cancelled' as const
        throw error
      })
      const response = await Promise.race([answered, cancelled])
      if (typeof response === 'string') return response
      this.lastUsage = reportedUsage(response)
      return response.stopReason
    } finally {
      aborted.dispose()
      this.ask = null
      this.turnSignal = null
      if (!this.disposed) this.armIdle()
    }
  }

  /** Puts the session on `model`, and fails when the agent offers no such model. */
  async useModel(model: string): Promise<void> {
    await this.ensureStarted()
    const option = this.state.options.find((o) => o.id === CHAT_AGENT_OPTION_IDS.model || o.category === 'model')
    if (!option) throw new Error(`${chatAgentLabel(this.agent)} does not let Zomfy choose its model, so it cannot be held to ${model}`)
    if (!option.choices.some((c) => c.value === model)) {
      throw new Error(`${chatAgentLabel(this.agent)} has no model "${model}" (it offers: ${option.choices.map((c) => c.value).join(', ')})`)
    }
    if (option.currentValue !== model) await this.setOption(option.id, model)
    const now = this.state.options.find((o) => o.id === option.id)?.currentValue
    if (now !== model) throw new Error(`${chatAgentLabel(this.agent)} stayed on ${now ?? 'another model'} instead of ${model}`)
  }

  async setOption(optionId: string, value: string): Promise<void> {
    const { conn, agentSessionId: sessionId } = await this.ensureStarted()
    if (conn instanceof CodexAppServer) {
      conn.setOption(optionId, value)
      this.setState({ options: conn.options() })
    } else if (optionId === CHAT_AGENT_OPTION_IDS.mode) {
      await conn.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId: value })
      this.patchOption(optionId, value)
    } else if (optionId === CHAT_AGENT_OPTION_IDS.model) {
      // ACP's unstable model selection, for agents that predate config options.
      await conn.agent.request('session/set_model', { sessionId, modelId: value })
      this.patchOption(optionId, value)
    } else {
      const { configOptions } = await conn.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: optionId,
        value
      })
      this.setState({ options: optionsFrom({ configOptions }) })
    }
    this.armIdle()
  }

  dispose(): void {
    this.disposed = true
    this.clearIdle()
    void this.stopProcess()
  }

  private async startForTurn(signal: AbortSignal): Promise<Running | null> {
    if (this.agent === 'codex') {
      // Let a previous warm start finish before making a connection decision for this turn.
      const running = this.running ?? await this.starting?.catch(() => null)
      if (running && !signal.aborted) {
        const choice = (await resolveChatAgent('codex')).codexConnection ?? 'acp'
        const direct = running.conn instanceof CodexAppServer
        if (direct !== (choice === 'app-server') || (running.conn instanceof CodexAppServer && running.conn.closed)) {
          await this.stopProcess()
        }
      }
    }
    return signal.aborted ? null : this.ensureStarted()
  }

  private async start(): Promise<Running> {
    await this.stopping
    if (this.disposed) throw new Error('The chat closed while its agent started')
    this.setState({ phase: 'starting', error: null })
    const resolved = await resolveChatAgent(this.agent)
    if (resolved.status !== 'ready') return this.fail(resolved.detail)
    const label = chatAgentLabel(this.agent)
    const proc = Bun.spawn(resolved.argv, {
      cwd: this.cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PATH: await hostPath(), ...resolved.env },
      windowsHide: true,
      // Its own process group, so stopping it reaches the CLI and MCP servers it starts.
      detached: process.platform !== 'win32'
    })
    trackChild(proc)
    void pipeStderr(proc.stderr, this.agent)
    const connection = resolved.codexConnection ?? 'acp'
    const input = stdinWriter(proc.stdin)
    const conn = connection === 'app-server'
      ? new CodexAppServer(input, proc.stdout, (update) => this.hooks.emit(update), (request) => this.permission(request))
      : acp.client({ name: 'zomfy' })
        .onRequest('session/request_permission', (ctx) => this.permission(ctx.params))
        .onNotification('session/update', (ctx) => this.onUpdate(ctx.params))
        .connect(acp.ndJsonStream(input, proc.stdout))
    void proc.exited.then(async (code) => {
      log(`${this.agent} ${connection} server exited (${code})`)
      if (conn instanceof CodexAppServer) await conn.drained
      else conn.close()
      if (this.running?.proc === proc) this.running = null
    })

    try {
      const capabilities = conn instanceof CodexAppServer
        ? CODEX_APP_SERVER_CAPABILITIES
        : (await conn.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          // The agent edits and runs commands locally.
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'zomfy', title: 'Zomfy', version: '0.0.1' }
        })).agentCapabilities ?? {}
      const opened = conn instanceof CodexAppServer
        ? { agentSessionId: await this.openCodex(conn, capabilities), options: conn.options() }
        : await this.openSession(conn, capabilities).then(({ agentSessionId, setup }) => ({ agentSessionId, options: optionsFrom(setup) }))
      const { agentSessionId, options } = opened
      await this.hooks.ready?.()
      const running: Running = { proc, conn, agentSessionId, capabilities }
      if (this.disposed) {
        this.running = running
        this.stopProcess()
        throw new Error('The chat closed while its agent started')
      }
      this.running = running
      this.lastConnection = connection
      const saved = this.state.options
      this.setState({ phase: 'ready', error: null, options, commands: connection === 'app-server' ? [] : this.state.commands })
      await this.restoreOptions(saved)
      this.armIdle()
      return running
    } catch (error) {
      conn.close()
      killTree(proc)
      if (proc.exitCode === null) proc.kill()
      const message = error instanceof Error ? error.message : String(error)
      return this.fail(/auth/i.test(message) ? `${label} is not signed in on this host: ${message}` : message)
    }
  }

  private async openCodex(conn: CodexAppServer, capabilities: acp.AgentCapabilities): Promise<string> {
    const id = await conn.open(this.cwd, this.agentSessionId, this.hooks.mcpServers?.(capabilities) ?? [])
    if (id !== this.agentSessionId) {
      this.agentSessionId = id
      this.hooks.onAgentSessionId(id)
    }
    return id
  }

  /** Reopens the conversation a restarted server left behind, or starts one. */
  private async openSession(
    conn: acp.ClientConnection,
    capabilities: acp.AgentCapabilities
  ): Promise<{ agentSessionId: string; setup: SessionSetup }> {
    const previous = this.agentSessionId
    const mcpServers = this.hooks.mcpServers?.(capabilities) ?? []
    if (previous) {
      const request = { sessionId: previous, cwd: this.cwd, mcpServers }
      try {
        if (capabilities.sessionCapabilities?.resume) {
          return { agentSessionId: previous, setup: await conn.agent.request(acp.methods.agent.session.resume, request) }
        }
        if (capabilities.loadSession) {
          // The transcript already holds the conversation; drop the agent's replay of it.
          this.replaying = true
          try {
            return { agentSessionId: previous, setup: await conn.agent.request(acp.methods.agent.session.load, request) }
          } finally {
            this.replaying = false
          }
        }
      } catch (error) {
        if (this.lastConnection === 'app-server') throw error
        log(`${this.agent} could not reopen ${previous}: ${String(error)}`)
      }
      if (this.lastConnection === 'app-server') throw new Error('The ACP adapter cannot reopen this Codex thread')
      await this.hooks.emit({
        sessionUpdate: 'notice',
        severity: 'warning',
        title: `${chatAgentLabel(this.agent)} could not reopen its conversation; the next message starts a new one, from a selection of this chat`
      })
    }
    const created = await conn.agent.request(acp.methods.agent.session.new, { cwd: this.cwd, mcpServers })
    this.agentSessionId = created.sessionId
    this.hooks.onAgentSessionId(created.sessionId)
    if (previous) await this.hooks.onConversationLost?.()
    return { agentSessionId: created.sessionId, setup: created }
  }

  /** Choices the person made before the server restarted, which a reopened session may have lost. */
  private async restoreOptions(saved: ChatAgentOption[]): Promise<void> {
    for (const option of saved) {
      const now = this.state.options.find((o) => o.id === option.id)
        ?? (this.agent === 'codex' && (option.category === 'model' || option.category === 'thought_level')
          ? this.state.options.find((o) => o.category === option.category) : undefined)
      if (!now || now.currentValue === option.currentValue) continue
      if (!now.choices.some((c) => c.value === option.currentValue)) continue
      await this.setOption(now.id, option.currentValue).catch((error) =>
        log(`restoring ${now.id} failed: ${String(error)}`)
      )
    }
  }

  private async permission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    // Asked outside a turn (none should be): nobody is there to answer.
    const { ask, turnSignal } = this
    if (!ask || !turnSignal || turnSignal.aborted) return { outcome: { outcome: 'cancelled' } }
    // ACP: once the turn is cancelled, its open asks are answered `cancelled`, or the agent waits on them.
    const aborted = whenAborted(turnSignal)
    try {
      return await Promise.race([ask(params), aborted.promise.then((): acp.RequestPermissionResponse => ({ outcome: { outcome: 'cancelled' } }))])
    } finally {
      aborted.dispose()
    }
  }

  private async onUpdate({ update }: acp.SessionNotification): Promise<void> {
    if (this.replaying) return
    switch (update.sessionUpdate) {
      case 'config_option_update':
        this.setState({ options: optionsFrom({ configOptions: update.configOptions }) })
        return
      case 'current_mode_update':
        this.patchOption(CHAT_AGENT_OPTION_IDS.mode, update.currentModeId)
        return
      case 'available_commands_update':
        this.setState({
          commands: update.availableCommands.map((c) => ({
            name: c.name,
            description: c.description,
            argumentHint: c.input && 'hint' in c.input ? c.input.hint : ''
          }))
        })
        return
      case 'user_message_chunk':
      case 'session_info_update':
        // The daemon echoes the prompt itself, and the tab keeps the title it was given.
        return
      case 'tool_call_update':
        await this.hooks.emit(withOutputText(update))
        return
      default:
        await this.hooks.emit(update)
    }
  }

  private async promptFor(blocks: acp.ContentBlock[], caps: acp.PromptCapabilities | undefined): Promise<acp.ContentBlock[]> {
    const out: acp.ContentBlock[] = []
    let droppedImage = false
    for (const block of blocks) {
      if (block.type === 'image' && !caps?.image) droppedImage = true
      else if (block.type === 'resource' && !caps?.embeddedContext) {
        out.push({
          type: 'text',
          text: 'text' in block.resource ? `<context uri="${block.resource.uri}">\n${block.resource.text}\n</context>` : `@${block.resource.uri}`
        })
      } else out.push(block)
    }
    if (droppedImage) {
      await this.hooks.emit({ sessionUpdate: 'notice', severity: 'warning', title: `${chatAgentLabel(this.agent)} does not take images; they were left out` })
    }
    return out
  }

  private patchOption(id: string, value: string): void {
    this.setState({ options: this.state.options.map((o) => (o.id === id ? { ...o, currentValue: value } : o)) })
  }

  private setState(patch: Partial<ChatAgentSessionState>): void {
    this.state = { ...this.state, ...patch }
    this.hooks.onState(this.state)
  }

  private fail(error: string): never {
    this.setState({ phase: 'failed', error })
    throw new Error(error)
  }

  private armIdle(): void {
    this.clearIdle()
    this.idleTimer = setTimeout(() => void this.stopProcess(), IDLE_EXIT_MS)
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private stopProcess(): Promise<void> {
    const running = this.running
    if (!running) return this.stopping ?? Promise.resolve()
    this.running = null
    running.conn.close()
    // Wait for the old process to release any thread lock before opening the other transport.
    void Promise.resolve(running.proc.stdin.end()).catch(() => undefined)
    const timer = setTimeout(() => {
      killTree(running.proc)
      if (running.proc.exitCode === null) running.proc.kill()
    }, 3_000)
    const stopped = running.proc.exited.then(() => {
      clearTimeout(timer)
      if (this.stopping === stopped) this.stopping = null
    })
    this.stopping = stopped
    return stopped
  }
}

export function emptyAgentState(): ChatAgentSessionState {
  return { phase: 'starting', error: null, options: [], commands: [] }
}

/** ACP's config options, session modes and (unstable) models, as one list of choices. */
function optionsFrom(setup: SessionSetup): ChatAgentOption[] {
  const options: ChatAgentOption[] = []
  for (const option of setup.configOptions ?? []) {
    if (option.type !== 'select') continue
    const choices = option.options.flatMap((entry) => ('group' in entry ? entry.options : [entry]))
    options.push({
      id: option.id,
      name: option.name,
      category: option.category ?? null,
      currentValue: option.currentValue,
      choices: choices.map((c) => ({ value: c.value, name: c.name, description: c.description ?? null }))
    })
  }
  const has = (category: string) => options.some((o) => o.category === category)
  if (setup.modes && !has('mode')) {
    options.push({
      id: CHAT_AGENT_OPTION_IDS.mode,
      name: 'Mode',
      category: 'mode',
      currentValue: setup.modes.currentModeId,
      choices: setup.modes.availableModes.map((m) => ({ value: m.id, name: m.name, description: m.description ?? null }))
    })
  }
  const models = unstableModels(setup.models)
  if (models && !has('model')) options.push(models)
  return options
}

function unstableModels(value: unknown): ChatAgentOption | null {
  if (typeof value !== 'object' || value === null) return null
  const { currentModelId, availableModels } = value as { currentModelId?: unknown; availableModels?: unknown }
  if (typeof currentModelId !== 'string' || !Array.isArray(availableModels)) return null
  const choices = availableModels.flatMap((m: { modelId?: unknown; name?: unknown; description?: unknown }) =>
    typeof m?.modelId === 'string'
      ? [{ value: m.modelId, name: typeof m.name === 'string' ? m.name : m.modelId, description: typeof m.description === 'string' ? m.description : null }]
      : []
  )
  return { id: CHAT_AGENT_OPTION_IDS.model, name: 'Model', category: 'model', currentValue: currentModelId, choices }
}

/** Agents that report a command's output only in `rawOutput` (OpenCode's `metadata.output`) get it as text. */
export function withOutputText(update: Extract<acp.SessionUpdate, { sessionUpdate: 'tool_call_update' }>): acp.SessionUpdate {
  if (update.content?.length || typeof update.rawOutput !== 'object' || update.rawOutput === null) return update
  const raw = update.rawOutput as { output?: unknown; stdout?: unknown; metadata?: { output?: unknown } }
  const text = [raw.output, raw.stdout, raw.metadata?.output].find((v): v is string => typeof v === 'string')
  return text ? { ...update, content: [{ type: 'content', content: { type: 'text', text } }] } : update
}

/** Resolves when `signal` aborts (at once if it has); `dispose` drops the listener. */
function whenAborted(signal: AbortSignal): { promise: Promise<void>; dispose(): void } {
  let onAbort: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    onAbort = () => resolve()
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return { promise, dispose: () => signal.removeEventListener('abort', onAbort) }
}

export function stdinWriter(sink: Bun.FileSink): WritableStream<Uint8Array> {
  return new WritableStream({
    async write(chunk) {
      sink.write(chunk)
      await sink.flush()
    },
    async close() {
      await sink.end()
    }
  })
}

/** Token usage an agent may put on its prompt answer (ACP's unstable `usage`), read defensively. */
function reportedUsage(response: object): WorkflowStepUsage | null {
  const usage: unknown = 'usage' in response ? response.usage : null
  if (!usage || typeof usage !== 'object') return null
  const count = (key: string) => (key in usage && typeof (usage as Record<string, unknown>)[key] === 'number' ? Number((usage as Record<string, unknown>)[key]) : 0)
  if (!('inputTokens' in usage)) return null
  return { inputTokens: count('inputTokens'), outputTokens: count('outputTokens'), cacheReadTokens: count('cachedReadTokens') }
}

async function pipeStderr(stream: ReadableStream<Uint8Array>, agent: string): Promise<void> {
  const decoder = new TextDecoder()
  try {
    for await (const chunk of stream) {
      for (const line of decoder.decode(chunk, { stream: true }).split('\n')) {
        if (line.trim()) log(`[${agent}] ${line.slice(0, 500)}`)
      }
    }
  } catch {
    // The process went away.
  }
}
