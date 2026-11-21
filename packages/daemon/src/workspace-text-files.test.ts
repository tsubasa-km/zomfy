import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readdir, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { TEXT_ENCODINGS, type TextEncoding } from '@zomfy/protocol'
import { completeLength, decodeBytes, detectBufferEncoding, encodeText, UnrepresentableTextError } from './text-encodings.ts'
import { readWorkspaceFile } from './workspace-files.ts'
import {
  abortTextWrite,
  beginTextWrite,
  commitTextWrite,
  pendingTextWrites,
  readTextChunk,
  writeTextChunk
} from './workspace-text-files.ts'
import { fileLineIndex, findInFile, MAX_LINE_CHARS, readFileLines } from './workspace-file-lines.ts'

const JAPANESE = '吾輩は猫である。名前はまだ無い。\r\nどこで生れたかとんと見当がつかぬ。\nカタカナ ｶﾀｶﾅ ABC 123 ①㈱髙\n'
const SAMPLES: Record<TextEncoding, string> = {
  utf8: `${JAPANESE}emoji 😀 and é\n`,
  utf16le: `${JAPANESE}emoji 😀 and é\n`,
  utf16be: `${JAPANESE}emoji 😀 and é\n`,
  shiftjis: JAPANESE,
  eucjp: '吾輩は猫である。名前はまだ無い。\r\nどこで生れたかとんと見当がつかぬ。\nカタカナ ABC 123\n',
  windows1252: 'Crème brûlée – “quoted” €5\n',
  gb18030: '你好，世界。𠀀 emoji 😀\n',
  big5: '繁體中文測試。\n',
  euckr: '안녕하세요 세계\n'
}
const CODEC: Record<TextEncoding, string> = {
  utf8: 'utf8',
  utf16le: 'utf16le',
  utf16be: 'utf16be',
  shiftjis: 'cp932',
  eucjp: 'eucjp',
  windows1252: 'windows1252',
  gb18030: 'gb18030',
  big5: 'big5',
  euckr: 'euckr'
}
const BOM: Partial<Record<TextEncoding, number[]>> = { utf8: [0xef, 0xbb, 0xbf], utf16le: [0xff, 0xfe], utf16be: [0xfe, 0xff] }

const DETECTED: TextEncoding[] = ["utf8", "shiftjis", "eucjp"]
let root = ""
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'zomfy-text-files-')))
}, 30_000)
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
}, 30_000)

async function put(name: string, bytes: Buffer | string): Promise<string> {
  await writeFile(join(root, name), bytes)
  return name
}

async function readWhole(path: string, options: { encoding?: TextEncoding; maxBytes?: number } = {}) {
  let offset = 0
  let content = ''
  let pieces = 0
  let first: Awaited<ReturnType<typeof readTextChunk>> | null = null
  for (;;) {
    const chunk = await readTextChunk(root, { path, offset, encoding: options.encoding ?? first?.encoding, maxBytes: options.maxBytes })
    first ??= chunk
    content += chunk.content
    pieces++
    if (chunk.nextOffset >= chunk.size) return { content, pieces, first, malformed: chunk.malformed }
    expect(chunk.nextOffset).toBeGreaterThan(offset)
    offset = chunk.nextOffset
  }
}

async function save(path: string, text: string, encoding: TextEncoding, bom: boolean, pieceChars: number, expectedMtimeMs?: number) {
  const { writeId } = await beginTextWrite(root, { path, encoding, bom, expectedMtimeMs })
  for (let at = 0; at < text.length; at += pieceChars) await writeTextChunk(writeId, text.slice(at, at + pieceChars))
  return commitTextWrite(writeId)
}

describe('encoding detection', () => {
  test('a byte order mark decides, and is reported', async () => {
    for (const encoding of ['utf8', 'utf16le', 'utf16be'] as const) {
      const bytes = Buffer.concat([Buffer.from(BOM[encoding]!), iconv.encode(SAMPLES[encoding], CODEC[encoding])])
      expect(await detectBufferEncoding(bytes)).toEqual({ binary: false, encoding, bom: true, malformed: false })
    }
  })

  test('UTF-8, Shift_JIS and EUC-JP without a mark are told apart', async () => {
    expect((await detectBufferEncoding(Buffer.from(SAMPLES.utf8))).encoding).toBe('utf8')
    expect((await detectBufferEncoding(Buffer.from('plain ascii\n'))).encoding).toBe('utf8')
    expect(await detectBufferEncoding(iconv.encode(SAMPLES.shiftjis, 'cp932'))).toEqual({ binary: false, encoding: 'shiftjis', bom: false, malformed: false })
    expect(await detectBufferEncoding(iconv.encode(SAMPLES.eucjp, 'eucjp'))).toEqual({ binary: false, encoding: 'eucjp', bom: false, malformed: false })
  })

  test('half-width katakana alone stays Shift_JIS; kana-rich text valid both ways is EUC-JP', async () => {
    expect((await detectBufferEncoding(iconv.encode('ｶﾌﾞｼｷｶﾞｲｼｬ ﾃｽﾄ\nｱｲｳｴ\n', 'cp932'))).encoding).toBe('shiftjis')
    expect((await detectBufferEncoding(iconv.encode('これはてすとです\n', 'eucjp'))).encoding).toBe('eucjp')
  })

  test('legacy text after megabytes of ASCII is still found', async () => {
    const bytes = Buffer.concat([Buffer.alloc(3 * 1024 * 1024, 0x61), iconv.encode('\n日本語のコメント\n', 'cp932')])
    expect((await detectBufferEncoding(bytes)).encoding).toBe('shiftjis')
  })

  test('UTF-16 without a mark, binary, and bytes that fit nothing', async () => {
    expect((await detectBufferEncoding(iconv.encode('hello wide world\r\n', 'utf16le'))).encoding).toBe('utf16le')
    expect((await detectBufferEncoding(iconv.encode('hello wide world\r\n', 'utf16be'))).encoding).toBe('utf16be')
    expect((await detectBufferEncoding(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13, 1, 2, 3]))).binary).toBe(true)
    const broken = Buffer.concat([Buffer.from('日本語のテキスト'), Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from('つづき')])
    expect(await detectBufferEncoding(broken)).toEqual({ binary: false, encoding: 'utf8', bom: false, malformed: true })
  })
})

describe('reading in pieces', () => {
  test('every encoding reads back whole, however small the pieces', async () => {
    for (const encoding of TEXT_ENCODINGS) {
      const text = SAMPLES[encoding].repeat(8)
      const path = await put(`pieces-${encoding}.txt`, iconv.encode(text, CODEC[encoding]))
      for (const maxBytes of [16, 61, 4096]) {
        const read = await readWhole(path, { encoding, maxBytes })
        expect(read.content).toBe(text)
        expect(read.malformed).toBe(false)
        if (maxBytes === 16) expect(read.pieces).toBeGreaterThan(5)
      }
    }
  })

  test('a piece never ends inside a character', async () => {
    for (const encoding of TEXT_ENCODINGS) {
      const bytes = iconv.encode(SAMPLES[encoding], CODEC[encoding])
      for (let cut = 1; cut < bytes.length; cut++) {
        const whole = completeLength(bytes.subarray(0, cut), encoding)
        expect(decodeBytes(bytes.subarray(0, whole), encoding) + decodeBytes(bytes.subarray(whole), encoding)).toBe(SAMPLES[encoding])
      }
    }
  })

  test('the first piece names what was detected and leaves the mark out of the text', async () => {
    const path = await put('bom.txt', Buffer.concat([Buffer.from(BOM.utf16le!), iconv.encode(SAMPLES.utf16le, 'utf16le')]))
    const read = await readWhole(path, { maxBytes: 32 })
    expect(read.first).toMatchObject({ encoding: 'utf16le', bom: true, binary: false })
    expect(read.content).toBe(SAMPLES.utf16le)
    const sjis = await put('sjis.txt', iconv.encode(SAMPLES.shiftjis, 'cp932'))
    expect((await readWhole(sjis)).first).toMatchObject({ encoding: 'shiftjis', bom: false })
    expect((await readWhole(sjis)).content).toBe(SAMPLES.shiftjis)
  })

  test('reopening in another encoding decodes the same bytes differently and flags what does not fit', async () => {
    const path = await put('reopen.txt', iconv.encode(SAMPLES.shiftjis, 'cp932'))
    const wrong = await readWhole(path, { encoding: 'utf8' })
    expect(wrong.content).not.toBe(SAMPLES.shiftjis)
    expect(wrong.malformed).toBe(true)
    expect((await readWhole(path, { encoding: 'shiftjis' })).content).toBe(SAMPLES.shiftjis)
  })

  test('a binary file has no text', async () => {
    const path = await put('image.bin', Buffer.from([1, 2, 0, 0, 4]))
    expect(await readTextChunk(root, { path, offset: 0 })).toMatchObject({ binary: true, content: '', nextOffset: 5 })
  })

  test('the old whole-file read cuts on a character', async () => {
    const path = await put('old-limit.txt', Buffer.from('a' + 'あ'.repeat(400_000)))
    const file = await readWorkspaceFile(root, path)
    expect(file.truncated).toBe(true)
    expect(file.content.endsWith('�')).toBe(false)
    expect(file.content).toBe('a' + 'あ'.repeat(file.content.length - 1))
  })
})

describe('saving in pieces', () => {
  test('every encoding round-trips, with and without its mark', async () => {
    for (const encoding of TEXT_ENCODINGS) {
      for (const bom of BOM[encoding] ? [false, true] : [false]) {
        const text = SAMPLES[encoding].repeat(20)
        const path = `save-${encoding}-${bom}.txt`
        const saved = await save(path, text, encoding, bom, 7)
        const bytes = await readFile(join(root, path))
        const mark = bom ? Buffer.from(BOM[encoding]!) : Buffer.alloc(0)
        expect(bytes.equals(Buffer.concat([mark, iconv.encode(text, CODEC[encoding])]))).toBe(true)
        expect(saved.size).toBe(bytes.length)
        const read = await readWhole(path, { maxBytes: 64, encoding: bom || DETECTED.includes(encoding) ? undefined : encoding })
        expect(read.first).toMatchObject({ encoding, bom })
        expect(read.content).toBe(text)
      }
    }
    expect(pendingTextWrites()).toBe(0)
  })

  test('a file saved unchanged keeps its bytes', async () => {
    const original = Buffer.concat([Buffer.from(BOM.utf8!), Buffer.from(SAMPLES.utf8)])
    const path = await put('unchanged.txt', original)
    const read = await readWhole(path)
    await save(path, read.content, read.first!.encoding, read.first!.bom, 5)
    expect((await readFile(join(root, path))).equals(original)).toBe(true)
  })

  test('a surrogate pair split between two pieces is written as one character', async () => {
    const text = 'a😀b'
    const { writeId } = await beginTextWrite(root, { path: 'pair.txt', encoding: 'utf8', bom: false, content: text.slice(0, 2) })
    await writeTextChunk(writeId, text.slice(2))
    await commitTextWrite(writeId)
    expect(await readFile(join(root, 'pair.txt'), 'utf8')).toBe(text)
  })

  test('text the encoding cannot represent is refused, named, and nothing is written', async () => {
    const path = await put('refuse.txt', iconv.encode('元の内容\n', 'cp932'))
    const before = await readFile(join(root, path))
    const { writeId } = await beginTextWrite(root, { path, encoding: 'shiftjis', bom: false })
    await writeTextChunk(writeId, '一行目\n二行')
    await expect(writeTextChunk(writeId, '目 😀\n')).rejects.toThrow('"😀" (U+1F600) at line 2, column 5 cannot be written in Shift_JIS')
    await expect(commitTextWrite(writeId)).rejects.toThrow('no longer open')
    expect((await readFile(join(root, path))).equals(before)).toBe(true)
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    // The yen sign has no Shift_JIS byte of its own (0x5C reads back as a backslash), and a lone surrogate no UTF-8.
    expect(() => encodeText('¥100', 'shiftjis')).toThrow(UnrepresentableTextError)
    expect(() => encodeText('〜', 'shiftjis')).toThrow(UnrepresentableTextError)
    expect(() => encodeText('a\uD83Db', 'utf8')).toThrow(UnrepresentableTextError)
    await expect(beginTextWrite(root, { path, encoding: 'eucjp', bom: false, content: 'ok 😀', commit: true })).rejects.toThrow('cannot be written in EUC-JP')
    expect(pendingTextWrites()).toBe(0)
  })

  test('one call saves a small file; an abort leaves the file and no temp file', async () => {
    const path = await put('small.txt', 'old')
    const { saved } = await beginTextWrite(root, { path, encoding: 'utf16le', bom: true, content: 'new', commit: true })
    expect(saved?.size).toBe(8)
    const { writeId } = await beginTextWrite(root, { path, encoding: 'utf8', bom: false, content: 'half' })
    expect((await readdir(root)).some((name) => name.startsWith('small.txt.zomfy-'))).toBe(true)
    await abortTextWrite(writeId)
    expect((await readdir(root)).some((name) => name.startsWith('small.txt.zomfy-'))).toBe(false)
    expect((await readWhole(path)).content).toBe('new')
    await expect(writeTextChunk(writeId, 'more')).rejects.toThrow('no longer open')
  })

  test('the save is refused when the file changed, at the start or while pieces came in', async () => {
    const path = await put('guard.txt', 'one')
    const opened = (await stat(join(root, path))).mtimeMs
    const later = new Date(opened + 5000)
    await utimes(join(root, path), later, later)
    await expect(beginTextWrite(root, { path, encoding: 'utf8', bom: false, expectedMtimeMs: opened })).rejects.toThrow('changed on disk')
    const current = (await stat(join(root, path))).mtimeMs
    const { writeId } = await beginTextWrite(root, { path, encoding: 'utf8', bom: false, expectedMtimeMs: current, content: 'two' })
    const again = new Date(current + 5000)
    await utimes(join(root, path), again, again)
    await expect(commitTextWrite(writeId)).rejects.toThrow('changed on disk')
    expect(await readFile(join(root, path), 'utf8')).toBe('one')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    const saved = await save(path, 'three', 'utf8', false, 2, (await stat(join(root, path))).mtimeMs)
    expect(saved.mtimeMs).toBe((await stat(join(root, path))).mtimeMs)
    expect(await readFile(join(root, path), 'utf8')).toBe('three')
  })

  test.skipIf(process.platform === 'win32')('the mode bits survive', async () => {
    const path = await put('run.sh', '#!/bin/sh\n')
    await chmod(join(root, path), 0o755)
    await save(path, '#!/bin/sh\necho hi\n', 'utf8', false, 4)
    expect((await stat(join(root, path))).mode & 0o777).toBe(0o755)
  })
})

describe('lines of a large file', () => {
  const lineOf = (n: number): string => `line ${n} 日本語 ${'x'.repeat(n % 97)}`

  async function indexed(path: string, encoding?: TextEncoding) {
    for (;;) {
      const index = await fileLineIndex(root, { path, encoding })
      if (index.complete) return index
    }
  }

  test('the index counts lines and any range reads back, in every unit width', async () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => lineOf(i + 1))
    for (const encoding of ['utf8', 'shiftjis', 'utf16le', 'utf16be'] as const) {
      const eol = encoding === 'shiftjis' ? '\r\n' : '\n'
      const mark = encoding === 'utf16le' ? Buffer.from(BOM.utf16le!) : Buffer.alloc(0)
      const path = await put(`lines-${encoding}.log`, Buffer.concat([mark, iconv.encode(lines.join(eol) + eol, CODEC[encoding])]))
      const index = await indexed(path)
      expect(index).toMatchObject({ encoding, lineCount: 20_001, complete: true, bom: mark.length > 0 })
      for (const [startLine, count] of [[1, 3], [777, 50], [9_999, 400], [19_990, 50]] as const) {
        const read = await readFileLines(root, { workspaceId: '', path, encoding, mtimeMs: index.mtimeMs, startLine, count })
        const expected = [...lines, ''].slice(startLine - 1, startLine - 1 + count)
        expect(read.lines.map((l) => l.text)).toEqual(expected)
        expect(read.lines.some((l) => l.clipped)).toBe(false)
      }
    }
  })

  test('a file without a final line feed, and an empty one', async () => {
    const path = await put('no-eol.txt', 'a\nb\nc')
    const index = await indexed(path)
    expect(index.lineCount).toBe(3)
    const read = await readFileLines(root, { workspaceId: '', path, encoding: 'utf8', mtimeMs: index.mtimeMs, startLine: 2, count: 10 })
    expect(read.lines).toEqual([{ text: 'b' }, { text: 'c' }])
    const empty = await indexed(await put('empty.txt', ''))
    expect(empty).toMatchObject({ lineCount: 1, complete: true })
  })

  test('very long lines are clipped, and the lines after them are still found', async () => {
    const long = 'あ'.repeat(300_000)
    const path = await put('long.txt', `first\n${long}\nafter one\n${'b'.repeat(MAX_LINE_CHARS)}\n${long}${long}\nlast`)
    const index = await indexed(path)
    expect(index.lineCount).toBe(6)
    const read = await readFileLines(root, { workspaceId: '', path, encoding: 'utf8', mtimeMs: index.mtimeMs, startLine: 1, count: 10 })
    expect(read.lines.map((l) => [l.text.length, l.clipped ?? false])).toEqual([
      [5, false],
      [MAX_LINE_CHARS, true],
      [9, false],
      [MAX_LINE_CHARS, false],
      [MAX_LINE_CHARS, true],
      [4, false]
    ])
    expect(read.lines[1]!.text).toBe('あ'.repeat(MAX_LINE_CHARS))
    const tail = await readFileLines(root, { workspaceId: '', path, encoding: 'utf8', mtimeMs: index.mtimeMs, startLine: 6, count: 1 })
    expect(tail.lines).toEqual([{ text: 'last' }])
  })

  test('find reports line, column and length, continues where it stopped, and honours its options', async () => {
    const lines = Array.from({ length: 60_000 }, (_, i) => (i % 1000 === 499 ? `ERROR 失敗 code=${i} Error` : lineOf(i + 1)))
    for (const encoding of ['utf8', 'shiftjis', 'utf16le'] as const) {
      const path = await put(`find-${encoding}.log`, iconv.encode(lines.join('\r\n'), CODEC[encoding]))
      const index = await indexed(path, encoding)
      const all = async (extra: object) => {
        const found = []
        let calls = 0
        for (let fromLine: number | null = 1; fromLine !== null; calls++) {
          const result = await findInFile(root, { workspaceId: '', path, encoding, mtimeMs: index.mtimeMs, query: '', fromLine, maxMatches: 25, ...extra })
          found.push(...result.matches)
          fromLine = result.nextLine
        }
        return { found, calls }
      }
      const plain = await all({ query: '失敗 code' })
      expect(plain.found.length).toBe(60)
      expect(plain.calls).toBeGreaterThan(2)
      expect(plain.found[0]).toEqual({ line: 500, column: 7, length: 7 })
      expect(plain.found[59]!.line).toBe(59_500)
      expect((await all({ query: 'error' })).found.length).toBe(120)
      expect((await all({ query: 'error', caseSensitive: true })).found.length).toBe(0)
      expect((await all({ query: 'Error', caseSensitive: true })).found[0]).toEqual({ line: 500, column: lines[499]!.length - 4, length: 5 })
      expect((await all({ query: '^ERROR .*=(\\d+)500\\b', regex: true })).found.map((m) => m.line)).toEqual([])
      expect((await all({ query: 'code=\\d*499 Error$', regex: true })).found.length).toBe(60)
      expect((await all({ query: 'line 60', wholeWord: true })).found.map((m) => m.line)).toEqual([60])
      const from = await findInFile(root, { workspaceId: '', path, encoding, mtimeMs: index.mtimeMs, query: 'ERROR', caseSensitive: true, fromLine: 501, maxMatches: 1 })
      expect(from.matches).toEqual([{ line: 1500, column: 1, length: 5 }])
    }
    await expect(findInFile(root, { workspaceId: '', path: 'find-utf8.log', encoding: 'utf8', mtimeMs: (await indexed('find-utf8.log')).mtimeMs, query: '(', regex: true, fromLine: 1 })).rejects.toThrow('Invalid search pattern')
  })

  test('a reader of an older version is told, and a new index is built for the new one', async () => {
    const path = await put('grows.log', 'a\nb\n')
    const first = await indexed(path)
    await put('grows.log', 'a\nb\nc\nd\n')
    const later = new Date(first.mtimeMs + 5000)
    await utimes(join(root, path), later, later)
    const second = await indexed(path)
    expect(second.lineCount).toBe(5)
    await expect(readFileLines(root, { workspaceId: '', path, encoding: 'utf8', mtimeMs: first.mtimeMs, startLine: 1, count: 1 })).rejects.toThrow('changed on disk')
  })
})
