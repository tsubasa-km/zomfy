import { writeFileSync } from 'node:fs'
import { encodeLspMessage, LspMessageReader } from './lsp-framing.ts'

// A scripted language server for lsp-manager.test.ts and the end-to-end pass, run as its own
// process over stdio. It answers the usual requests with fixed results that name the URIs it was
// given (so a test can see what the server saw), and `fake/*` methods make it misbehave on demand.
//   --fail-start        exits before answering `initialize`
//   --exit-file=<path>  writes "exit" there when asked to exit, proving a clean shutdown

const flags = process.argv.slice(2)
const exitFile = flags.find((f) => f.startsWith('--exit-file='))?.slice('--exit-file='.length)
if (flags.includes('--fail-start')) {
  process.stderr.write('fake server refuses to start\n')
  process.exit(3)
}

type Message = { id?: number | string; method?: string; params?: any; result?: unknown; error?: { code: number; message: string } }

const documents = new Map<string, { version: number; text: string }>()
const received: string[] = []
const cancelled = new Map<number | string, () => void>()
const waiting = new Map<number, (message: Message) => void>()
let nextId = 1
let rootUri = ''

function send(message: Record<string, unknown>): void {
  process.stdout.write(encodeLspMessage({ jsonrpc: '2.0', ...message }))
}

/** A request to the client; resolves with its whole answer. */
function ask(method: string, params: unknown): Promise<Message> {
  const id = nextId++
  send({ id, method, params })
  return new Promise((resolve) => waiting.set(id, resolve))
}

function publish(uri: string): void {
  const doc = documents.get(uri)
  if (!doc) return
  const at = doc.text.indexOf('BUG')
  send({
    method: 'textDocument/publishDiagnostics',
    params: {
      uri,
      version: doc.version,
      diagnostics:
        at === -1
          ? []
          : [
              {
                range: { start: { line: 0, character: at }, end: { line: 0, character: at + 3 } },
                severity: 1,
                code: 'fake-bug',
                source: 'fake',
                message: `BUG at ${at} in version ${doc.version}`,
                data: { uri }
              }
            ]
    }
  })
}

/** A file beside the first one, which the client never opened. */
function sibling(uri: string, name: string): string {
  return uri.slice(0, uri.lastIndexOf('/') + 1) + name
}

function applyChange(text: string, change: { range?: { start: { line: number; character: number }; end: { line: number; character: number } }; text: string }): string {
  if (!change.range) return change.text
  const lines = text.split('\n')
  const offset = (p: { line: number; character: number }) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character
  return text.slice(0, offset(change.range.start)) + change.text + text.slice(offset(change.range.end))
}

async function onRequest(id: number | string, method: string, params: any): Promise<void> {
  const reply = (result: unknown) => send({ id, result })
  switch (method) {
    case 'initialize':
      rootUri = params.rootUri
      return reply({
        capabilities: {
          positionEncoding: 'utf-16',
          textDocumentSync: { openClose: true, change: 2, save: { includeText: false } },
          completionProvider: { triggerCharacters: ['.'], resolveProvider: true },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          renameProvider: { prepareProvider: true },
          documentFormattingProvider: true,
          codeActionProvider: true,
          executeCommandProvider: { commands: ['fake.command'] }
        },
        serverInfo: { name: 'fake', version: '1' }
      })
    case 'shutdown':
      return reply(null)
    case 'textDocument/completion':
      return reply({
        isIncomplete: false,
        items: [
          {
            label: 'fakeItem',
            kind: 3,
            detail: params.textDocument.uri,
            insertTextFormat: 2,
            textEdit: { range: { start: params.position, end: params.position }, newText: 'fakeItem(${1:arg})' },
            data: { uri: params.textDocument.uri }
          }
        ]
      })
    case 'completionItem/resolve':
      return reply({ ...params, documentation: { kind: 'markdown', value: `resolved with data.uri ${params.data?.uri}` } })
    case 'textDocument/hover':
      return reply({ contents: { kind: 'markdown', value: `text is ${JSON.stringify(documents.get(params.textDocument.uri)?.text ?? null)}` } })
    case 'textDocument/definition':
      return reply([
        { uri: params.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
        // One level above the project: a file outside the workspace.
        { uri: `${rootUri.slice(0, rootUri.lastIndexOf('/'))}/outside-lib/lib.d.ts`, range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } } }
      ])
    case 'textDocument/rename':
      return reply({
        changes: { [params.textDocument.uri]: [{ range: { start: params.position, end: params.position }, newText: params.newName }] },
        documentChanges: [
          { textDocument: { uri: sibling(params.textDocument.uri, 'other.ts'), version: null }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: params.newName }] }
        ]
      })
    case 'fake/state':
      return reply({ pid: process.pid, root: rootUri, open: [...documents.keys()], received, texts: Object.fromEntries([...documents].map(([uri, d]) => [uri, d.text])) })
    case 'fake/echo':
      return reply(params)
    case 'fake/slow':
      // Answers only once cancelled.
      cancelled.set(id, () => send({ id, error: { code: -32800, message: 'cancelled' } }))
      return
    case 'fake/ask': {
      // Everything a real server asks of its client while starting, and an edit only the editor can apply.
      const configuration = await ask('workspace/configuration', { items: [{ section: 'fake.level' }, { section: 'missing' }, { scopeUri: params.uri }] })
      const registered = await ask('client/registerCapability', { registrations: [{ id: 'reg-1', method: 'textDocument/formatting', registerOptions: { documentSelector: [{ language: 'fake' }] } }] })
      const progress = await ask('window/workDoneProgress/create', { token: 'p1' })
      const folders = await ask('workspace/workspaceFolders', null)
      const applied = await ask('workspace/applyEdit', { label: 'fake edit', edit: { changes: { [params.uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }] } } })
      const unknown = await ask('fake/unknownRequest', {})
      return reply({ configuration: configuration.result, registered: registered.result, progress: progress.result, folders: folders.result, applied: applied.result, unknown: unknown.error?.code })
    }
    default:
      return send({ id, error: { code: -32601, message: `fake server has no ${method}` } })
  }
}

function onNotification(method: string, params: any): void {
  switch (method) {
    case 'textDocument/didOpen': {
      const { uri, version, text } = params.textDocument
      documents.set(uri, { version, text })
      publish(uri)
      // A project-wide check reporting a file nobody opened.
      if (text.includes('ELSEWHERE')) {
        send({
          method: 'textDocument/publishDiagnostics',
          params: { uri: sibling(uri, 'other.ts'), diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 2, message: 'elsewhere' }] }
        })
      }
      return
    }
    case 'textDocument/didChange': {
      const doc = documents.get(params.textDocument.uri)
      if (!doc) return
      for (const change of params.contentChanges) doc.text = applyChange(doc.text, change)
      doc.version = params.textDocument.version
      return publish(params.textDocument.uri)
    }
    case 'textDocument/didClose':
      documents.delete(params.textDocument.uri)
      return
    case '$/cancelRequest':
      cancelled.get(params.id)?.()
      cancelled.delete(params.id)
      return
    case 'fake/crash':
      process.exit(1)
    case 'exit':
      if (exitFile) writeFileSync(exitFile, 'exit')
      process.exit(0)
  }
}

const reader = new LspMessageReader()
process.stdin.on('data', (chunk: Buffer) => {
  for (const raw of reader.push(new Uint8Array(chunk))) {
    const message = raw as Message
    if (message.method) {
      received.push(message.method)
      if (message.id !== undefined) void onRequest(message.id, message.method, message.params)
      else onNotification(message.method, message.params)
    } else if (typeof message.id === 'number') {
      waiting.get(message.id)?.(message)
      waiting.delete(message.id)
    }
  }
})
process.stdin.on('end', () => process.exit(0))
