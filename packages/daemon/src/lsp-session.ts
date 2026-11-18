import { LSP_CLIENT_CAPABILITIES, type LspError, type LspEvent, type LspRegistration, type LspSessionInfo, type LspSessionState } from '@acp-harness/protocol'
import { encodeLspMessage, LspMessageReader } from './lsp-framing.ts'
import { HOST_FLAVOR, pathToFileUri, translateLspUris, type LspUriTranslator } from './lsp-uris.ts'
import type { LspServerSpec } from './lsp-server-catalog.ts'
import { killTree, trackChild } from './process-tree.ts'
import { hostPath } from './tui-agent-detection.ts'
import { log } from './log.ts'

// One language server process for one window's view of one workspace. The daemon is the server's
// LSP client as far as the process goes (it starts it, initializes it, answers what a server asks
// of its host) and a relay for everything about documents, which only the window's editor knows.

export interface LspTimings {
  /** A server with no open document for this long is shut down. */
  idleMs: number
  /** A window not heard from for this long is taken for closed. */
  clientTtlMs: number
  /** Waits before each restart of a crashed server; the last one repeats. */
  restartBackoffMs: number[]
  /** More than `maxCrashes` within this window and the server is given up on. */
  crashWindowMs: number
  maxCrashes: number
  initializeMs: number
  requestMs: number
  shutdownMs: number
  /** How long a message waits for one sent before it that has not arrived. */
  gapMs: number
  /** How long the window has to answer a server's request (`workspace/applyEdit`). */
  windowRequestMs: number
}

export const LSP_TIMINGS: LspTimings = {
  idleMs: 5 * 60_000,
  clientTtlMs: 150_000,
  restartBackoffMs: [500, 1_000, 2_000, 4_000, 8_000],
  crashWindowMs: 3 * 60_000,
  maxCrashes: 5,
  initializeMs: 45_000,
  requestMs: 120_000,
  shutdownMs: 2_000,
  gapMs: 1_500,
  windowRequestMs: 30_000
}

/** JSON-RPC / LSP error codes used here. */
const METHOD_NOT_FOUND = -32601
const SERVER_NOT_READY = -32002
const REQUEST_CANCELLED = -32800
const REQUEST_FAILED = -32803

/** Diagnostics for files the window has not opened are kept this many files deep, for when it opens one. */
const MAX_HELD_DIAGNOSTICS = 2_000
/** Requests a server makes to refresh something the window pulls; there is nothing to do but agree. */
const REFRESH_REQUESTS = /^workspace\/(semanticTokens|inlayHint|inlineValue|codeLens|diagnostic|foldingRange)\/refresh$/

type Wire = { id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: LspError }

interface Pending {
  resolve(answer: { result: unknown } | { error: LspError }): void
  timer: ReturnType<typeof setTimeout>
  clientRequestId: string | null
}

export interface LspSessionOptions {
  clientId: string
  workspaceId: string
  spec: LspServerSpec
  argv: string[]
  /** The folder the server is started in and told is its project. */
  root: string
  translator: LspUriTranslator
  initializationOptions?: unknown
  settings?: Record<string, unknown>
  timings: LspTimings
  send(event: LspEvent): void
  /** The session is over (idle, crashed for good, stopped); the manager forgets it. */
  onEnd(session: LspSession): void
}

export class LspSession {
  readonly sessionId = crypto.randomUUID()
  state: LspSessionState | 'starting' = 'starting'
  generation = 0
  private capabilities: Record<string, unknown> = {}
  private registrations: LspRegistration[] = []
  /** Window URIs of the documents open on the running server. */
  private readonly openDocs = new Set<string>()
  private readonly heldDiagnostics = new Map<string, unknown>()
  private proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly byClientRequest = new Map<string, number>()
  /** Server requests waiting on the window, by the id the window answers with. */
  private readonly windowRequests = new Map<number, { serverId: number | string; fallback: unknown; timer: ReturnType<typeof setTimeout> }>()
  private nextWindowRequest = 1
  private nextSeq = 0
  private readonly heldBySeq = new Map<number, () => void>()
  private gapTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private crashes: number[] = []
  private stopping = false
  private stderrTail: string[] = []
  private started: Promise<void> | null = null
  private everReady = false

  constructor(private readonly options: LspSessionOptions) {}

  get clientId(): string {
    return this.options.clientId
  }
  get workspaceId(): string {
    return this.options.workspaceId
  }
  get serverId(): string {
    return this.options.spec.id
  }
  get translator(): LspUriTranslator {
    return this.options.translator
  }
  get openDocumentCount(): number {
    return this.openDocs.size
  }

  info(): LspSessionInfo {
    return {
      sessionId: this.sessionId,
      serverId: this.serverId,
      name: this.options.spec.name,
      role: this.options.spec.role,
      generation: this.generation,
      capabilities: this.capabilities,
      registrations: this.registrations
    }
  }

  /** Starts the server once; rejects with why it would not start. */
  start(): Promise<void> {
    this.started ??= this.launch().then(
      () => this.armIdle(),
      (error: unknown) => {
        this.end('failed')
        throw error
      }
    )
    return this.started
  }

  // ── From the window ────────────────────────────────────────────────────

  /** Runs `deliver` once everything the window sent before it (lower `seq`) has been delivered. */
  inOrder(seq: number, deliver: () => void): void {
    if (seq > this.nextSeq) {
      this.heldBySeq.set(seq, deliver)
      // A lost message must not hold the rest back for good.
      this.gapTimer ??= setTimeout(() => {
        this.gapTimer = null
        if (this.heldBySeq.size === 0) return
        this.nextSeq = Math.min(...this.heldBySeq.keys())
        this.flushHeld()
      }, this.options.timings.gapMs)
      return
    }
    if (seq === this.nextSeq) this.nextSeq++
    deliver()
    this.flushHeld()
  }

  private flushHeld(): void {
    for (let next = this.heldBySeq.get(this.nextSeq); next; next = this.heldBySeq.get(this.nextSeq)) {
      this.heldBySeq.delete(this.nextSeq++)
      next()
    }
    if (this.heldBySeq.size === 0 && this.gapTimer) {
      clearTimeout(this.gapTimer)
      this.gapTimer = null
    }
  }

  notify(method: string, params: unknown): void {
    if (this.state !== 'ready') return
    const uri = documentUri(params)
    if (method === 'textDocument/didOpen' && uri) {
      // A window that reconnected opens its documents again; the server must see each open once.
      if (this.openDocs.has(uri)) this.write({ jsonrpc: '2.0', method: 'textDocument/didClose', params: this.toServer({ textDocument: { uri } }) })
      this.openDocs.add(uri)
      this.clearIdle()
    } else if (method === 'textDocument/didClose' && uri) {
      if (!this.openDocs.delete(uri)) return
      if (this.openDocs.size === 0) this.armIdle()
    } else if (method.startsWith('textDocument/') && uri && !this.openDocs.has(uri)) {
      // A change for a document this server process was never told about (it restarted since).
      return
    }
    this.write({ jsonrpc: '2.0', method, params: this.toServer(params) })
    if (method === 'textDocument/didOpen' && uri) {
      const held = this.heldDiagnostics.get(uri)
      this.heldDiagnostics.delete(uri)
      if (held) this.send({ kind: 'notification', method: 'textDocument/publishDiagnostics', params: held })
    }
  }

  request(clientRequestId: string | null, method: string, params: unknown): Promise<{ result: unknown } | { error: LspError }> {
    if (this.state !== 'ready') {
      return Promise.resolve({ error: { code: SERVER_NOT_READY, message: `${this.options.spec.name} is not running (${this.state})` } })
    }
    return this.call(method, this.toServer(params), clientRequestId, this.options.timings.requestMs).then((answer) =>
      'result' in answer ? { result: this.toClient(answer.result) } : answer
    )
  }

  cancel(clientRequestId: string): void {
    const id = this.byClientRequest.get(clientRequestId)
    if (id !== undefined) this.write({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } })
  }

  /** The window's answer to a request the server made. */
  respond(id: number, result: unknown, error: LspError | undefined): void {
    const waiting = this.windowRequests.get(id)
    if (!waiting) return
    this.windowRequests.delete(id)
    clearTimeout(waiting.timer)
    this.write(error ? { jsonrpc: '2.0', id: waiting.serverId, error } : { jsonrpc: '2.0', id: waiting.serverId, result: this.toServer(result ?? null) })
  }

  /** Shuts the server down as LSP asks (shutdown, exit), then makes sure it is gone. */
  async stop(message?: string): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    const proc = this.proc
    if (proc && this.state === 'ready') {
      await this.call('shutdown', null, null, this.options.timings.shutdownMs)
      this.write({ jsonrpc: '2.0', method: 'exit' })
      void Promise.resolve(proc.stdin.end()).catch(() => undefined)
      // Left to exit by itself; `end` must not kill it mid-shutdown.
      this.proc = null
      const timer = setTimeout(() => killTree(proc), 1_500)
      await proc.exited.catch(() => undefined)
      clearTimeout(timer)
    } else if (proc) killTree(proc)
    this.end('stopped', message)
  }

  // ── The server process ─────────────────────────────────────────────────

  private async launch(): Promise<void> {
    const { spec, argv, root, timings } = this.options
    const proc = Bun.spawn(argv, {
      cwd: root,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PATH: await hostPath() },
      windowsHide: true,
      // Its own process group, so stopping it reaches what it starts (tsserver, cargo, a type checker).
      detached: process.platform !== 'win32'
    })
    this.proc = proc
    trackChild(proc)
    void this.readStdout(proc)
    void this.readStderr(proc)
    void proc.exited.then((code) => this.exited(proc, code))

    const folder = this.folder()
    const rootUri = folder.uri
    const init = await this.call(
      'initialize',
      {
        processId: process.pid,
        clientInfo: { name: 'Zomfy' },
        rootPath: root,
        rootUri,
        workspaceFolders: [folder],
        capabilities: LSP_CLIENT_CAPABILITIES,
        ...(this.options.initializationOptions !== undefined ? { initializationOptions: this.options.initializationOptions } : spec.initializationOptions !== undefined ? { initializationOptions: spec.initializationOptions } : {})
      },
      null,
      timings.initializeMs
    )
    if ('error' in init) {
      killTree(proc)
      throw new Error(`${spec.name} would not start: ${init.error.message}${this.stderrSummary()}`)
    }
    const capabilities = (init.result as { capabilities?: Record<string, unknown> } | null)?.capabilities
    this.capabilities = capabilities && typeof capabilities === 'object' ? capabilities : {}
    this.write({ jsonrpc: '2.0', method: 'initialized', params: {} })
    const settings = this.settings()
    if (settings) this.write({ jsonrpc: '2.0', method: 'workspace/didChangeConfiguration', params: { settings } })
    this.state = 'ready'
    this.everReady = true
  }

  private settings(): Record<string, unknown> | null {
    if (this.options.settings) return this.options.settings
    const { spec } = this.options
    if (!spec.settings) return null
    return spec.settings(this.folder())
  }

  /** The server's project folder as LSP names it. */
  private folder(): { uri: string; name: string } {
    const { root } = this.options
    return { uri: pathToFileUri(root, HOST_FLAVOR), name: root.split(/[\\/]/).filter(Boolean).at(-1) ?? root }
  }

  private async readStdout(proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>): Promise<void> {
    const reader = new LspMessageReader()
    try {
      for await (const chunk of proc.stdout) {
        for (const message of reader.push(chunk)) {
          if (this.proc !== proc) return
          try {
            this.receive(message as Wire)
          } catch (error) {
            log(`[lsp ${this.serverId}] handling a message failed: ${String(error)}`)
          }
        }
      }
    } catch (error) {
      // Not LSP on stdout (a wrong command): there is no recovering the stream.
      log(`[lsp ${this.serverId}] ${String(error)}`)
      this.stderrTail.push(String(error))
      killTree(proc)
    }
  }

  private async readStderr(proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>): Promise<void> {
    const decoder = new TextDecoder()
    try {
      for await (const chunk of proc.stderr) {
        for (const line of decoder.decode(chunk, { stream: true }).split('\n')) {
          if (!line.trim()) continue
          this.stderrTail.push(line.trim().slice(0, 300))
          if (this.stderrTail.length > 20) this.stderrTail.shift()
        }
      }
    } catch {
      // The process went away.
    }
  }

  private stderrSummary(): string {
    const last = this.stderrTail.at(-1)
    return last ? ` (${last})` : ''
  }

  private exited(proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>, code: number): void {
    if (this.proc !== proc) return
    this.proc = null
    const message = `${this.options.spec.name} exited (${code})${this.stderrSummary()}`
    this.failPending(message)
    if (this.stopping || this.state === 'stopped' || this.state === 'failed') return
    if (this.state === 'starting') return
    log(`[lsp ${this.serverId}] ${message}`)
    const hadDocuments = this.openDocs.size > 0
    this.openDocs.clear()
    this.registrations = []
    if (!hadDocuments) return this.end('stopped', message)
    const { timings } = this.options
    const now = Date.now()
    this.crashes = [...this.crashes.filter((at) => now - at < timings.crashWindowMs), now]
    if (this.crashes.length > timings.maxCrashes) return this.end('failed', `${message}; it keeps crashing, so it was not started again`)
    this.state = 'restarting'
    this.send({ kind: 'state', state: 'restarting', generation: this.generation, message })
    const wait = timings.restartBackoffMs[Math.min(this.crashes.length - 1, timings.restartBackoffMs.length - 1)] ?? 1_000
    this.restartTimer = setTimeout(() => void this.restart(), wait)
  }

  private async restart(): Promise<void> {
    this.restartTimer = null
    if (this.stopping) return
    this.state = 'starting'
    try {
      await this.launch()
    } catch (error) {
      if (this.stopping) return
      // A server that dies while starting counts like any other crash.
      const message = error instanceof Error ? error.message : String(error)
      const { timings } = this.options
      this.crashes.push(Date.now())
      if (this.crashes.length > timings.maxCrashes) return this.end('failed', message)
      this.state = 'restarting'
      const wait = timings.restartBackoffMs[Math.min(this.crashes.length - 1, timings.restartBackoffMs.length - 1)] ?? 1_000
      this.restartTimer = setTimeout(() => void this.restart(), wait)
      return
    }
    this.generation++
    // The window opens its documents again on this; until then there are none, and it may idle out.
    this.armIdle()
    this.send({ kind: 'state', state: 'ready', generation: this.generation, capabilities: this.capabilities })
  }

  private end(state: 'stopped' | 'failed', message?: string): void {
    if (this.state === 'stopped' || this.state === 'failed') return
    const announced = this.everReady
    this.state = state
    this.clearIdle()
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.gapTimer) clearTimeout(this.gapTimer)
    for (const waiting of this.windowRequests.values()) clearTimeout(waiting.timer)
    this.windowRequests.clear()
    this.failPending(message ?? `${this.options.spec.name} stopped`)
    if (this.proc) killTree(this.proc)
    // A first start that failed was never announced; `open` reports it instead.
    if (announced) this.send({ kind: 'state', state, generation: this.generation, ...(message ? { message } : {}) })
    this.options.onEnd(this)
  }

  private armIdle(): void {
    this.clearIdle()
    if (this.openDocs.size > 0 || this.state !== 'ready') return
    this.idleTimer = setTimeout(() => void this.stop('No open documents'), this.options.timings.idleMs)
    // An idle server must not keep the daemon alive.
    ;(this.idleTimer as { unref?: () => void }).unref?.()
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  // ── JSON-RPC with the server ───────────────────────────────────────────

  private write(message: Record<string, unknown>): void {
    const proc = this.proc
    if (!proc) return
    try {
      proc.stdin.write(encodeLspMessage(message))
      void Promise.resolve(proc.stdin.flush()).catch(() => undefined)
    } catch {
      // The pipe closed under us; the exit handler takes it from here.
    }
  }

  private call(method: string, params: unknown, clientRequestId: string | null, timeoutMs: number): Promise<{ result: unknown } | { error: LspError }> {
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.write({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } })
        this.settle(id, { error: { code: REQUEST_CANCELLED, message: `${this.options.spec.name} did not answer ${method} in ${Math.round(timeoutMs / 1000)}s` } })
      }, timeoutMs)
      this.pending.set(id, { resolve, timer, clientRequestId })
      if (clientRequestId) this.byClientRequest.set(clientRequestId, id)
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  private settle(id: number, answer: { result: unknown } | { error: LspError }): void {
    const waiting = this.pending.get(id)
    if (!waiting) return
    this.pending.delete(id)
    clearTimeout(waiting.timer)
    if (waiting.clientRequestId) this.byClientRequest.delete(waiting.clientRequestId)
    waiting.resolve(answer)
  }

  private failPending(message: string): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { error: { code: REQUEST_FAILED, message } })
  }

  private receive(message: Wire): void {
    if (typeof message.method === 'string') {
      if (message.id !== undefined && message.id !== null) this.serverRequest(message.id, message.method, message.params)
      else this.serverNotification(message.method, message.params)
      return
    }
    if (typeof message.id !== 'number') return
    this.settle(message.id, message.error ? { error: { code: message.error.code, message: message.error.message } } : { result: message.result ?? null })
  }

  /** What a server asks of its client: answered here where the host knows, relayed where only the editor does. */
  private serverRequest(id: number | string, method: string, params: unknown): void {
    const answer = (result: unknown) => this.write({ jsonrpc: '2.0', id, result })
    const canned = this.options.spec.clientRequests
    if (method === 'workspace/configuration') {
      const items = (params as { items?: { section?: string }[] } | null)?.items ?? []
      const settings = this.settings()
      answer(items.map((item) => configurationSection(settings, item.section)))
    } else if (method === 'client/registerCapability') {
      const added = ((params as { registrations?: LspRegistration[] } | null)?.registrations ?? []).filter((r) => typeof r?.id === 'string' && typeof r.method === 'string')
      this.registrations = [...this.registrations.filter((r) => !added.some((a) => a.id === r.id)), ...added]
      answer(null)
      this.send({ kind: 'registrations', registrations: this.registrations })
    } else if (method === 'client/unregisterCapability') {
      // The spec's own field name carries the typo.
      const gone = (params as { unregisterations?: { id: string }[] } | null)?.unregisterations ?? []
      this.registrations = this.registrations.filter((r) => !gone.some((g) => g.id === r.id))
      answer(null)
      this.send({ kind: 'registrations', registrations: this.registrations })
    } else if (method === 'window/workDoneProgress/create' || REFRESH_REQUESTS.test(method)) {
      answer(null)
    } else if (method === 'workspace/workspaceFolders') {
      answer([this.folder()])
    } else if (method === 'workspace/applyEdit') {
      this.askWindow(id, method, params, { applied: false, failureReason: 'The editor did not answer' })
    } else if (method === 'window/showMessageRequest') {
      // Its buttons have nowhere to go; the message itself is shown, and no button counts as chosen.
      this.send({ kind: 'notification', method: 'window/showMessage', params })
      answer(null)
    } else if (method === 'window/showDocument') {
      answer({ success: false })
    } else if (canned && method in canned) {
      answer(canned[method])
    } else {
      this.write({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: `Zomfy does not handle ${method}` } })
    }
  }

  private askWindow(serverId: number | string, method: string, params: unknown, fallback: unknown): void {
    const id = this.nextWindowRequest++
    const timer = setTimeout(() => this.respond(id, fallback, undefined), this.options.timings.windowRequestMs)
    this.windowRequests.set(id, { serverId, fallback, timer })
    this.send({ kind: 'request', id, method, params: this.toClient(params) })
  }

  private serverNotification(method: string, params: unknown): void {
    if (method === 'textDocument/publishDiagnostics') {
      const translated = this.toClient(params) as { uri?: string; diagnostics?: unknown[] }
      if (typeof translated?.uri !== 'string') return
      if (this.openDocs.has(translated.uri)) return this.send({ kind: 'notification', method, params: translated })
      // Project-wide checks report files nobody has open; they wait here until the window opens one.
      this.heldDiagnostics.delete(translated.uri)
      if (translated.diagnostics?.length && this.heldDiagnostics.size < MAX_HELD_DIAGNOSTICS) this.heldDiagnostics.set(translated.uri, translated)
    } else if (method === 'window/showMessage') {
      this.send({ kind: 'notification', method, params })
    } else if (method === 'window/logMessage') {
      const { type, message } = (params ?? {}) as { type?: number; message?: string }
      if (type === 1 && message) log(`[lsp ${this.serverId}] ${message.slice(0, 500)}`)
    }
    // Progress, telemetry and the rest have no surface in the editor yet.
  }

  private send(event: LspEventBody): void {
    this.options.send({ clientId: this.clientId, sessionId: this.sessionId, ...event } as LspEvent)
  }

  private toServer<T>(value: T): T {
    return translateLspUris(value, (uri) => this.translator.toServer(uri))
  }

  private toClient<T>(value: T): T {
    return translateLspUris(value, (uri) => this.translator.toClient(uri))
  }
}

type LspEventBody =
  | { kind: 'notification'; method: string; params: unknown }
  | { kind: 'request'; id: number; method: string; params: unknown }
  | { kind: 'state'; state: LspSessionState; generation: number; capabilities?: Record<string, unknown>; message?: string }
  | { kind: 'registrations'; registrations: LspRegistration[] }

function documentUri(params: unknown): string | null {
  const uri = (params as { textDocument?: { uri?: unknown } } | null)?.textDocument?.uri
  return typeof uri === 'string' ? uri : null
}

/** `python.analysis` out of `{ python: { analysis: … } }`; the whole object for no section. */
function configurationSection(settings: Record<string, unknown> | null, section: string | undefined): unknown {
  if (!settings) return null
  if (!section) return settings
  let value: unknown = settings
  for (const part of section.split('.')) {
    if (typeof value !== 'object' || value === null || !(part in value)) return null
    value = (value as Record<string, unknown>)[part]
  }
  return value ?? null
}
