import { describe, expect, test } from 'bun:test'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import {
  DocumentTransferError,
  HOST_TOO_OLD,
  piecesOf,
  readDocumentWith,
  TRANSFER_CANCELLED,
  writeDocumentWith,
  type DocumentRequest
} from '../src/components/editor/document-transfer'

type Call = { method: string; params: Record<string, unknown> }

/** A host answering from `handlers`; a method it lacks fails the way an older daemon does. */
function host(handlers: Record<string, (params: any) => unknown>): { request: DocumentRequest; calls: Call[] } {
  const calls: Call[] = []
  const request = (async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    const handler = handlers[method]
    if (!handler) throw Object.assign(new Error('Method not found'), { code: -32601 })
    return handler(params)
  }) as DocumentRequest
  return { request, calls }
}

/** A new daemon holding `text` as a file of one byte per character, served `step` bytes at a time. */
function chunked(text: string, step: number, extra: object = {}) {
  return (params: { offset: number }) => ({
    content: text.slice(params.offset, params.offset + step),
    nextOffset: Math.min(text.length, params.offset + step),
    size: text.length,
    mtimeMs: 5,
    encoding: 'shiftjis',
    bom: false,
    binary: false,
    malformed: false,
    ...extra
  })
}

const options = { maxEditableBytes: 1000 }

describe('reading a document', () => {
  test('pieces are joined, with progress, and later pieces name the detected encoding', async () => {
    const text = 'abcdefghij'.repeat(10)
    const { request, calls } = host({ [HARNESS_METHODS.fsReadText]: chunked(text, 30) })
    const progress: number[] = []
    const opened = await readDocumentWith(request, 'w', 'a.txt', { ...options, onProgress: (loaded) => progress.push(loaded) })
    expect(opened).toMatchObject({ kind: 'text', content: text, format: { encoding: 'shiftjis', bom: false }, truncated: false, legacy: false, size: 100 })
    expect(progress).toEqual([30, 60, 90, 100])
    expect(calls[0]!.params.encoding).toBeUndefined()
    expect(calls.slice(1).every((call) => call.params.encoding === 'shiftjis')).toBe(true)
  })

  test('a file past the editable size is not read beyond its first piece', async () => {
    const { request, calls } = host({ [HARNESS_METHODS.fsReadText]: chunked('x'.repeat(5000), 100) })
    const opened = await readDocumentWith(request, 'w', 'big.log', options)
    expect(opened).toMatchObject({ kind: 'large', size: 5000, content: '' })
    expect(calls.length).toBe(1)
  })

  test('an older daemon is read the old way, and its truncation is passed on', async () => {
    const { request, calls } = host({
      [HARNESS_METHODS.fsRead]: () => ({ path: 'a.txt', content: 'first megabyte', binary: false, truncated: true, mtimeMs: 9 })
    })
    const opened = await readDocumentWith(request, 'w', 'a.txt', options)
    expect(opened).toMatchObject({ kind: 'text', content: 'first megabyte', truncated: true, legacy: true, mtimeMs: 9, format: { encoding: 'utf8', bom: false } })
    expect(calls.map((call) => call.method)).toEqual([HARNESS_METHODS.fsReadText, HARNESS_METHODS.fsRead])
    await expect(readDocumentWith(request, 'w', 'a.txt', { ...options, encoding: 'shiftjis' })).rejects.toThrow(HOST_TOO_OLD)
  })

  test('other failures are not mistaken for an older daemon', async () => {
    const { request, calls } = host({
      [HARNESS_METHODS.fsReadText]: () => {
        throw Object.assign(new Error('a.txt is not a file'), { code: -32000 })
      },
      [HARNESS_METHODS.fsRead]: () => ({})
    })
    await expect(readDocumentWith(request, 'w', 'a.txt', options)).rejects.toThrow('not a file')
    expect(calls.length).toBe(1)
  })

  test('cancelling stops between pieces', async () => {
    const controller = new AbortController()
    const { request, calls } = host({ [HARNESS_METHODS.fsReadText]: chunked('x'.repeat(500), 50) })
    const reading = readDocumentWith(request, 'w', 'a.txt', { ...options, signal: controller.signal, onProgress: (loaded) => loaded >= 100 && controller.abort() })
    await expect(reading).rejects.toThrow(TRANSFER_CANCELLED)
    await expect(reading).rejects.toBeInstanceOf(DocumentTransferError)
    expect(calls.length).toBe(2)
  })

  test('a file that changes mid-read is read again from the start', async () => {
    let version = 1
    const read = (params: { offset: number }) => {
      const piece = chunked(version === 1 ? 'old old old ' : 'new new new ', 4, { mtimeMs: version * 100 })(params)
      if (version === 1 && params.offset === 4) version = 2
      return piece
    }
    const { request } = host({ [HARNESS_METHODS.fsReadText]: read })
    expect((await readDocumentWith(request, 'w', 'a.txt', options)).content).toBe('new new new ')
  })
})

describe('saving a document', () => {
  const format = { encoding: 'shiftjis', bom: false } as const

  test('one piece is saved by the begin call alone', async () => {
    const { request, calls } = host({ [HARNESS_METHODS.fsWriteBegin]: () => ({ writeId: 'w1', saved: { mtimeMs: 7, size: 5 } }) })
    expect(await writeDocumentWith(request, 'w', 'a.txt', () => ['hello'], format, 3)).toEqual({ mtimeMs: 7, size: 5 })
    expect(calls).toEqual([
      { method: HARNESS_METHODS.fsWriteBegin, params: { workspaceId: 'w', path: 'a.txt', encoding: 'shiftjis', bom: false, expectedMtimeMs: 3, content: 'hello', commit: true } }
    ])
  })

  test('a long text goes up as begin, chunks and commit, in order', async () => {
    const got: string[] = []
    const { request, calls } = host({
      [HARNESS_METHODS.fsWriteBegin]: (p) => (got.push(p.content), { writeId: 'w1' }),
      [HARNESS_METHODS.fsWriteChunk]: (p) => (got.push(p.content), { bytes: p.content.length }),
      [HARNESS_METHODS.fsWriteCommit]: () => ({ mtimeMs: 8, size: 26 })
    })
    const saved = await writeDocumentWith(request, 'w', 'a.txt', () => ['abcdefghijklm', 'nopqrstuvwxyz'], format, undefined, { pieceChars: 5 })
    expect(saved).toEqual({ mtimeMs: 8, size: 26 })
    expect(got).toEqual(['abcde', 'fghij', 'klm', 'nopqr', 'stuvw', 'xyz'])
    expect(calls[0]!.params.commit).toBe(false)
    expect(calls.at(-1)).toEqual({ method: HARNESS_METHODS.fsWriteCommit, params: { workspaceId: 'w', writeId: 'w1' } })
    expect([...piecesOf(['', 'ab', 'cde'], 2)]).toEqual(['ab', 'cd', 'e'])
  })

  test('a failed chunk drops the save and passes the reason on', async () => {
    const { request, calls } = host({
      [HARNESS_METHODS.fsWriteBegin]: () => ({ writeId: 'w1' }),
      [HARNESS_METHODS.fsWriteChunk]: () => {
        throw new Error('"😀" (U+1F600) at line 1, column 6 cannot be written in Shift_JIS; nothing was saved')
      },
      [HARNESS_METHODS.fsWriteAbort]: () => ({})
    })
    await expect(writeDocumentWith(request, 'w', 'a.txt', () => ['abcde😀'], format, undefined, { pieceChars: 5 })).rejects.toThrow('cannot be written in Shift_JIS')
    expect(calls.map((call) => call.method)).toEqual([HARNESS_METHODS.fsWriteBegin, HARNESS_METHODS.fsWriteChunk, HARNESS_METHODS.fsWriteAbort])
  })

  test('an older daemon gets the whole text in one write, but only as plain UTF-8', async () => {
    const { request, calls } = host({ [HARNESS_METHODS.fsWrite]: () => ({ mtimeMs: 4 }) })
    const utf8 = { encoding: 'utf8', bom: false } as const
    expect((await writeDocumentWith(request, 'w', 'a.txt', () => ['abc', 'def'], utf8, 2, { pieceChars: 2 })).mtimeMs).toBe(4)
    expect(calls.at(-1)).toEqual({ method: HARNESS_METHODS.fsWrite, params: { workspaceId: 'w', path: 'a.txt', content: 'abcdef', expectedMtimeMs: 2 } })
    await expect(writeDocumentWith(request, 'w', 'a.txt', () => ['abc'], format, 2)).rejects.toThrow(HOST_TOO_OLD)
    await expect(writeDocumentWith(request, 'w', 'a.txt', () => ['abc'], { encoding: 'utf8', bom: true }, 2)).rejects.toThrow(HOST_TOO_OLD)
    expect(calls.filter((call) => call.method === HARNESS_METHODS.fsWrite).length).toBe(1)
  })
})
