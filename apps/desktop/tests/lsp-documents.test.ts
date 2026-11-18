import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { LspEvent, LspOpenResult, LspSessionInfo } from '@acp-harness/protocol'

// The document layer (lib/lsp/lsp-documents, lsp-client) against a stand-in editor and a recorded
// daemon: what it sends when a file opens, changes, is saved and closes, and what it does when a
// server restarts or stops. The real editor and connection only load in the app.

// ── Stand-ins ────────────────────────────────────────────────────────────

type Listener<T> = (event: T) => void

class FakeModel {
  private version = 1
  private readonly changeListeners = new Set<Listener<unknown>>()
  private readonly disposeListeners = new Set<() => void>()
  disposed = false
  constructor(
    readonly uri: { toString(): string },
    private text: string,
    private readonly language = 'typescript'
  ) {}
  getValue = () => this.text
  getVersionId = () => this.version
  getLanguageId = () => this.language
  isDisposed = () => this.disposed
  onDidChangeContent(listener: Listener<unknown>) {
    this.changeListeners.add(listener)
    return { dispose: () => this.changeListeners.delete(listener) }
  }
  onWillDispose(listener: () => void) {
    this.disposeListeners.add(listener)
    return { dispose: () => this.disposeListeners.delete(listener) }
  }
  /** Replaces columns [from, to) of line 1, as one typed edit. */
  edit(from: number, to: number, text: string): void {
    this.text = this.text.slice(0, from - 1) + text + this.text.slice(to - 1)
    this.version++
    const change = { range: { startLineNumber: 1, startColumn: from, endLineNumber: 1, endColumn: to }, rangeOffset: from - 1, rangeLength: to - from, text }
    for (const listener of [...this.changeListeners]) listener({ versionId: this.version, changes: [change] })
  }
  dispose(): void {
    this.disposed = true
    for (const listener of [...this.disposeListeners]) listener()
  }
}

const markers = new Map<string, unknown[]>()
const fakeMonaco = {
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  editor: {
    setModelMarkers: (model: FakeModel, owner: string, list: unknown[]) => void markers.set(`${model.uri.toString()} ${owner}`, list),
    getModel: () => null,
    getEditors: () => [],
    registerCommand: () => ({ dispose() {} }),
    registerEditorOpener: () => ({ dispose() {} })
  }
}

interface Call {
  method: string
  params: any
  hostId: string
}
const calls: Call[] = []
let openResult: (params: any) => LspOpenResult = () => ({ languageId: 'typescript', sessions: [], failed: [], missing: [] })
let requestResult: (params: any) => unknown = () => ({ result: null })
let reachable = true

const state = { editorTabs: [] as { id: string; kind: string; workspaceId: string; path: string; dirty?: boolean }[], hosts: { local: { connection: { kind: 'connected' } } } as Record<string, { connection: { kind: string } }> }
const stateListeners = new Set<() => void>()
function setState(change: () => void): void {
  change()
  for (const listener of [...stateListeners]) listener()
}
const toasts: { title: string; description?: string }[] = []
const storage = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) } })

mock.module('@/lib/monaco-setup', () => ({ monaco: fakeMonaco }))
mock.module('@/daemon-connection', () => ({
  harnessRequest: async (method: string, params: any, hostId: string) => {
    if (!reachable) throw new Error('offline')
    calls.push({ method, params, hostId })
    if (method === '_harness/lsp/open') return openResult(params)
    if (method === '_harness/lsp/request') return requestResult(params)
    return {}
  }
}))
mock.module('@/session-store', () => ({
  LOCAL_HOST: 'local',
  getState: () => state,
  findWorkspace: (id: string) => (id === 'remote-ws' ? { hostId: 'ssh:box' } : { hostId: 'local' }),
  hostLabel: (id: string) => id,
  whenState: (test: (s: typeof state) => boolean) =>
    new Promise<boolean>((resolve) => {
      if (test(state)) return resolve(true)
      const listener = () => {
        if (!test(state)) return
        stateListeners.delete(listener)
        resolve(true)
      }
      stateListeners.add(listener)
    })
}))
mock.module('sonner', () => ({
  toast: {
    message: (title: string, options?: { description?: string }) => void toasts.push({ title, description: options?.description }),
    error: (title: string, options?: { description?: string }) => void toasts.push({ title, description: options?.description }),
    warning: () => undefined,
    info: () => undefined
  }
}))
mock.module('@/stores/app-overlay-store', () => ({ openSettings: () => undefined }))

const { trackDocument, documentOf, onLanguagesChanged } = await import('../src/lib/lsp/lsp-documents.ts')
const { LSP_CLIENT_ID } = await import('../src/lib/lsp/lsp-client.ts')
const { dispatchLspEvent } = await import('../src/lib/lsp/lsp-events.ts')

// ── Helpers ──────────────────────────────────────────────────────────────

let counter = 0
function sessionInfo(overrides: Partial<LspSessionInfo> = {}): LspSessionInfo {
  return {
    sessionId: `s${++counter}`,
    serverId: 'typescript',
    name: 'TypeScript',
    role: 'primary',
    generation: 0,
    capabilities: { textDocumentSync: { openClose: true, change: 2, save: { includeText: true } }, hoverProvider: true },
    registrations: [],
    ...overrides
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))
const sent = (kind: 'notify' | 'request', method?: string) => calls.filter((c) => c.method === `_harness/lsp/${kind}` && (!method || c.params.method === method))
const event = (body: Record<string, unknown>, hostId = 'local') => dispatchLspEvent(hostId, { clientId: LSP_CLIENT_ID, ...body } as LspEvent)

async function openFile(text = 'let a = 1', info = sessionInfo(), workspaceId = 'ws', path = `src/file${counter}.ts`) {
  openResult = () => ({ languageId: 'typescript', sessions: [info], failed: [], missing: [] })
  const model = new FakeModel(fakeMonaco.Uri.parse(`file:///__harness/${workspaceId}/${path}`), text)
  state.editorTabs.push({ id: `tab-${path}`, kind: 'file', workspaceId, path })
  trackDocument(model as never, { workspaceId, path })
  await settle()
  return { model, info, path, uri: `file:///__harness/${workspaceId}/${path}`, doc: documentOf(model as never)! }
}

beforeEach(() => {
  calls.length = 0
  toasts.length = 0
  markers.clear()
  reachable = true
  requestResult = () => ({ result: null })
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('document sync', () => {
  test('a file is opened on its servers with its text, on the workspace’s own host', async () => {
    const { info, uri } = await openFile('const x = 1', sessionInfo(), 'remote-ws', 'src/remote.ts')
    const open = calls.find((c) => c.method === '_harness/lsp/open')!
    expect(open.hostId).toBe('ssh:box')
    expect(open.params).toEqual({ clientId: LSP_CLIENT_ID, workspaceId: 'remote-ws', path: 'src/remote.ts', languageId: 'typescript' })
    const [didOpen] = sent('notify')
    expect(didOpen!.hostId).toBe('ssh:box')
    expect(didOpen!.params).toEqual({
      clientId: LSP_CLIENT_ID,
      sessionId: info.sessionId,
      seq: 0,
      method: 'textDocument/didOpen',
      params: { textDocument: { uri, languageId: 'typescript', version: 1, text: 'const x = 1' } }
    })
  })

  test('typing sends only what changed, numbered in the order it was typed', async () => {
    const { model, uri } = await openFile('let a = 1')
    model.edit(1, 4, 'const')
    model.edit(11, 11, ';')
    const changes = sent('notify', 'textDocument/didChange')
    expect(changes.map((c) => c.params.seq)).toEqual([1, 2])
    expect(changes[0]!.params.params).toEqual({
      textDocument: { uri, version: 2 },
      contentChanges: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, rangeLength: 3, text: 'const' }]
    })
    expect(changes[1]!.params.params.textDocument.version).toBe(3)
  })

  test('a server that wants whole documents gets the whole text', async () => {
    const { model } = await openFile('abc', sessionInfo({ capabilities: { textDocumentSync: 1 } }))
    model.edit(4, 4, 'd')
    expect(sent('notify', 'textDocument/didChange')[0]!.params.params.contentChanges).toEqual([{ text: 'abcd' }])
  })

  test('a file a model was already tracked for is not opened twice', async () => {
    const { model } = await openFile()
    trackDocument(model as never)
    await settle()
    expect(sent('notify', 'textDocument/didOpen')).toHaveLength(1)
  })

  test('the tab’s unsaved mark clearing is the save, told with the text when the server wants it', async () => {
    const { model, path, uri } = await openFile('a')
    const tab = state.editorTabs.find((t) => t.path === path)!
    model.edit(2, 2, 'b')
    // The editor marks the tab right after the change.
    setState(() => (tab.dirty = true))
    await settle()
    expect(sent('notify', 'textDocument/didSave')).toHaveLength(0)
    setState(() => (tab.dirty = false))
    await settle()
    expect(sent('notify', 'textDocument/didSave').map((c) => c.params.params)).toEqual([{ textDocument: { uri }, text: 'ab' }])
    // Another round works the same.
    model.edit(3, 3, 'c')
    setState(() => (tab.dirty = true))
    await settle()
    setState(() => (tab.dirty = false))
    await settle()
    expect(sent('notify', 'textDocument/didSave')).toHaveLength(2)
  })

  test('closing the tab (its model disposed) closes the document on its servers', async () => {
    const { model, uri } = await openFile()
    model.dispose()
    expect(sent('notify', 'textDocument/didClose').map((c) => c.params.params)).toEqual([{ textDocument: { uri } }])
    expect(documentOf(model as never)).toBeNull()
    model.edit(1, 1, 'x')
    expect(sent('notify', 'textDocument/didChange')).toHaveLength(0)
  })
})

describe('diagnostics', () => {
  const diagnostic = { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, severity: 1, message: 'bad', source: 'ts', code: 2322 }

  test('published diagnostics become markers under the server’s own owner, and an empty list clears them', async () => {
    const { info, uri, doc } = await openFile()
    event({ kind: 'notification', sessionId: info.sessionId, method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [diagnostic] } })
    expect(markers.get(`${uri} lsp:typescript`)).toEqual([{ startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 6, severity: 8, message: 'bad', source: 'ts', code: '2322' }])
    expect(doc.diagnosticsFrom(doc.allSessions[0]!)).toEqual([diagnostic])
    event({ kind: 'notification', sessionId: info.sessionId, method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } })
    expect(markers.get(`${uri} lsp:typescript`)).toEqual([])
  })

  test('another window’s events are not this window’s', async () => {
    const { info, uri } = await openFile()
    dispatchLspEvent('local', { clientId: 'another-window', kind: 'notification', sessionId: info.sessionId, method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [diagnostic] } })
    expect(markers.has(`${uri} lsp:typescript`)).toBe(false)
  })

  test('a server that is asked for diagnostics is asked after opening and after typing pauses', async () => {
    requestResult = (params) => (params.method === 'textDocument/diagnostic' ? { result: { kind: 'full', resultId: 'r1', items: [diagnostic] } } : { result: null })
    const { model, uri } = await openFile('let a = 1', sessionInfo({ capabilities: { textDocumentSync: 2, diagnosticProvider: { identifier: 'ts' } } }))
    await new Promise((resolve) => setTimeout(resolve, 450))
    const pulls = sent('request', 'textDocument/diagnostic')
    expect(pulls).toHaveLength(1)
    expect(pulls[0]!.params.params).toEqual({ textDocument: { uri }, identifier: 'ts' })
    expect(markers.get(`${uri} lsp:typescript`)).toHaveLength(1)
    // Two quick edits, one more pull, carrying the last result's id.
    model.edit(1, 1, 'x')
    model.edit(1, 1, 'y')
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(sent('request', 'textDocument/diagnostic')).toHaveLength(2)
    expect(sent('request', 'textDocument/diagnostic')[1]!.params.params.previousResultId).toBe('r1')
    // The request follows the changes it is about.
    const seqs = calls.filter((c) => c.params?.seq !== undefined).map((c) => c.params.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  })
})

describe('servers coming and going', () => {
  test('a restarted server gets every document it had again, with the text as it is now', async () => {
    const { model, info, uri } = await openFile('one')
    event({ kind: 'state', sessionId: info.sessionId, state: 'restarting', generation: 0 })
    model.edit(4, 4, ' two')
    event({ kind: 'state', sessionId: info.sessionId, state: 'ready', generation: 1, capabilities: info.capabilities })
    const opens = sent('notify', 'textDocument/didOpen')
    expect(opens).toHaveLength(2)
    expect(opens[1]!.params.params.textDocument).toEqual({ uri, languageId: 'typescript', version: 2, text: 'one two' })
  })

  test('a server that fails for good takes its markers with it and is mentioned once', async () => {
    const { info, uri, doc } = await openFile()
    event({ kind: 'notification', sessionId: info.sessionId, method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'm' }] } })
    event({ kind: 'state', sessionId: info.sessionId, state: 'failed', generation: 3, message: 'TypeScript exited (1); it keeps crashing, so it was not started again' })
    expect(markers.get(`${uri} lsp:typescript`)).toEqual([])
    expect(doc.allSessions).toEqual([])
    expect(toasts).toEqual([{ title: 'TypeScript is not running on local', description: 'TypeScript exited (1); it keeps crashing, so it was not started again' }])
  })

  test('when a host’s server commands change, its documents ask again and move to the new server', async () => {
    const { info, uri, doc } = await openFile()
    const replacement = sessionInfo({ serverId: 'vtsls', name: 'vtsls' })
    openResult = () => ({ languageId: 'typescript', sessions: [replacement], failed: [], missing: [] })
    dispatchLspEvent('local', { clientId: '*', kind: 'servers-changed' })
    await settle()
    expect(doc.allSessions.map((s) => s.sessionId)).toEqual([replacement.sessionId])
    expect(sent('notify', 'textDocument/didClose').some((c) => c.params.sessionId === info.sessionId && c.params.params.textDocument.uri === uri)).toBe(true)
    expect(sent('notify', 'textDocument/didOpen').some((c) => c.params.sessionId === replacement.sessionId)).toBe(true)
  })

  test('a language with no server installed is mentioned once ever, with the install command', async () => {
    const hint = { serverId: 'rust', name: 'rust-analyzer', command: 'rust-analyzer', install: 'rustup component add rust-analyzer' }
    for (const path of ['a.rs', 'b.rs']) {
      openResult = () => ({ languageId: 'rust', sessions: [], failed: [], missing: [hint] })
      trackDocument(new FakeModel(fakeMonaco.Uri.parse(`file:///__harness/ws/${path}`), '', 'rust') as never, { workspaceId: 'ws', path })
      await settle()
    }
    expect(toasts).toEqual([
      { title: 'No language server for these files on local', description: 'Completion and diagnostics need rust-analyzer. To install it there: rustup component add rust-analyzer' }
    ])
    expect(JSON.parse(storage.get('acp-harness.lsp-install-hints')!)).toEqual(['local:rust'])
  })

  test('the set of served languages is announced when it may have changed', async () => {
    let announced = 0
    onLanguagesChanged(() => announced++)
    const { model } = await openFile()
    expect(announced).toBeGreaterThan(0)
    const before = announced
    model.dispose()
    await settle()
    expect(announced).toBeGreaterThan(before)
  })

  test('an unreachable host is quiet, and its documents open once it is back', async () => {
    reachable = false
    const model = new FakeModel(fakeMonaco.Uri.parse('file:///__harness/ws/src/late.ts'), 'late')
    trackDocument(model as never, { workspaceId: 'ws', path: 'src/late.ts' })
    await settle()
    expect(calls).toEqual([])
    expect(toasts).toEqual([])
    setState(() => (state.hosts.local!.connection.kind = 'offline'))
    await settle()
    reachable = true
    const info = sessionInfo()
    openResult = () => ({ languageId: 'typescript', sessions: [info], failed: [], missing: [] })
    setState(() => (state.hosts.local!.connection.kind = 'connected'))
    await settle()
    const opened = sent('notify', 'textDocument/didOpen').filter((c) => c.params.params.textDocument.uri === 'file:///__harness/ws/src/late.ts')
    expect(opened).toHaveLength(1)
    expect(opened[0]!.params.params.textDocument.text).toBe('late')
  })
})
