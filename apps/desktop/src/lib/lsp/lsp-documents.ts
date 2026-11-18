import { toast } from 'sonner'
import type { LspEvent, LspServerHint } from '@acp-harness/protocol'
import { monaco } from '@/lib/monaco-setup'
import { getState, hostLabel, whenState, type HostId } from '@/session-store'
import { openSettings } from '@/stores/app-overlay-store'
import { t } from '@/i18n/i18n'
import { forgetLspSession, hostOfWorkspace, openLspDocument, setLspListeners, type LspSession } from './lsp-client'
import { toLspContentChanges, toMarker } from './lsp-convert'
import { monacoUri, wireUri, workspaceFileOf } from './lsp-models'
import type { LspDiagnostic, LspDocumentDiagnosticReport, LspWorkspaceEdit } from './lsp-types'

// Keeps each open file's language servers in step with its editor model: opened when the file first
// gets an editor, told every change as it is typed, told when it is saved, closed when the model
// goes (its tab closed). A model outlives its editor across tab switches, so a document does too.

type Model = monaco.editor.ITextModel

const FOREVER_MS = 2_000_000_000
/** How long typing must pause before a server that is asked for diagnostics is asked again. */
const PULL_DELAY_MS = 350
/** A document whose servers stopped under it asks for them again, but not in a tight loop. */
const RECONNECT_MIN_MS = 10_000

export class LspDocument {
  readonly hostId: HostId
  readonly uri: string
  /** The LSP language id, known once the host has answered. */
  languageId: string
  /** Servers this document is open on, by session id, with the server generation it was opened in. */
  private readonly attached = new Map<string, { session: LspSession; generation: number }>()
  /** What each server last reported, as it reported it: code actions hand these back. */
  private readonly reported = new Map<string, LspDiagnostic[]>()
  private readonly resultIds = new Map<string, string>()
  private readonly listeners: monaco.IDisposable[]
  private pullTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lastConnect = 0
  private connecting: Promise<void> = Promise.resolve()
  private watchingSave = false
  private disposed = false

  constructor(
    readonly model: Model,
    readonly workspaceId: string,
    readonly path: string
  ) {
    this.hostId = hostOfWorkspace(workspaceId)
    this.uri = wireUri(workspaceId, path)
    this.languageId = model.getLanguageId()
    this.listeners = [model.onDidChangeContent((event) => this.changed(event)), model.onWillDispose(() => this.dispose())]
  }

  /** The servers this document is open on that answer `method`, main server first. */
  sessions(method: string): LspSession[] {
    return [...this.attached.values()]
      .map((a) => a.session)
      .filter((session) => session.ready && session.supports(method))
      .sort((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary'))
  }

  get allSessions(): LspSession[] {
    return [...this.attached.values()].map((a) => a.session)
  }

  diagnosticsFrom(session: LspSession): LspDiagnostic[] {
    return this.reported.get(session.sessionId) ?? []
  }

  /**
   * Asks the host which servers serve this file and opens it on each. `force` opens it again on
   * servers it was already open on (after a reconnect, when what they heard meanwhile is unknown).
   */
  connect(force = false): Promise<void> {
    // One at a time: two overlapping runs would open the document twice.
    this.connecting = this.connecting.then(() => this.runConnect(force))
    return this.connecting
  }

  private async runConnect(force: boolean): Promise<void> {
    if (this.disposed) return
    this.lastConnect = Date.now()
    let opened
    try {
      opened = await openLspDocument(this.workspaceId, this.path, this.model.getLanguageId())
    } catch {
      // The host is unreachable; watchHost connects again when it is back.
      return
    }
    if (this.disposed) return
    this.languageId = opened.languageId
    const serving = new Set(opened.sessions.map((s) => s.sessionId))
    for (const { session } of [...this.attached.values()]) {
      if (serving.has(session.sessionId)) continue
      session.notify('textDocument/didClose', { textDocument: { uri: this.uri } })
      this.detach(session)
    }
    for (const session of opened.sessions) {
      const have = this.attached.get(session.sessionId)
      if (!force && have && have.generation === session.generation) continue
      this.open(session)
    }
    reportMissing(this.hostId, opened.missing)
    for (const failure of opened.failed) reportFailure(this.hostId, failure.serverId, failure.name, failure.message)
    languagesChanged()
  }

  /** Tells one server the document's current text, as a fresh open. */
  open(session: LspSession): void {
    if (this.disposed) return
    session.notify('textDocument/didOpen', {
      textDocument: { uri: this.uri, languageId: this.languageId, version: this.model.getVersionId(), text: this.model.getValue() }
    })
    this.attached.set(session.sessionId, { session, generation: session.generation })
    this.resultIds.delete(session.sessionId)
    this.schedulePull()
  }

  /** Forgets a server that stopped serving this document, and what it reported. */
  detach(session: LspSession): void {
    if (!this.attached.delete(session.sessionId)) return
    this.reported.delete(session.sessionId)
    this.resultIds.delete(session.sessionId)
    if (!this.disposed) monaco.editor.setModelMarkers(this.model, markerOwner(session), [])
  }

  isOpenOn(session: LspSession): boolean {
    return this.attached.has(session.sessionId)
  }

  setDiagnostics(session: LspSession, diagnostics: LspDiagnostic[]): void {
    if (this.disposed || !this.attached.has(session.sessionId)) return
    this.reported.set(session.sessionId, diagnostics)
    monaco.editor.setModelMarkers(
      this.model,
      markerOwner(session),
      diagnostics.map((d) => toMarker(d, session.name, monacoUri))
    )
  }

  /** Asks servers that are asked (rather than publish) for this document's diagnostics, once typing pauses. */
  schedulePull(): void {
    if (this.pullTimer) clearTimeout(this.pullTimer)
    this.pullTimer = setTimeout(() => {
      this.pullTimer = null
      for (const session of this.sessions('textDocument/diagnostic')) void this.pull(session)
    }, PULL_DELAY_MS)
  }

  private async pull(session: LspSession): Promise<void> {
    const version = this.model.getVersionId()
    const identifier = session.options<{ identifier: string }>('textDocument/diagnostic').identifier
    const previousResultId = this.resultIds.get(session.sessionId)
    const report = await session.request<LspDocumentDiagnosticReport>('textDocument/diagnostic', {
      textDocument: { uri: this.uri },
      ...(identifier ? { identifier } : {}),
      ...(previousResultId ? { previousResultId } : {})
    })
    // Typed since: the pull scheduled by that change answers for the newer text.
    if (!report || this.disposed || this.model.getVersionId() !== version) return
    if (report.resultId) this.resultIds.set(session.sessionId, report.resultId)
    if (report.kind === 'full') this.setDiagnostics(session, report.items ?? [])
  }

  /** Opens the document again on its servers, soon but not at once (they just stopped under it). */
  scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return
    const wait = Math.max(1_000, RECONNECT_MIN_MS - (Date.now() - this.lastConnect))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, wait)
  }

  private changed(event: monaco.editor.IModelContentChangedEvent): void {
    for (const { session } of this.attached.values()) {
      const kind = session.syncKind
      if (kind === 0) continue
      session.notify('textDocument/didChange', {
        textDocument: { uri: this.uri, version: event.versionId },
        contentChanges: kind === 2 ? toLspContentChanges(event.changes) : [{ text: this.model.getValue() }]
      })
    }
    this.schedulePull()
    this.watchForSave()
  }

  private tabs() {
    return getState().editorTabs.filter((tab) => tab.kind === 'file' && tab.workspaceId === this.workspaceId && tab.path === this.path)
  }

  /**
   * The text editor does not announce a save, but it clears its tab's unsaved mark once the text is on
   * disk (after a save, a reload, or an undo back to the saved text). That moment is the server's
   * `didSave`: the buffer and the file agree again.
   */
  private watchForSave(): void {
    if (this.watchingSave) return
    this.watchingSave = true
    const dirty = () => this.tabs().some((tab) => tab.dirty)
    // Once the editor's own change handler has marked the tab.
    setTimeout(() => {
      if (this.disposed || !dirty()) {
        this.watchingSave = false
        return
      }
      void whenState(() => !dirty(), FOREVER_MS).then((clean) => {
        this.watchingSave = false
        if (this.disposed || this.tabs().length === 0) return
        if (!clean) return this.watchForSave()
        for (const { session } of this.attached.values()) {
          const { wanted, includeText } = session.save
          if (wanted) session.notify('textDocument/didSave', { textDocument: { uri: this.uri }, ...(includeText ? { text: this.model.getValue() } : {}) })
        }
        this.schedulePull()
      })
    }, 0)
  }

  private dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const listener of this.listeners) listener.dispose()
    if (this.pullTimer) clearTimeout(this.pullTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    for (const { session } of this.attached.values()) session.notify('textDocument/didClose', { textDocument: { uri: this.uri } })
    this.attached.clear()
    documents.delete(this.model)
    languagesChanged()
  }
}

/** Markers are grouped by who set them; each server gets its own group, so one clearing its list leaves the other's. */
export function markerOwner(session: LspSession): string {
  return `lsp:${session.serverId}`
}

const documents = new Map<Model, LspDocument>()
const watchedHosts = new Set<HostId>()

export function documentOf(model: Model): LspDocument | null {
  return documents.get(model) ?? null
}

export function allDocuments(): LspDocument[] {
  return [...documents.values()]
}

/** Starts language features for a workspace file's model; a model that already has them is left alone. */
export function trackDocument(model: Model, fallback?: { workspaceId: string; path: string }): void {
  if (documents.has(model) || model.isDisposed()) return
  // The tab names its file exactly; a model's URI can only be read back for ordinary names.
  const file = fallback ?? workspaceFileOf(model)
  if (!file) return
  const doc = new LspDocument(model, file.workspaceId, file.path)
  documents.set(model, doc)
  if (!watchedHosts.has(doc.hostId)) {
    watchedHosts.add(doc.hostId)
    void watchHost(doc.hostId)
  }
  void doc.connect()
}

/** After a host's link drops and comes back, its servers may have missed anything; every document opens anew. */
async function watchHost(hostId: HostId): Promise<void> {
  const connected = () => getState().hosts[hostId]?.connection.kind === 'connected'
  for (;;) {
    if (!(await whenState(() => !connected(), FOREVER_MS))) continue
    if (!(await whenState(connected, FOREVER_MS))) continue
    for (const doc of documents.values()) if (doc.hostId === hostId) void doc.connect(true)
  }
}

// ── What the servers say ─────────────────────────────────────────────────

type WorkspaceEditApplier = (session: LspSession, edit: LspWorkspaceEdit, label?: string) => Promise<boolean>
let applyEdit: WorkspaceEditApplier = async () => false

/** The workspace-edit module plugs in here; it needs documents, and documents need it for `workspace/applyEdit`. */
export function setWorkspaceEditApplier(applier: WorkspaceEditApplier): void {
  applyEdit = applier
}

function documentsOn(session: LspSession): LspDocument[] {
  return [...documents.values()].filter((doc) => doc.isOpenOn(session))
}

function onSessionEvent(session: LspSession, event: Extract<LspEvent, { sessionId: string }>): void {
  if (event.kind === 'notification') {
    if (event.method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = event.params as { uri: string; diagnostics: LspDiagnostic[] }
      for (const doc of documents.values()) if (doc.uri === uri) doc.setDiagnostics(session, diagnostics ?? [])
    } else if (event.method === 'workspace/diagnostic/refresh') {
      for (const doc of documentsOn(session)) doc.schedulePull()
    } else if (event.method === 'window/showMessage') {
      const { type, message } = (event.params ?? {}) as { type?: number; message?: string }
      if (!message) return
      if (type === 1) toast.error(session.name, { description: message })
      else if (type === 2) toast.warning(session.name, { description: message })
    }
  } else if (event.kind === 'request') {
    if (event.method !== 'workspace/applyEdit') return session.respond(event.id, null)
    const { edit, label } = event.params as { edit: LspWorkspaceEdit; label?: string }
    void applyEdit(session, edit, label).then(
      (applied) => session.respond(event.id, { applied }),
      (error: unknown) => session.respond(event.id, { applied: false, failureReason: error instanceof Error ? error.message : String(error) })
    )
  } else if (event.kind === 'registrations') {
    for (const doc of documentsOn(session)) doc.schedulePull()
    languagesChanged()
  } else if (event.state === 'ready') {
    // A restarted server knows no documents.
    for (const doc of documentsOn(session)) doc.open(session)
    languagesChanged()
  } else if (event.state === 'stopped' || event.state === 'failed') {
    const open = documentsOn(session)
    for (const doc of open) doc.detach(session)
    if (event.state === 'failed') reportFailure(session.hostId, session.serverId, session.name, event.message ?? '')
    // Stopped with documents still open on it (this window was taken for closed, say): ask again.
    else for (const doc of open) doc.scheduleReconnect()
    languagesChanged()
  }
}

function onSessionLost(session: LspSession): void {
  forgetLspSession(session)
  for (const doc of documentsOn(session)) {
    doc.detach(session)
    doc.scheduleReconnect()
  }
  languagesChanged()
}

setLspListeners({
  session: onSessionEvent,
  serversChanged: (hostId) => {
    for (const doc of documents.values()) if (doc.hostId === hostId) void doc.connect()
  },
  lost: onSessionLost
})

// ── Which languages have a server ────────────────────────────────────────

const languageListeners = new Set<() => void>()
let languagesQueued = false

/** Called (once per burst) whenever the set of servers behind the open documents may have changed. */
export function onLanguagesChanged(listener: () => void): void {
  languageListeners.add(listener)
}

function languagesChanged(): void {
  if (languagesQueued) return
  languagesQueued = true
  queueMicrotask(() => {
    languagesQueued = false
    for (const listener of languageListeners) listener()
  })
}

// ── Quiet words to the person ────────────────────────────────────────────

const HINTS_KEY = 'acp-harness.lsp-install-hints'
const failuresShown = new Set<string>()

function hintsShown(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Says, once ever per host and server, what would give a language its completion and diagnostics. */
function reportMissing(hostId: HostId, hints: LspServerHint[]): void {
  if (hints.length === 0) return
  const shown = hintsShown()
  const fresh = hints.filter((hint) => !shown.includes(`${hostId}:${hint.serverId}`))
  if (fresh.length === 0) return
  try {
    localStorage.setItem(HINTS_KEY, JSON.stringify([...shown, ...fresh.map((hint) => `${hostId}:${hint.serverId}`)]))
  } catch {
    // Storage can be unavailable; the hint then shows again next time.
  }
  const hint = fresh[0]!
  toast.message(t('No language server for these files on {host}', { host: hostLabel(hostId) }), {
    description: t('Completion and diagnostics need {name}. To install it there: {command}', { name: hint.name, command: hint.install }),
    duration: 15_000,
    action: { label: t('Language servers'), onClick: () => openSettings('input') }
  })
}

function reportFailure(hostId: HostId, serverId: string, name: string, message: string): void {
  const key = `${hostId}:${serverId}`
  if (failuresShown.has(key)) return
  failuresShown.add(key)
  toast.message(t('{name} is not running on {host}', { name, host: hostLabel(hostId) }), {
    description: message,
    duration: 15_000,
    action: { label: t('Language servers'), onClick: () => openSettings('input') }
  })
}
