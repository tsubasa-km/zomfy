import { open, stat, type FileHandle } from 'node:fs/promises'
import type {
  FileFindMatch,
  FileFindParams,
  FileFindResult,
  FileLine,
  FileLineIndex,
  FileLines,
  FileLinesParams,
  TextEncoding
} from '@acp-harness/protocol'
import { bomLength, completeLength, decodeBytes, unitSize } from './text-encodings.ts'
import { resolveInside } from './workspace-files.ts'
import { describeTextFile } from './workspace-text-files.ts'

// Lines of a file too large to load: an index of where lines start, built in one pass and kept per
// version of the file, then range reads and a find that go straight to the lines asked for.
//
// The index is sparse. It records a line's start only when that start is at least CHECKPOINT_BYTES
// past the last one recorded, so a multi-GB file costs a few hundred KB, and any line is found by
// scanning less than CHECKPOINT_BYTES forward from a recorded one. The line after a very long line
// is always recorded, so a long line is never scanned to get past it.

const CHECKPOINT_BYTES = 64 * 1024
const INDEX_BLOCK_BYTES = 4 * 1024 * 1024
/** A line is returned, and searched, up to this many characters. */
export const MAX_LINE_CHARS = 10_000
/** Enough bytes for MAX_LINE_CHARS in any encoding here (4 bytes a character at most). */
const MAX_LINE_BYTES = MAX_LINE_CHARS * 4
const MAX_LINES_PER_READ = 2000
const FIND_BLOCK_BYTES = 1024 * 1024
const FIND_BUDGET_MS = 150
const KEPT_INDEXES = 8

interface LineIndex {
  absolute: string
  size: number
  mtimeMs: number
  encoding: TextEncoding
  bom: boolean
  binary: boolean
  malformed: boolean
  unit: 1 | 2
  bigEndian: boolean
  /** Recorded line starts: `lines[i]` (1-based line number) begins at byte `offsets[i]`. */
  lines: number[]
  offsets: number[]
  lineCount: number
  indexedBytes: number
  complete: boolean
  failure: Error | null
  usedAt: number
}

const indexes = new Map<string, LineIndex>()

function sameVersion(index: LineIndex, mtimeMs: number): boolean {
  return Math.abs(index.mtimeMs - mtimeMs) <= 1
}

/** Offset of the first line feed in `view` (which starts on a code unit), or -1. */
function lineFeedIn(view: Buffer, unit: 1 | 2, bigEndian: boolean, from = 0): number {
  if (unit === 1) return view.indexOf(0x0a, from)
  for (let at = view.indexOf(0x0a, from); at !== -1; at = view.indexOf(0x0a, at + 1)) {
    if (bigEndian ? at % 2 === 1 && view[at - 1] === 0 : at % 2 === 0 && view[at + 1] === 0) return bigEndian ? at - 1 : at
  }
  return -1
}

function lastLineFeedIn(view: Buffer, unit: 1 | 2, bigEndian: boolean): number {
  if (unit === 1) return view.lastIndexOf(0x0a)
  for (let at = view.lastIndexOf(0x0a); at !== -1; at = at === 0 ? -1 : view.lastIndexOf(0x0a, at - 1)) {
    if (bigEndian ? at % 2 === 1 && view[at - 1] === 0 : at % 2 === 0 && view[at + 1] === 0) return bigEndian ? at - 1 : at
  }
  return -1
}

async function build(index: LineIndex): Promise<void> {
  const handle = await open(index.absolute, 'r')
  try {
    const block = Buffer.allocUnsafe(INDEX_BLOCK_BYTES)
    let lastRecorded = index.offsets[0]!
    let offset = 0
    while (offset < index.size) {
      const { bytesRead } = await handle.read(block, 0, Math.min(INDEX_BLOCK_BYTES, index.size - offset), offset)
      if (bytesRead === 0) break
      // A UTF-16 line feed is two bytes; one cut by the block's end is read again with the next block.
      const usable = index.unit === 2 && offset + bytesRead < index.size ? bytesRead - (bytesRead % 2) : bytesRead
      const view = block.subarray(0, usable)
      for (let at = lineFeedIn(view, index.unit, index.bigEndian); at !== -1; at = lineFeedIn(view, index.unit, index.bigEndian, at + index.unit)) {
        index.lineCount++
        const start = offset + at + index.unit
        if (start - lastRecorded >= CHECKPOINT_BYTES) {
          index.lines.push(index.lineCount)
          index.offsets.push(start)
          lastRecorded = start
        }
      }
      offset += usable || bytesRead
      index.indexedBytes = offset
      // Lets requests waiting on the socket run between blocks.
      await new Promise((resolve) => setImmediate(resolve))
    }
    index.indexedBytes = index.size
    index.complete = true
  } finally {
    await handle.close()
  }
}

async function indexFor(absolute: string, path: string, encoding: TextEncoding | undefined, mtimeMs?: number): Promise<LineIndex> {
  const kept = indexes.get(absolute)
  // A reader names the version it indexed; it keeps that index even when the file has moved on.
  if (kept && mtimeMs !== undefined && sameVersion(kept, mtimeMs) && !kept.failure && (!encoding || encoding === kept.encoding)) {
    kept.usedAt = Date.now()
    return kept
  }
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error(`${path} is not a file`)
  if (mtimeMs !== undefined && Math.abs(info.mtimeMs - mtimeMs) > 1) {
    throw new Error(`${path} changed on disk since it was opened; reload it`)
  }
  if (kept && sameVersion(kept, info.mtimeMs) && kept.size === info.size && !kept.failure && (!encoding || encoding === kept.encoding)) {
    kept.usedAt = Date.now()
    return kept
  }
  const handle = await open(absolute, 'r')
  let file: Awaited<ReturnType<typeof describeTextFile>>
  let start = 0
  try {
    file = await describeTextFile(handle, info.size, encoding)
    if (file.bom) {
      const head = Buffer.alloc(4)
      const { bytesRead } = await handle.read(head, 0, 4, 0)
      start = bomLength(head.subarray(0, bytesRead), file.encoding)
    }
  } finally {
    await handle.close()
  }
  const index: LineIndex = {
    absolute,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ...file,
    unit: unitSize(file.encoding),
    bigEndian: file.encoding === 'utf16be',
    lines: [1],
    offsets: [start],
    lineCount: 1,
    indexedBytes: 0,
    complete: file.binary,
    failure: null,
    usedAt: Date.now()
  }
  indexes.set(absolute, index)
  if (indexes.size > KEPT_INDEXES) {
    const oldest = [...indexes.values()].sort((a, b) => a.usedAt - b.usedAt)[0]!
    indexes.delete(oldest.absolute)
  }
  if (!index.complete) {
    void build(index).catch((error: unknown) => {
      index.failure = error instanceof Error ? error : new Error(String(error))
    })
  }
  return index
}

/** Waits for the index to reach `line` (or its end), for at most `ms`. */
async function awaitIndexed(index: LineIndex, line: number, ms: number): Promise<void> {
  const until = Date.now() + ms
  while (!index.complete && index.lineCount <= line && Date.now() < until) {
    if (index.failure) throw index.failure
    await Bun.sleep(10)
  }
  if (index.failure) throw index.failure
}

export async function fileLineIndex(root: string, params: { path: string; encoding?: TextEncoding }): Promise<FileLineIndex> {
  const absolute = await resolveInside(root, params.path)
  const index = await indexFor(absolute, params.path, params.encoding)
  // A small file is done within this call.
  await awaitIndexed(index, Number.POSITIVE_INFINITY, 100)
  return {
    lineCount: index.lineCount,
    indexedBytes: index.indexedBytes,
    complete: index.complete,
    size: index.size,
    mtimeMs: index.mtimeMs,
    encoding: index.encoding,
    bom: index.bom,
    binary: index.binary,
    malformed: index.malformed
  }
}

/** Reads through a window of the file, so a run of lines costs a few reads instead of one each. */
class FileWindow {
  private at = 0
  private bytes: Buffer = Buffer.alloc(0)
  constructor(
    private readonly handle: FileHandle,
    readonly size: number,
    private readonly blockBytes: number
  ) {}

  /** The bytes from `from` on: at least `min` of them unless the file ends first. */
  async from(from: number, min: number): Promise<Buffer> {
    const wanted = Math.min(min, this.size - from)
    if (from >= this.at && this.at + this.bytes.length - from >= wanted && wanted > 0) return this.bytes.subarray(from - this.at)
    const length = Math.max(0, Math.min(Math.max(this.blockBytes, min), this.size - from))
    const buffer = Buffer.allocUnsafe(length)
    let filled = 0
    while (filled < length) {
      const { bytesRead } = await this.handle.read(buffer, filled, length - filled, from + filled)
      if (bytesRead === 0) break
      filled += bytesRead
    }
    this.at = from
    this.bytes = buffer.subarray(0, filled)
    return this.bytes
  }
}

/** Offset of the first line feed at or after `from` and before `limit`, or -1. */
async function findLineFeed(window: FileWindow, index: LineIndex, from: number, limit: number): Promise<number> {
  let at = from
  while (at < limit) {
    const view = await window.from(at, index.unit)
    if (view.length < index.unit) return -1
    let end = Math.min(view.length, limit - at)
    if (index.unit === 2 && at + end < window.size) end -= end % 2
    if (end <= 0) return -1
    const hit = lineFeedIn(view.subarray(0, end), index.unit, index.bigEndian)
    if (hit !== -1) return at + hit
    at += end
  }
  return -1
}

/** The recorded line start at or before `line`. */
function recordedBefore(index: LineIndex, line: number): number {
  let low = 0
  let high = index.lines.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (index.lines[mid]! <= line) low = mid
    else high = mid - 1
  }
  return low
}

/** Byte offset where 1-based `line` starts. */
async function lineStart(window: FileWindow, index: LineIndex, line: number): Promise<number> {
  const at = recordedBefore(index, line)
  let offset = index.offsets[at]!
  for (let n = index.lines[at]!; n < line; n++) {
    const feed = await findLineFeed(window, index, offset, index.size)
    if (feed === -1) throw new Error(`Line ${line} is past the end of the file`)
    offset = feed + index.unit
  }
  return offset
}

/** Where the line after `line` starts, given that `line` has no line feed in its first `scanned` bytes. */
async function startAfterLongLine(window: FileWindow, index: LineIndex, line: number, start: number, scanned: number): Promise<number | null> {
  const next = recordedBefore(index, line + 1)
  if (index.lines[next] === line + 1) return index.offsets[next]!
  // Not recorded, so it starts within CHECKPOINT_BYTES of a recorded line: a short scan. During the
  // build the index may simply not be there yet.
  const feed = await findLineFeed(window, index, start + scanned, Math.min(index.size, start + scanned + CHECKPOINT_BYTES))
  return feed === -1 ? null : feed + index.unit
}

function lineText(bytes: Buffer, encoding: TextEncoding, clippedBytes: boolean): FileLine {
  let text = decodeBytes(clippedBytes ? bytes.subarray(0, completeLength(bytes, encoding)) : bytes, encoding)
  if (text.endsWith('\r')) text = text.slice(0, -1)
  if (text.length > MAX_LINE_CHARS) return { text: text.slice(0, MAX_LINE_CHARS), clipped: true }
  return clippedBytes ? { text, clipped: true } : { text }
}

async function openIndexed(root: string, params: { path: string; encoding: TextEncoding; mtimeMs: number }): Promise<{ index: LineIndex; handle: FileHandle }> {
  const absolute = await resolveInside(root, params.path)
  const index = await indexFor(absolute, params.path, params.encoding, params.mtimeMs)
  return { index, handle: await open(absolute, 'r') }
}

export async function readFileLines(root: string, params: FileLinesParams): Promise<FileLines> {
  const { index, handle } = await openIndexed(root, params)
  try {
    const first = Math.max(1, Math.floor(params.startLine))
    const wanted = Math.min(MAX_LINES_PER_READ, Math.max(0, Math.floor(params.count)))
    await awaitIndexed(index, first + wanted, 2000)
    const lines: FileLine[] = []
    const result = (): FileLines => ({ startLine: first, lines, lineCount: index.lineCount, complete: index.complete })
    if (first > index.lineCount || index.binary) return result()
    const window = new FileWindow(handle, index.size, 256 * 1024)
    let offset = await lineStart(window, index, first)
    for (let line = first; line < first + wanted && line <= index.lineCount; line++) {
      const limit = Math.min(index.size, offset + MAX_LINE_BYTES + index.unit)
      const feed = await findLineFeed(window, index, offset, limit)
      const end = feed === -1 ? limit : feed
      const clipped = feed === -1 && limit < index.size
      const bytes = (await window.from(offset, end - offset)).subarray(0, end - offset)
      lines.push(lineText(Buffer.from(bytes), index.encoding, clipped))
      if (feed !== -1) offset = feed + index.unit
      else if (!clipped) break
      else {
        const next = await startAfterLongLine(window, index, line, offset, end - offset)
        if (next === null) break
        offset = next
      }
    }
    return result()
  } finally {
    await handle.close()
  }
}

function findPattern(params: FileFindParams): { each: RegExp; any: RegExp } {
  let source = params.regex ? params.query : params.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (params.wholeWord) source = `\\b(?:${source})\\b`
  const flags = params.caseSensitive ? '' : 'i'
  try {
    // `any` tells whether a block of lines holds a match at all, so most blocks are never split.
    return { each: new RegExp(source, `g${flags}`), any: new RegExp(source, `m${flags}`) }
  } catch (error) {
    throw new Error(`Invalid search pattern: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function matchesIn(text: string, line: number, pattern: RegExp, into: FileFindMatch[]): void {
  const searched = text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) : text
  pattern.lastIndex = 0
  for (let hit = pattern.exec(searched); hit; hit = pattern.exec(searched)) {
    if (hit[0].length === 0) pattern.lastIndex++
    else into.push({ line, column: hit.index + 1, length: hit[0].length })
  }
}

/**
 * Scans forward from `fromLine` for a short while and says where to continue, so a find over a
 * multi-GB file is many small requests the caller can stop, not one long one.
 */
export async function findInFile(root: string, params: FileFindParams): Promise<FileFindResult> {
  const pattern = findPattern(params)
  const { index, handle } = await openIndexed(root, params)
  try {
    const matches: FileFindMatch[] = []
    const max = Math.max(1, Math.floor(params.maxMatches ?? 1000))
    let line = Math.max(1, Math.floor(params.fromLine))
    await awaitIndexed(index, line, 2000)
    if (!params.query || index.binary) return { matches, nextLine: null, lineCount: index.lineCount }
    // The index has not reached this line yet: nothing found so far, ask again.
    if (line > index.lineCount) return { matches, nextLine: index.complete ? null : line, lineCount: index.lineCount }
    const window = new FileWindow(handle, index.size, FIND_BLOCK_BYTES)
    let offset = await lineStart(window, index, line)
    const started = Date.now()
    while (offset < index.size && matches.length < max && Date.now() - started < FIND_BUDGET_MS) {
      const view = await window.from(offset, FIND_BLOCK_BYTES)
      const atEnd = offset + view.length >= index.size
      const lastFeed = lastLineFeedIn(index.unit === 2 ? view.subarray(0, view.length - (view.length % 2)) : view, index.unit, index.bigEndian)
      if (lastFeed === -1 && !atEnd) {
        // One line longer than the block: its beginning is all that is shown, so all that is searched.
        const head = view.subarray(0, MAX_LINE_BYTES)
        matchesIn(decodeBytes(head.subarray(0, completeLength(head, index.encoding)), index.encoding), line, pattern.each, matches)
        const next = await startAfterLongLine(window, index, line, offset, view.length)
        if (next === null) return { matches, nextLine: null, lineCount: index.lineCount }
        offset = next
        line++
        continue
      }
      // Whole lines only; the file's last line has no line feed after it.
      const end = lastFeed === -1 ? view.length : atEnd ? view.length : lastFeed + index.unit
      const text = decodeBytes(Buffer.from(view.subarray(0, end)), index.encoding)
      const lines = text.split('\n')
      // After a final line feed comes one more (empty) line only at the very end of the file.
      const count = text.endsWith('\n') && !(atEnd && end === view.length) ? lines.length - 1 : lines.length
      if (pattern.any.test(text)) {
        for (let i = 0; i < count; i++) {
          const one = lines[i]!
          matchesIn(one.endsWith('\r') ? one.slice(0, -1) : one, line + i, pattern.each, matches)
          if (matches.length >= max && i + 1 < count) return { matches, nextLine: line + i + 1, lineCount: index.lineCount }
        }
      }
      line += count
      offset += end
    }
    return { matches, nextLine: offset < index.size ? line : null, lineCount: index.lineCount }
  } finally {
    await handle.close()
  }
}
