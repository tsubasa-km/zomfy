import {
  HARNESS_METHODS,
  type LspEvent,
  type LspOpenResult,
  type LspRegistration,
  type LspServerRole,
  type LspSessionInfo
} from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { findWorkspace, LOCAL_HOST, type HostId } from '@/session-store'
import { onLspEvent } from './lsp-events'

// This window's end of the language-server relay. A session is one server the daemon runs for this
// window; requests and notifications to it go through `_harness/lsp/*` on the workspace's host, and
// what the server says comes back as `_harness/lsp/event` notifications (handleLspEvent).

/** Names this window to every daemon, which keeps separate servers per window. */
export const LSP_CLIENT_ID = crypto.randomUUID()

/** How often a window with servers says it is still there; the daemon gives up after 150 s of silence. */
const KEEP_ALIVE_MS = 45_000

/** The capability a server announces for each request the editor makes. */
const CAPABILITY: Record<string, string> = {
  'textDocument/completion': 'completionProvider',
  'textDocument/hover': 'hoverProvider',
  'textDocument/signatureHelp': 'signatureHelpProvider',
  'textDocument/declaration': 'declarationProvider',
  'textDocument/definition': 'definitionProvider',
  'textDocument/typeDefinition': 'typeDefinitionProvider',
  'textDocument/implementation': 'implementationProvider',
  'textDocument/references': 'referencesProvider',
  'textDocument/documentHighlight': 'documentHighlightProvider',
  'textDocument/documentSymbol': 'documentSymbolProvider',
  'textDocument/codeAction': 'codeActionProvider',
  'textDocument/formatting': 'documentFormattingProvider',
  'textDocument/rangeFormatting': 'documentRangeFormattingProvider',
  'textDocument/rename': 'renameProvider',
  'textDocument/diagnostic': 'diagnosticProvider',
  'workspace/executeCommand': 'executeCommandProvider'
}

/** A cancellation the editor hands its providers. */
export interface CancelToken {
  readonly isCancellationRequested: boolean
  onCancellationRequested(listener: () => void): { dispose(): void }
}

export class LspSession {
  readonly sessionId: string
  readonly serverId: string
  readonly name: string
  readonly role: LspServerRole
  generation: number
  /** False while the server is being restarted, and for good once it has ended. */
  ready = true
  ended = false
  private capabilities: Record<string, unknown>
  private registrations: LspRegistration[]
  private seq = 0

  constructor(
    readonly hostId: HostId,
    readonly workspaceId: string,
    info: LspSessionInfo
  ) {
    this.sessionId = info.sessionId
    this.serverId = info.serverId
    this.name = info.name
    this.role = info.role
    this.generation = info.generation
    this.capabilities = info.capabilities
    this.registrations = info.registrations
  }

  update(info: Pick<LspSessionInfo, 'generation' | 'capabilities' | 'registrations'>): void {
    this.generation = info.generation
    this.capabilities = info.capabilities
    this.registrations = info.registrations
  }

  setRegistrations(registrations: LspRegistration[]): void {
    this.registrations = registrations
  }

  /** Whether the server answers `method`, by what it announced at start or registered since. */
  supports(method: string): boolean {
    const key = CAPABILITY[method]
    const announced = key ? this.capabilities[key] : undefined
    return (announced !== undefined && announced !== null && announced !== false) || this.registrations.some((r) => r.method === method)
  }

  /** The options the server gave for `method` (trigger characters, resolve support…), or an empty object. */
  options<T extends object>(method: string): Partial<T> {
    const key = CAPABILITY[method]
    const announced = key ? this.capabilities[key] : undefined
    if (typeof announced === 'object' && announced !== null) return announced as Partial<T>
    const registered = this.registrations.find((r) => r.method === method)?.registerOptions
    return typeof registered === 'object' && registered !== null ? (registered as Partial<T>) : {}
  }

  /** How the server wants changes: 0 not at all, 1 the whole text each time, 2 only what changed. */
  get syncKind(): 0 | 1 | 2 {
    const sync = this.capabilities.textDocumentSync
    const kind = typeof sync === 'number' ? sync : typeof sync === 'object' && sync !== null ? (sync as { change?: number }).change : 0
    return kind === 1 || kind === 2 ? kind : 0
  }

  /** Whether the server wants `didSave`, and with the text. */
  get save(): { wanted: boolean; includeText: boolean } {
    const sync = this.capabilities.textDocumentSync
    const save = typeof sync === 'object' && sync !== null ? (sync as { save?: boolean | { includeText?: boolean } }).save : undefined
    const registered = this.registrations.find((r) => r.method === 'textDocument/didSave')?.registerOptions as { includeText?: boolean } | undefined
    if (save === undefined && !registered) return { wanted: false, includeText: false }
    return { wanted: save !== false, includeText: (typeof save === 'object' && save.includeText === true) || registered?.includeText === true }
  }

  /** The commands the server runs itself (`workspace/executeCommand`). */
  get commands(): string[] {
    return this.options<{ commands: string[] }>('workspace/executeCommand').commands ?? []
  }

  notify(method: string, params: unknown): void {
    if (this.ended) return
    // `seq` is taken here, synchronously, so the daemon can restore the order the editor sent in.
    const seq = this.seq++
    void harnessRequest(HARNESS_METHODS.lspNotify, { clientId: LSP_CLIENT_ID, sessionId: this.sessionId, seq, method, params }, this.hostId).catch(() => undefined)
  }

  /** The server's answer, or null when it failed, was cancelled, or the server is not running. */
  async request<T>(method: string, params: unknown, token?: CancelToken): Promise<T | null> {
    if (this.ended || !this.ready || token?.isCancellationRequested) return null
    const requestId = crypto.randomUUID()
    const seq = this.seq++
    const cancel = token?.onCancellationRequested(() => {
      void harnessRequest(HARNESS_METHODS.lspCancel, { clientId: LSP_CLIENT_ID, sessionId: this.sessionId, requestId }, this.hostId).catch(() => undefined)
    })
    try {
      const answer = await harnessRequest(HARNESS_METHODS.lspRequest, { clientId: LSP_CLIENT_ID, sessionId: this.sessionId, seq, requestId, method, params }, this.hostId)
      if ('error' in answer) {
        // The daemon no longer knows this session (it restarted, or took this window for closed).
        if (answer.error.code === SESSION_GONE && !this.ended) lostListener?.(this)
        return null
      }
      return token?.isCancellationRequested ? null : (answer.result as T)
    } catch {
      return null
    } finally {
      cancel?.dispose()
    }
  }

  respond(id: number, result: unknown): void {
    void harnessRequest(HARNESS_METHODS.lspRespond, { clientId: LSP_CLIENT_ID, sessionId: this.sessionId, id, result }, this.hostId).catch(() => undefined)
  }
}

const SESSION_GONE = -32002

const sessions = new Map<string, LspSession>()
const keepAlive = new Map<HostId, ReturnType<typeof setInterval>>()

type SessionListener = (session: LspSession, event: Extract<LspEvent, { sessionId: string }>) => void
let sessionListener: SessionListener | null = null
let serversChangedListener: ((hostId: HostId) => void) | null = null
let lostListener: ((session: LspSession) => void) | null = null

/** The document layer's hooks: what a server said, a host's server commands changing, a session the daemon forgot. */
export function setLspListeners(listeners: { session: SessionListener; serversChanged: (hostId: HostId) => void; lost: (session: LspSession) => void }): void {
  sessionListener = listeners.session
  serversChangedListener = listeners.serversChanged
  lostListener = listeners.lost
}

export function hostOfWorkspace(workspaceId: string): HostId {
  return findWorkspace(workspaceId)?.hostId ?? LOCAL_HOST
}

export interface OpenedDocument {
  languageId: string
  sessions: LspSession[]
  failed: LspOpenResult['failed']
  missing: LspOpenResult['missing']
}

/** Asks the workspace's host which servers serve a file, starting them if need be. */
export async function openLspDocument(workspaceId: string, path: string, languageId: string): Promise<OpenedDocument> {
  const hostId = hostOfWorkspace(workspaceId)
  const result = await harnessRequest(HARNESS_METHODS.lspOpen, { clientId: LSP_CLIENT_ID, workspaceId, path, languageId }, hostId)
  const opened = result.sessions.map((info) => {
    let session = sessions.get(info.sessionId)
    if (session) session.update(info)
    else {
      session = new LspSession(hostId, workspaceId, info)
      sessions.set(info.sessionId, session)
    }
    return session
  })
  if (opened.length > 0 && !keepAlive.has(hostId)) {
    keepAlive.set(
      hostId,
      setInterval(() => {
        if (![...sessions.values()].some((s) => s.hostId === hostId)) {
          clearInterval(keepAlive.get(hostId))
          keepAlive.delete(hostId)
          return
        }
        void harnessRequest(HARNESS_METHODS.lspKeepAlive, { clientId: LSP_CLIENT_ID }, hostId).catch(() => undefined)
      }, KEEP_ALIVE_MS)
    )
  }
  return { languageId: result.languageId, sessions: opened, failed: result.failed, missing: result.missing }
}

/** Drops a session this window will not hear from again. */
export function forgetLspSession(session: LspSession): void {
  session.ended = true
  session.ready = false
  sessions.delete(session.sessionId)
}

/** Every event from a host's daemon comes through here; other windows' are ignored. */
function handleLspEvent(hostId: HostId, event: LspEvent): void {
  if (event.kind === 'servers-changed') {
    serversChangedListener?.(hostId)
    return
  }
  if (event.clientId !== LSP_CLIENT_ID) return
  const session = sessions.get(event.sessionId)
  if (!session || session.hostId !== hostId) return
  if (event.kind === 'registrations') session.setRegistrations(event.registrations)
  if (event.kind === 'state') {
    if (event.state === 'ready') {
      session.ready = true
      session.update({ generation: event.generation, capabilities: event.capabilities ?? {}, registrations: [] })
    } else if (event.state === 'restarting') session.ready = false
    else forgetLspSession(session)
  }
  sessionListener?.(session, event)
}

onLspEvent(handleLspEvent)
