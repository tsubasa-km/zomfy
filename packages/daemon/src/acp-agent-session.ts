import * as acp from '@agentclientprotocol/sdk'
import {
  CHAT_AGENT_OPTION_IDS,
  chatAgentLabel,
  type ChatAgentId,
  type ChatAgentOption,
  type ChatAgentSessionState
} from '@acp-harness/protocol'
import { resolveChatAgent } from './chat-agent-launch-specs.ts'
import { hostPath } from './tui-agent-detection.ts'
import { log } from './log.ts'

// One external agent's ACP server, run for one harness session on this host (Orca's
// acp-structured-connection). The daemon is that server's client: it forwards prompts, cancels and
// option changes, and re-emits the agent's updates under the harness session id, so the transcript,
// status, replay and notifications work as they do for Claude.

/** A server left idle this long exits; the next turn starts it again on the same conversation. */
const IDLE_EXIT_MS = 15 * 60_000

/** Asks the person; the caller puts the harness session id on the request. */
export type AskPermission = (request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>

export interface AcpAgentSessionHooks {
  /** Records and broadcasts one update for the harness session. */
  emit(update: acp.SessionUpdate): Promise<void>
  onState(state: ChatAgentSessionState): void
  /** The agent's own id for the conversation, kept so a restarted server reopens it. */
  onAgentSessionId(id: string): void
  /** MCP servers to offer the agent's session (the manager tools), per what it supports. */
  mcpServers?(capabilities: acp.AgentCapabilities): acp.McpServer[]
  /** Waited for once the session is open, before its first turn (slow MCP servers coming up). */
  ready?(): Promise<void>
}

interface Running {
  proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
  conn: acp.ClientConnection
  agentSessionId: string
  capabilities: acp.AgentCapabilities
}

type SessionSetup = Pick<acp.NewSessionResponse, 'modes' | 'configOptions'> & { models?: unknown }

export class AcpAgentSession {
  private running: Running | null = null
  private starting: Promise<Running> | null = null
  /** Updates the agent replays while `session/load` reopens a conversation the transcript has. */
  private replaying = false
  private ask: AskPermission | null = null
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

  async prompt(blocks: acp.ContentBlock[], abort: AbortController, ask: AskPermission): Promise<acp.StopReason> {
    const running = await this.ensureStarted()
    this.clearIdle()
    this.ask = ask
    const cancel = () => void running.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: running.agentSessionId })
    abort.signal.addEventListener('abort', cancel)
    try {
      const { stopReason } = await running.conn.agent.request(acp.methods.agent.session.prompt, {
        sessionId: running.agentSessionId,
        prompt: await this.promptFor(blocks, running.capabilities.promptCapabilities)
      })
      return stopReason
    } finally {
      abort.signal.removeEventListener('abort', cancel)
      this.ask = null
      this.armIdle()
    }
  }

  async setOption(optionId: string, value: string): Promise<void> {
    const { conn, agentSessionId: sessionId } = await this.ensureStarted()
    if (optionId === CHAT_AGENT_OPTION_IDS.mode) {
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
    this.stopProcess()
  }

  private async start(): Promise<Running> {
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
      windowsHide: true
    })
    void pipeStderr(proc.stderr, this.agent)
    const conn = acp
      .client({ name: 'acp-harness' })
      .onRequest('session/request_permission', (ctx) => this.permission(ctx.params))
      .onNotification('session/update', (ctx) => this.onUpdate(ctx.params))
      .connect(acp.ndJsonStream(stdinWriter(proc.stdin), proc.stdout))
    void proc.exited.then((code) => {
      log(`${this.agent} ACP server exited (${code})`)
      conn.close()
      if (this.running?.proc === proc) this.running = null
    })

    try {
      const init = await conn.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        // No fs or terminal: the agent edits and runs commands itself, on this same host.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'acp-harness', title: 'Zomfy', version: '0.0.1' }
      })
      const capabilities = init.agentCapabilities ?? {}
      const { agentSessionId, setup } = await this.openSession(conn, capabilities)
      await this.hooks.ready?.()
      const running: Running = { proc, conn, agentSessionId, capabilities }
      if (this.disposed) {
        this.running = running
        this.stopProcess()
        throw new Error('The chat closed while its agent started')
      }
      this.running = running
      const saved = this.state.options
      this.setState({ phase: 'ready', error: null, options: optionsFrom(setup) })
      await this.restoreOptions(saved)
      this.armIdle()
      return running
    } catch (error) {
      proc.kill()
      const message = error instanceof Error ? error.message : String(error)
      return this.fail(/auth/i.test(message) ? `${label} is not signed in on this host: ${message}` : message)
    }
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
        log(`${this.agent} could not reopen ${previous}: ${String(error)}`)
      }
      await this.hooks.emit({
        sessionUpdate: 'notice',
        severity: 'warning',
        title: `${chatAgentLabel(this.agent)} could not reopen its conversation; the next message starts a new one`
      })
    }
    const created = await conn.agent.request(acp.methods.agent.session.new, { cwd: this.cwd, mcpServers })
    this.agentSessionId = created.sessionId
    this.hooks.onAgentSessionId(created.sessionId)
    return { agentSessionId: created.sessionId, setup: created }
  }

  /** Choices the person made before the server restarted, which a reopened session may have lost. */
  private async restoreOptions(saved: ChatAgentOption[]): Promise<void> {
    for (const option of saved) {
      const now = this.state.options.find((o) => o.id === option.id)
      if (!now || now.currentValue === option.currentValue) continue
      if (!now.choices.some((c) => c.value === option.currentValue)) continue
      await this.setOption(option.id, option.currentValue).catch((error) =>
        log(`restoring ${option.id} failed: ${String(error)}`)
      )
    }
  }

  private async permission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    // Asked outside a turn (none should be): nobody is there to answer.
    if (!this.ask) return { outcome: { outcome: 'cancelled' } }
    return this.ask(params)
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
    this.idleTimer = setTimeout(() => this.stopProcess(), IDLE_EXIT_MS)
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private stopProcess(): void {
    const running = this.running
    this.running = null
    if (!running) return
    running.conn.close()
    // Closing stdin is how ACP servers (OpenCode 2.x's private child too) are asked to exit.
    void Promise.resolve(running.proc.stdin.end()).catch(() => undefined)
    const timer = setTimeout(() => running.proc.kill(), 3_000)
    void running.proc.exited.finally(() => clearTimeout(timer))
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
function withOutputText(update: Extract<acp.SessionUpdate, { sessionUpdate: 'tool_call_update' }>): acp.SessionUpdate {
  if (update.content?.length || typeof update.rawOutput !== 'object' || update.rawOutput === null) return update
  const raw = update.rawOutput as { output?: unknown; stdout?: unknown; metadata?: { output?: unknown } }
  const text = [raw.output, raw.stdout, raw.metadata?.output].find((v): v is string => typeof v === 'string')
  return text ? { ...update, content: [{ type: 'content', content: { type: 'text', text } }] } : update
}

function stdinWriter(sink: Bun.FileSink): WritableStream<Uint8Array> {
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
