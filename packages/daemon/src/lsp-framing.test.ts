import { describe, expect, test } from 'bun:test'
import { encodeLspMessage, LspMessageReader } from './lsp-framing.ts'
import { fileUriToPath, LspUriTranslator, pathToFileUri, translateLspUris } from './lsp-uris.ts'

describe('LSP framing', () => {
  test('a message survives encoding, with its length counted in bytes', () => {
    const message = { jsonrpc: '2.0', method: 'x', params: { text: '日本語 ✓' } }
    const bytes = encodeLspMessage(message)
    const text = new TextDecoder().decode(bytes)
    const body = JSON.stringify(message)
    expect(text.startsWith(`Content-Length: ${new TextEncoder().encode(body).byteLength}\r\n\r\n`)).toBe(true)
    expect(new LspMessageReader().push(bytes)).toEqual([message])
  })

  test('messages are put back together from arbitrary pieces', () => {
    const a = { id: 1, result: 'é'.repeat(50) }
    const b = { method: 'two', params: [1, 2, 3] }
    const stream = new Uint8Array([...encodeLspMessage(a), ...encodeLspMessage(b)])
    for (const size of [1, 3, 7, 64, stream.byteLength]) {
      const reader = new LspMessageReader()
      const out: unknown[] = []
      // Odd sizes split headers, bodies and two-byte characters alike.
      for (let i = 0; i < stream.byteLength; i += size) out.push(...reader.push(stream.subarray(i, i + size)))
      expect(out).toEqual([a, b])
    }
  })

  test('other headers and header case are tolerated', () => {
    const body = '{"id":7}'
    const bytes = new TextEncoder().encode(`Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: ${body.length}\r\n\r\n${body}`)
    expect(new LspMessageReader().push(bytes)).toEqual([{ id: 7 }])
  })

  test('output that is not LSP is an error, not an endless wait', () => {
    expect(() => new LspMessageReader().push(new TextEncoder().encode('Usage: tool [options]\r\n\r\n'))).toThrow(/Content-Length/)
    expect(() => new LspMessageReader().push(new TextEncoder().encode('x'.repeat(10_000)))).toThrow(/no message header/)
  })
})

describe('file URIs', () => {
  test('Windows paths are written as VS Code writes them', () => {
    expect(pathToFileUri('C:\\dev\\my app\\a#b.ts', 'win32')).toBe('file:///c%3A/dev/my%20app/a%23b.ts')
    expect(pathToFileUri('\\\\server\\share\\dir\\a.ts', 'win32')).toBe('file://server/share/dir/a.ts')
    expect(fileUriToPath('file:///c%3A/dev/my%20app/a%23b.ts', 'win32')).toBe('c:\\dev\\my app\\a#b.ts')
    expect(fileUriToPath('file:///C:/dev/a.ts', 'win32')).toBe('C:\\dev\\a.ts')
    expect(fileUriToPath('file://server/share/dir/a.ts', 'win32')).toBe('\\\\server\\share\\dir\\a.ts')
  })

  test('POSIX paths (Linux, WSL) keep their case and get percent-encoded', () => {
    expect(pathToFileUri('/home/me/プロジェクト/a b.py', 'posix')).toBe('file:///home/me/%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88/a%20b.py')
    expect(fileUriToPath('file:///home/me/%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88/a%20b.py', 'posix')).toBe('/home/me/プロジェクト/a b.py')
    expect(fileUriToPath('file:///mnt/c/Users/Me', 'posix')).toBe('/mnt/c/Users/Me')
  })

  test('other schemes are not paths', () => {
    expect(fileUriToPath('untitled:Untitled-1', 'posix')).toBeNull()
    expect(fileUriToPath('file:///bad%ZZ', 'posix')).toBeNull()
  })
})

describe('URI translation', () => {
  const win = new LspUriTranslator('ws1', ['C:\\dev\\repo', 'C:\\Users\\LONGNA~1\\repo'], 'win32')
  const posix = new LspUriTranslator('ws1', ['/home/me/repo'], 'posix')

  test('a window URI becomes the real path on the host', () => {
    expect(win.toServer('file:///__harness/ws1/src/a%20b.ts')).toBe('file:///c%3A/dev/repo/src/a%20b.ts')
    expect(posix.toServer('file:///__harness/ws1/src/a%20b.ts')).toBe('file:///home/me/repo/src/a%20b.ts')
    expect(posix.toServer('file:///__harness/ws1/')).toBe('file:///home/me/repo')
  })

  test('a server URI under the workspace becomes a window URI, however the server spells it', () => {
    for (const uri of ['file:///c%3A/dev/repo/src/Main.ts', 'file:///C:/dev/repo/src/Main.ts', 'file:///c:/DEV/Repo/src/Main.ts', 'file:///C:/Users/LONGNA~1/repo/src/Main.ts']) {
      expect(win.toClient(uri)).toBe('file:///__harness/ws1/src/Main.ts')
    }
    expect(posix.toClient('file:///home/me/repo/src/a%20b%23c.py')).toBe('file:///__harness/ws1/src/a%20b%23c.py')
    // Case matters on POSIX: this is a different folder.
    expect(posix.toClient('file:///home/me/Repo/a.py')).toBe('file:///__harness-external/ws1/home/me/Repo/a.py')
    // A sibling whose name merely starts with the root's is outside it.
    expect(posix.toClient('file:///home/me/repo2/a.py')).toBe('file:///__harness-external/ws1/home/me/repo2/a.py')
  })

  test('files outside the workspace round-trip, and only ones the server named can be read', () => {
    const external = win.toClient('file:///c%3A/Users/me/.cargo/registry/lib.rs')
    expect(external).toBe('file:///__harness-external/ws1/c%3A/Users/me/.cargo/registry/lib.rs')
    expect(win.toServer(external)).toBe('file:///c%3A/Users/me/.cargo/registry/lib.rs')
    expect(win.externalPath(external)).toBe('c:\\Users\\me\\.cargo\\registry\\lib.rs')
    expect(win.externalPath('file:///__harness-external/ws1/c%3A/Windows/secret.txt')).toBeNull()
    const unc = win.toClient('file://server/share/lib.d.ts')
    expect(win.toServer(unc)).toBe('file://server/share/lib.d.ts')
    const lib = posix.toClient('file:///usr/lib/python3/os.py')
    expect(posix.toServer(lib)).toBe('file:///usr/lib/python3/os.py')
    expect(posix.externalPath(lib)).toBe('/usr/lib/python3/os.py')
  })

  test('another workspace’s URIs and other schemes pass through untouched', () => {
    expect(posix.toServer('file:///__harness/other/a.ts')).toBe('file:///__harness/other/a.ts')
    expect(posix.toClient('jdt://contents/java.base/String.class')).toBe('jdt://contents/java.base/String.class')
  })

  test('every URI in a message is rewritten except what the server gets back verbatim', () => {
    const fromServer: unknown = {
      changes: { 'file:///home/me/repo/a.py': [{ newText: 'x' }] },
      documentChanges: [{ textDocument: { uri: 'file:///home/me/repo/b.py', version: 1 }, edits: [] }, { kind: 'rename', oldUri: 'file:///home/me/repo/c.py', newUri: 'file:///home/me/repo/d.py' }],
      links: [{ targetUri: 'file:///home/me/repo/e.py', uri: 'not-a-file' }],
      data: { uri: 'file:///home/me/repo/a.py' },
      command: { command: 'x', arguments: [{ uri: 'file:///home/me/repo/a.py' }] },
      message: 'see file:///home/me/repo/a.py'
    }
    expect(translateLspUris(fromServer, (uri) => posix.toClient(uri))).toEqual({
      changes: { 'file:///__harness/ws1/a.py': [{ newText: 'x' }] },
      documentChanges: [{ textDocument: { uri: 'file:///__harness/ws1/b.py', version: 1 }, edits: [] }, { kind: 'rename', oldUri: 'file:///__harness/ws1/c.py', newUri: 'file:///__harness/ws1/d.py' }],
      links: [{ targetUri: 'file:///__harness/ws1/e.py', uri: 'not-a-file' }],
      data: { uri: 'file:///home/me/repo/a.py' },
      command: { command: 'x', arguments: [{ uri: 'file:///home/me/repo/a.py' }] },
      message: 'see file:///home/me/repo/a.py'
    })
  })
})
