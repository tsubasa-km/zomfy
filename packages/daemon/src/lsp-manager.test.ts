import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LspEvent, LspSessionInfo } from '@acp-harness/protocol'
import { LanguageServerManager, type LspManagerOptions } from './lsp-manager.ts'
import type { LspServerSpec } from './lsp-server-catalog.ts'
import { HOST_FLAVOR, pathToFileUri } from './lsp-uris.ts'

// The server is a scripted one (lsp-fake-server.fixture.ts) run as a real child process over stdio.
const fixture = join(import.meta.dir, 'lsp-fake-server.fixture.ts')
const FAKE: LspServerSpec = {
  id: 'fake',
  name: 'Fake',
  role: 'primary',
  languages: ['fake'],
  candidates: [],
  rootMarkers: [],
  install: 'install-fake',
  settings: () => ({ fake: { level: 3 } })
}
const CLIENT = 'window-1'
const WS = 'ws1'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
}, 30_000)

function setup(overrides: Partial<LspManagerOptions> & { flags?: string[]; spec?: LspServerSpec } = {}) {
  const outer = realpathSync.native(mkdtempSync(join(tmpdir(), 'lsp-test-')))
  const root = join(outer, 'repo')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.fake'), 'hello')
  const events: LspEvent[] = []
  const waiters: (() => void)[] = []
  const { flags = [], spec = FAKE, ...options } = overrides
  const manager = new LanguageServerManager({
    workspaceRoot: (id) => {
      if (id !== WS) throw new Error(`Unknown workspace ${id}`)
      return root
    },
    send: (event) => {
      events.push(event)
      for (const wake of waiters.splice(0)) wake()
    },
    serversFor: async (languageId) => (spec.languages.includes(languageId) ? [{ spec, override: {} }] : []),
    resolve: async () => ({ status: 'ready', argv: [process.execPath, fixture, ...flags], display: 'fake' }),
    ...options
  })
  cleanups.push(async () => {
    await manager.dispose()
    // A process that was killed rather than asked to exit holds its folder for a moment on Windows.
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(outer, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt > 30) throw error
        await Bun.sleep(100)
      }
    }
  })
  /** Resolves with the first event (from `from` on) that matches. */
  async function event<T extends LspEvent>(match: (e: LspEvent) => e is T, from = 0, ms = 10_000): Promise<T> {
    const deadline = Date.now() + ms
    for (;;) {
      const found = events.slice(from).find(match)
      if (found) return found
      if (Date.now() > deadline) throw new Error(`no such event; got ${JSON.stringify(events.slice(from))}`)
      await Promise.race([new Promise<void>((resolve) => waiters.push(resolve)), Bun.sleep(50)])
    }
  }
  const seqs = new Map<string, number>()
  const next = (sessionId: string) => {
    const seq = seqs.get(sessionId) ?? 0
    seqs.set(sessionId, seq + 1)
    return seq
  }
  let requests = 0
  const client = {
    open: (path = 'src/a.fake', clientId = CLIENT) => manager.open({ clientId, workspaceId: WS, path, languageId: 'fake' }),
    notify: (session: LspSessionInfo, method: string, params: unknown) => manager.notify({ clientId: CLIENT, sessionId: session.sessionId, seq: next(session.sessionId), method, params }),
    async request<T = any>(session: LspSessionInfo, method: string, params: unknown, requestId = `r${requests++}`): Promise<T> {
      const answer = await manager.request({ clientId: CLIENT, sessionId: session.sessionId, seq: next(session.sessionId), requestId, method, params })
      if ('error' in answer) throw Object.assign(new Error(answer.error.message), { code: answer.error.code })
      return answer.result as T
    },
    didOpen: (session: LspSessionInfo, path: string, text: string, version = 1) =>
      client.notify(session, 'textDocument/didOpen', { textDocument: { uri: `file:///__harness/${WS}/${path}`, languageId: 'fake', version, text } })
  }
  return { manager, root, outer, events, event, client }
}

const isDiagnostics = (e: LspEvent): e is Extract<LspEvent, { kind: 'notification' }> => e.kind === 'notification' && e.method === 'textDocument/publishDiagnostics'
const isState =
  (state: string) =>
  (e: LspEvent): e is Extract<LspEvent, { kind: 'state' }> =>
    e.kind === 'state' && e.state === state

describe('language server lifecycle', () => {
  test('a server starts with the first file of its language and is shared by the next', async () => {
    const { manager, client, root } = setup()
    expect(manager.sessionCount).toBe(0)
    const first = await client.open()
    expect(manager.sessionCount).toBe(1)
    expect(first.languageId).toBe('fake')
    expect(first.missing).toEqual([])
    const session = first.sessions[0]!
    expect(session).toMatchObject({ serverId: 'fake', name: 'Fake', role: 'primary', generation: 0 })
    expect(session.capabilities).toMatchObject({ hoverProvider: true, completionProvider: { triggerCharacters: ['.'] } })
    const again = await client.open('src/b.fake')
    expect(again.sessions[0]!.sessionId).toBe(session.sessionId)
    expect(manager.sessionCount).toBe(1)
    // Started in the workspace, and told its real path.
    const state = await client.request(session, 'fake/state', {})
    expect(state.root).toBe(pathToFileUri(root, HOST_FLAVOR))
    expect(state.received.slice(0, 2)).toEqual(['initialize', 'initialized'])
    // Its settings went out once it was up.
    expect(state.received).toContain('workspace/didChangeConfiguration')
  })

  test('each window gets its own server for the same workspace', async () => {
    const { manager, client } = setup()
    const one = await client.open('src/a.fake', 'window-1')
    const two = await client.open('src/a.fake', 'window-2')
    expect(one.sessions[0]!.sessionId).not.toBe(two.sessions[0]!.sessionId)
    expect(manager.sessionCount).toBe(2)
  })

  test('a language nothing serves starts nothing and says nothing', async () => {
    const { manager } = setup()
    const result = await manager.open({ clientId: CLIENT, workspaceId: WS, path: 'notes.md', languageId: 'markdown' })
    expect(result).toEqual({ languageId: 'markdown', sessions: [], failed: [], missing: [] })
    expect(manager.sessionCount).toBe(0)
  })

  test('a server that is not installed is reported with the command that would install it', async () => {
    const { manager, client } = setup({ resolve: async () => ({ status: 'missing', detail: '`fake-ls` is not on PATH' }) })
    const result = await client.open()
    expect(result.sessions).toEqual([])
    expect(result.missing).toEqual([{ serverId: 'fake', name: 'Fake', command: 'fake', install: 'install-fake' }])
    expect(manager.sessionCount).toBe(0)
  })

  test('a server that will not start is reported and forgotten, and nothing announces it', async () => {
    const { manager, client, events } = setup({ flags: ['--fail-start'] })
    const result = await client.open()
    expect(result.sessions).toEqual([])
    expect(result.failed[0]!.message).toMatch(/Fake would not start.*refuses to start/)
    expect(manager.sessionCount).toBe(0)
    expect(events).toEqual([])
  })

  test('a crashed server is started again and its documents are expected anew', async () => {
    const { client, event, events } = setup({ timings: { restartBackoffMs: [20] } })
    const session = (await client.open()).sessions[0]!
    client.didOpen(session, 'src/a.fake', 'BUG')
    await event(isDiagnostics)
    const before = await client.request(session, 'fake/state', {})
    const slow = client.request(session, 'fake/slow', {}).catch((error: Error) => error.message)
    client.notify(session, 'fake/crash', {})
    // What was in flight fails rather than hanging.
    expect(await slow).toMatch(/Fake exited/)
    const restarting = await event(isState('restarting'))
    expect(restarting.generation).toBe(0)
    const ready = await event(isState('ready'))
    expect(ready).toMatchObject({ clientId: CLIENT, sessionId: session.sessionId, generation: 1 })
    expect(ready.capabilities).toMatchObject({ hoverProvider: true })
    const after = await client.request(session, 'fake/state', {})
    expect(after.pid).not.toBe(before.pid)
    // The new process knows no documents: a change for the old one is dropped, an open is taken.
    const mark = events.length
    client.notify(session, 'textDocument/didChange', { textDocument: { uri: `file:///__harness/${WS}/src/a.fake`, version: 2 }, contentChanges: [{ text: 'x' }] })
    client.didOpen(session, 'src/a.fake', 'still a BUG', 3)
    const diagnostics = await event(isDiagnostics, mark)
    expect((diagnostics.params as any).diagnostics[0].message).toBe('BUG at 8 in version 3')
    expect((await client.request(session, 'fake/state', {})).received).not.toContain('textDocument/didChange')
  })

  test('a server that keeps crashing is given up on', async () => {
    const { manager, client, event } = setup({ timings: { restartBackoffMs: [10], maxCrashes: 2 } })
    const session = (await client.open()).sessions[0]!
    for (let generation = 0; generation < 3; generation++) {
      client.didOpen(session, 'src/a.fake', 'x')
      client.notify(session, 'fake/crash', {})
      if (generation < 2) await event((e): e is LspEvent => e.kind === 'state' && e.state === 'ready' && e.generation === generation + 1)
    }
    const failed = await event(isState('failed'))
    expect(failed.message).toMatch(/keeps crashing/)
    expect(manager.sessionCount).toBe(0)
    expect(await manager.request({ clientId: CLIENT, sessionId: session.sessionId, seq: 99, requestId: 'x', method: 'fake/state', params: {} })).toMatchObject({ error: { code: -32002 } })
  })

  test('a server with no open document is shut down cleanly after a while, and the next file starts a new one', async () => {
    const exitFile = join(tmpdir(), `lsp-exit-${crypto.randomUUID()}`)
    cleanups.push(() => rmSync(exitFile, { force: true }))
    const { manager, client, event } = setup({ flags: [`--exit-file=${exitFile}`], timings: { idleMs: 300 } })
    const session = (await client.open()).sessions[0]!
    client.didOpen(session, 'src/a.fake', 'x')
    await Bun.sleep(600)
    // Still open, so still running.
    expect(manager.sessionCount).toBe(1)
    client.notify(session, 'textDocument/didClose', { textDocument: { uri: `file:///__harness/${WS}/src/a.fake` } })
    const stopped = await event(isState('stopped'))
    expect(stopped.sessionId).toBe(session.sessionId)
    expect(manager.sessionCount).toBe(0)
    // It was asked to shut down and exit, not killed.
    for (let i = 0; i < 100 && !existsSync(exitFile); i++) await Bun.sleep(30)
    expect(readFileSync(exitFile, 'utf8')).toBe('exit')
    const reopened = (await client.open()).sessions[0]!
    expect(reopened.sessionId).not.toBe(session.sessionId)
  })

  test('a window that goes silent loses its servers; one that keeps calling does not', async () => {
    const { manager, client, event } = setup({ timings: { clientTtlMs: 400 } })
    const session = (await client.open()).sessions[0]!
    client.didOpen(session, 'src/a.fake', 'x')
    for (let i = 0; i < 6; i++) {
      await Bun.sleep(150)
      manager.keepAlive(CLIENT)
    }
    expect(manager.sessionCount).toBe(1)
    const stopped = await event(isState('stopped'))
    expect(stopped.message).toMatch(/window closed/)
    expect(manager.sessionCount).toBe(0)
  })

  test('disposing the manager stops every server', async () => {
    const exitFile = join(tmpdir(), `lsp-exit-${crypto.randomUUID()}`)
    cleanups.push(() => rmSync(exitFile, { force: true }))
    const { manager, client } = setup({ flags: [`--exit-file=${exitFile}`] })
    const session = (await client.open()).sessions[0]!
    client.didOpen(session, 'src/a.fake', 'x')
    await manager.dispose()
    expect(manager.sessionCount).toBe(0)
    for (let i = 0; i < 100 && !existsSync(exitFile); i++) await Bun.sleep(30)
    expect(existsSync(exitFile)).toBe(true)
  })
})

describe('language server relay', () => {
  test('requests reach the server with real paths and come back with window URIs', async () => {
    const { client, root } = setup()
    const session = (await client.open()).sessions[0]!
    const windowUri = `file:///__harness/${WS}/src/my%20file.fake`
    const serverUri = pathToFileUri(join(root, 'src', 'my file.fake'), HOST_FLAVOR)
    client.didOpen(session, 'src/my%20file.fake', 'hello')
    const completion = await client.request(session, 'textDocument/completion', { textDocument: { uri: windowUri }, position: { line: 0, character: 5 } })
    const item = completion.items[0]
    // `detail` is the URI the server saw; `data` is opaque and goes back exactly as it came.
    expect(item.detail).toBe(serverUri)
    expect(item.data).toEqual({ uri: serverUri })
    expect(item.textEdit).toEqual({ range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } }, newText: 'fakeItem(${1:arg})' })
    const resolved = await client.request(session, 'completionItem/resolve', item)
    expect(resolved.documentation.value).toBe(`resolved with data.uri ${serverUri}`)

    const definition = await client.request(session, 'textDocument/definition', { textDocument: { uri: windowUri }, position: { line: 0, character: 0 } })
    expect(definition[0].uri).toBe(windowUri)
    // Outside the workspace: named as an external file, which can then be read through the session.
    expect(definition[1].uri.startsWith(`file:///__harness-external/${WS}/`)).toBe(true)
    expect(decodeURIComponent(definition[1].uri).replaceAll('\\', '/').toLowerCase()).toContain('outside-lib/lib.d.ts')

    const rename = await client.request(session, 'textDocument/rename', { textDocument: { uri: windowUri }, position: { line: 0, character: 0 }, newName: 'n' })
    expect(Object.keys(rename.changes)).toEqual([windowUri])
    expect(rename.documentChanges[0].textDocument.uri).toBe(`file:///__harness/${WS}/src/other.ts`)
  })

  test('a file outside the workspace is readable only once the server has pointed at it', async () => {
    const { manager, client, outer } = setup()
    const session = (await client.open()).sessions[0]!
    mkdirSync(join(outer, 'outside-lib'))
    writeFileSync(join(outer, 'outside-lib', 'lib.d.ts'), 'declare const lib: number')
    const windowUri = `file:///__harness/${WS}/src/a.fake`
    const guess = `file:///__harness-external/${WS}/${join(outer, 'outside-lib', 'lib.d.ts').replaceAll('\\', '/').replace(/^\//, '').split('/').map(encodeURIComponent).join('/')}`
    await expect(manager.readExternal({ clientId: CLIENT, sessionId: session.sessionId, uri: guess })).rejects.toThrow(/Not a file/)
    const definition = await client.request(session, 'textDocument/definition', { textDocument: { uri: windowUri }, position: { line: 0, character: 0 } })
    const read = await manager.readExternal({ clientId: CLIENT, sessionId: session.sessionId, uri: definition[1].uri })
    expect(read.content).toBe('declare const lib: number')
    expect(dirname(read.path).toLowerCase()).toBe(join(outer, 'outside-lib').toLowerCase())
    // Another window's id does not open this session.
    await expect(manager.readExternal({ clientId: 'someone-else', sessionId: session.sessionId, uri: definition[1].uri })).rejects.toThrow()
  })

  test('document sync and diagnostics flow both ways, incremental changes included', async () => {
    const { client, event, events } = setup()
    const session = (await client.open()).sessions[0]!
    const uri = `file:///__harness/${WS}/src/a.fake`
    client.didOpen(session, 'src/a.fake', 'line one\nBUG here')
    const first = await event(isDiagnostics)
    expect(first).toMatchObject({ clientId: CLIENT, sessionId: session.sessionId })
    expect(first.params).toMatchObject({ uri, version: 1, diagnostics: [{ message: 'BUG at 9 in version 1', source: 'fake', code: 'fake-bug' }] })
    let mark = events.length
    client.notify(session, 'textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [
        { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, text: 'ok' },
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: '// ' }
      ]
    })
    expect((await event(isDiagnostics, mark)).params).toMatchObject({ uri, version: 2, diagnostics: [] })
    const hover = await client.request(session, 'textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 0 } })
    expect(hover.contents.value).toBe('text is "// line one\\nok here"')
    // Opening it again (a window that reconnected) closes it first, so the server never sees it open twice.
    mark = events.length
    client.didOpen(session, 'src/a.fake', 'BUG', 5)
    expect((await event(isDiagnostics, mark)).params).toMatchObject({ version: 5 })
    const state = await client.request(session, 'fake/state', {})
    expect(state.received.filter((m: string) => m.startsWith('textDocument/did'))).toEqual([
      'textDocument/didOpen',
      'textDocument/didChange',
      'textDocument/didClose',
      'textDocument/didOpen'
    ])
    expect(state.open).toHaveLength(1)
  })

  test('diagnostics for a file the window has not opened wait until it opens it', async () => {
    const { client, event, events } = setup()
    const session = (await client.open()).sessions[0]!
    client.didOpen(session, 'src/a.fake', 'ELSEWHERE')
    await event(isDiagnostics)
    await client.request(session, 'fake/echo', {})
    const other = `file:///__harness/${WS}/src/other.ts`
    expect(events.filter(isDiagnostics).some((e) => (e.params as any).uri === other)).toBe(false)
    const mark = events.length
    client.didOpen(session, 'src/other.ts', 'x')
    const held = await event((e): e is Extract<LspEvent, { kind: 'notification' }> => isDiagnostics(e) && (e.params as any).diagnostics.length > 0, mark)
    expect(held.params).toMatchObject({ uri: other, diagnostics: [{ message: 'elsewhere' }] })
  })

  test('messages are delivered in the order the window sent them, even when they arrive out of order', async () => {
    const { manager, client } = setup({ timings: { gapMs: 5_000 } })
    const session = (await client.open()).sessions[0]!
    const uri = `file:///__harness/${WS}/src/a.fake`
    const send = (seq: number, method: string, params: unknown) => manager.notify({ clientId: CLIENT, sessionId: session.sessionId, seq, method, params })
    // seq 2 (a hover) and seq 1 (a change) arrive before seq 0 (the open).
    const hover = manager.request({ clientId: CLIENT, sessionId: session.sessionId, seq: 2, requestId: 'h', method: 'textDocument/hover', params: { textDocument: { uri }, position: { line: 0, character: 0 } } })
    send(1, 'textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: 'second' }] })
    send(0, 'textDocument/didOpen', { textDocument: { uri, languageId: 'fake', version: 1, text: 'first' } })
    expect(await hover).toEqual({ result: { contents: { kind: 'markdown', value: 'text is "second"' } } })
  })

  test('a message that never arrives does not hold the rest back for good', async () => {
    const { manager, client } = setup({ timings: { gapMs: 100 } })
    const session = (await client.open()).sessions[0]!
    const answer = await manager.request({ clientId: CLIENT, sessionId: session.sessionId, seq: 5, requestId: 'e', method: 'fake/echo', params: { n: 1 } })
    expect(answer).toEqual({ result: { n: 1 } })
  })

  test('a cancelled request is cancelled on the server', async () => {
    const { manager, client } = setup()
    const session = (await client.open()).sessions[0]!
    const slow = client.request(session, 'fake/slow', {}, 'slow-1').catch((error: Error & { code?: number }) => error.code)
    await client.request(session, 'fake/echo', {})
    manager.cancel({ clientId: CLIENT, sessionId: session.sessionId, requestId: 'slow-1' })
    expect(await slow).toBe(-32800)
  })

  test('a request the server never answers times out', async () => {
    const { client } = setup({ timings: { requestMs: 150 } })
    const session = (await client.open()).sessions[0]!
    await expect(client.request(session, 'fake/slow', {})).rejects.toThrow()
  })

  test('what a server asks of its client is answered by the host, or by the window where only it can', async () => {
    const { manager, client, event } = setup()
    const session = (await client.open()).sessions[0]!
    const uri = `file:///__harness/${WS}/src/a.fake`
    const asked = client.request(session, 'fake/ask', { uri })
    const applyEdit = await event((e): e is Extract<LspEvent, { kind: 'request' }> => e.kind === 'request')
    expect(applyEdit.method).toBe('workspace/applyEdit')
    // The edit names the document as the window knows it.
    expect(Object.keys((applyEdit.params as any).edit.changes)).toEqual([uri])
    manager.respond({ clientId: CLIENT, sessionId: session.sessionId, id: applyEdit.id, result: { applied: true } })
    const answers = await asked
    expect(answers.configuration).toEqual([3, null, { fake: { level: 3 } }])
    expect(answers.registered).toBeNull()
    expect(answers.progress).toBeNull()
    // The fake hands the folder back in its answer, which is translated like any result.
    expect(answers.folders).toEqual([{ uri: `file:///__harness/${WS}/`, name: 'repo' }])
    expect(answers.applied).toEqual({ applied: true })
    expect(answers.unknown).toBe(-32601)
    const registrations = await event((e): e is Extract<LspEvent, { kind: 'registrations' }> => e.kind === 'registrations')
    expect(registrations.registrations).toEqual([{ id: 'reg-1', method: 'textDocument/formatting', registerOptions: { documentSelector: [{ language: 'fake' }] } }])
    // A file opened later hears about them with the session.
    expect((await client.open('src/b.fake')).sessions[0]!.registrations).toHaveLength(1)
  })

  test('an edit the window never answers is reported to the server as not applied', async () => {
    const { client } = setup({ timings: { windowRequestMs: 100 } })
    const session = (await client.open()).sessions[0]!
    const answers = await client.request(session, 'fake/ask', { uri: `file:///__harness/${WS}/src/a.fake` })
    expect(answers.applied).toEqual({ applied: false, failureReason: 'The editor did not answer' })
  })
})
