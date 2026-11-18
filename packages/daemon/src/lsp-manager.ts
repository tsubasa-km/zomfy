import { realpathSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { HarnessRequests, LspEvent, LspOpenParams, LspOpenResult, LspServerHint, LspServerStatus, LspSetServerParams } from '@acp-harness/protocol'
import { LSP_METHODS } from '@acp-harness/protocol'
import {
  listLspServers,
  lspLanguageId,
  lspProjectRoot,
  lspRequirementMet,
  lspServerHint,
  lspServersFor,
  refreshLspServerProbes,
  resolveLspServer,
  setLspServer,
  type ResolvedLspServer,
  type ServingServer
} from './lsp-server-catalog.ts'
import { LSP_TIMINGS, LspSession, type LspTimings } from './lsp-session.ts'
import { LspUriTranslator } from './lsp-uris.ts'
import { log } from './log.ts'

// Starts a language server for a (window, workspace, server) the first time a file of its language
// opens there, and stops it when that window has had no document open for a while or has gone.
// Each window gets its own servers: two windows hold separate unsaved text for the same file, and a
// server can only be told one of them.

type Request<M extends keyof HarnessRequests> = HarnessRequests[M]['params']

export interface LspManagerOptions {
  /** The workspace's folder on this host; throws for unknown ids. */
  workspaceRoot(workspaceId: string): string
  /** Reaches every window; each takes the events carrying its own client id. */
  send(event: LspEvent): void
  /** Stand-ins for the catalog, for tests. */
  serversFor?: (languageId: string, editorLanguageId: string, path: string) => Promise<ServingServer[]>
  resolve?: (server: ServingServer, root: string) => Promise<ResolvedLspServer>
  timings?: Partial<LspTimings>
}

const MAX_EXTERNAL_BYTES = 2 * 1024 * 1024

export class LanguageServerManager {
  private readonly sessions = new Map<string, LspSession>()
  private readonly byId = new Map<string, LspSession>()
  private readonly clients = new Map<string, number>()
  private readonly timings: LspTimings
  private sweeper: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: LspManagerOptions) {
    this.timings = { ...LSP_TIMINGS, ...options.timings }
  }

  async open(params: LspOpenParams): Promise<LspOpenResult> {
    this.touch(params.clientId)
    const workspaceRoot = this.options.workspaceRoot(params.workspaceId)
    const languageId = lspLanguageId(params.path, params.languageId)
    const serving = await (this.options.serversFor ?? lspServersFor)(languageId, params.languageId, params.path)
    const result: LspOpenResult = { languageId, sessions: [], failed: [], missing: [] }
    const hints: LspServerHint[] = []
    await Promise.all(
      serving.map(async (server) => {
        const { spec } = server
        const root = lspProjectRoot(spec, workspaceRoot, params.path)
        if (!lspRequirementMet(spec, root)) return
        const key = `${params.clientId}\0${params.workspaceId}\0${spec.id}`
        let session = this.sessions.get(key)
        if (!session) {
          const resolved = await (this.options.resolve ?? resolveLspServer)(server, root)
          if (resolved.status === 'missing') {
            if (spec.install) hints.push(lspServerHint(spec))
            else result.failed.push({ serverId: spec.id, name: spec.name, message: resolved.detail })
            return
          }
          // Another open may have started it while this one looked for the command.
          session = this.sessions.get(key) ?? this.create(key, params, server, resolved.argv, root, workspaceRoot)
        }
        try {
          await session.start()
          result.sessions.push(session.info())
        } catch (error) {
          result.failed.push({ serverId: spec.id, name: spec.name, message: error instanceof Error ? error.message : String(error) })
        }
      })
    )
    // A missing linter beside a working main server is not worth a word; a language with nothing is.
    const served = result.sessions.some((s) => s.role === 'primary')
    if (!served) result.missing = hints.filter((hint) => serving.find((s) => s.spec.id === hint.serverId)?.spec.role === 'primary')
    return result
  }

  private create(key: string, params: LspOpenParams, { spec, override }: ServingServer, argv: string[], root: string, workspaceRoot: string): LspSession {
    const session = new LspSession({
      clientId: params.clientId,
      workspaceId: params.workspaceId,
      spec,
      argv,
      root,
      translator: new LspUriTranslator(params.workspaceId, [workspaceRoot, realPath(workspaceRoot)]),
      ...(override.initializationOptions !== undefined ? { initializationOptions: override.initializationOptions } : {}),
      ...(override.settings ? { settings: override.settings } : {}),
      timings: this.timings,
      send: this.options.send,
      onEnd: (ended) => {
        if (this.sessions.get(key) === ended) this.sessions.delete(key)
        this.byId.delete(ended.sessionId)
      }
    })
    this.sessions.set(key, session)
    this.byId.set(session.sessionId, session)
    log(`[lsp ${spec.id}] starting ${argv.join(' ')} in ${root}`)
    return session
  }

  /** Synchronous up to the write to the server, so messages keep the order they were sent in. */
  notify(params: Request<typeof LSP_METHODS.lspNotify>): void {
    this.touch(params.clientId)
    const session = this.session(params)
    session?.inOrder(params.seq, () => session.notify(params.method, params.params))
  }

  request(params: Request<typeof LSP_METHODS.lspRequest>): Promise<HarnessRequests[typeof LSP_METHODS.lspRequest]['result']> {
    this.touch(params.clientId)
    const session = this.session(params)
    if (!session) return Promise.resolve({ error: { code: -32002, message: 'That language server is no longer running' } })
    return new Promise((resolve) => session.inOrder(params.seq, () => resolve(session.request(params.requestId, params.method, params.params))))
  }

  cancel(params: Request<typeof LSP_METHODS.lspCancel>): void {
    this.session(params)?.cancel(params.requestId)
  }

  respond(params: Request<typeof LSP_METHODS.lspRespond>): void {
    this.session(params)?.respond(params.id, params.result, params.error)
  }

  keepAlive(clientId: string): void {
    this.touch(clientId)
  }

  async readExternal(params: Request<typeof LSP_METHODS.lspReadExternal>): Promise<{ content: string; path: string }> {
    const path = this.session(params)?.translator.externalPath(params.uri)
    if (!path) throw new Error('Not a file this language server pointed at')
    if ((await stat(path)).size > MAX_EXTERNAL_BYTES) throw new Error('That file is too large to show')
    return { content: await readFile(path, 'utf8'), path }
  }

  async servers(workspaceId: string | undefined): Promise<LspServerStatus[]> {
    refreshLspServerProbes()
    return listLspServers(workspaceId ? this.rootOrNull(workspaceId) : null)
  }

  /** Saves a server's command; its running copies stop, and windows ask again which servers serve their files. */
  async setServer(params: LspSetServerParams): Promise<LspServerStatus[]> {
    await setLspServer(params)
    await Promise.all([...this.sessions.values()].filter((s) => s.serverId === params.id).map((s) => s.stop('Its command changed')))
    this.options.send({ clientId: '*', kind: 'servers-changed' })
    return this.servers(params.workspaceId)
  }

  /** Stops everything, for the daemon's exit and for tests. */
  async dispose(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    await Promise.all([...this.sessions.values()].map((s) => s.stop()))
  }

  /** How many servers are running, for tests. */
  get sessionCount(): number {
    return this.sessions.size
  }

  private session(params: { clientId: string; sessionId: string }): LspSession | null {
    const session = this.byId.get(params.sessionId)
    return session && session.clientId === params.clientId ? session : null
  }

  private rootOrNull(workspaceId: string): string | null {
    try {
      return this.options.workspaceRoot(workspaceId)
    } catch {
      return null
    }
  }

  private touch(clientId: string): void {
    this.clients.set(clientId, Date.now())
    if (this.sweeper) return
    this.sweeper = setInterval(() => this.sweep(), Math.max(50, Math.min(30_000, this.timings.clientTtlMs / 3)))
    ;(this.sweeper as { unref?: () => void }).unref?.()
  }

  /** A window that closed or reloaded never says so; its servers go when it has been silent too long. */
  private sweep(): void {
    const now = Date.now()
    for (const [clientId, seen] of this.clients) {
      if (now - seen < this.timings.clientTtlMs) continue
      this.clients.delete(clientId)
      for (const session of [...this.sessions.values()]) {
        if (session.clientId === clientId) void session.stop('Its window closed')
      }
    }
    if (this.clients.size === 0 && this.sweeper) {
      clearInterval(this.sweeper)
      this.sweeper = null
    }
  }
}

function realPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}
