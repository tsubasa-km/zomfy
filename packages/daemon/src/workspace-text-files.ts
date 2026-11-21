import { chmod, open, rm, stat, type FileHandle } from 'node:fs/promises'
import type { SavedFile, TextChunk, TextEncoding } from '@zomfy/protocol'
import { replaceFile } from './replace-file.ts'
import {
  bomBytes,
  bomLength,
  completeLength,
  decodeBytes,
  describeCharacter,
  detectEncoding,
  encodeText,
  encodingLabel,
  hasInvalidBytes,
  isTextEncoding,
  UnrepresentableTextError
} from './text-encodings.ts'
import { resolveInside } from './workspace-files.ts'

// A text file of any size and encoding, moved in pieces: read as decoded chunks that end on a
// character, and saved as chunks encoded into a temp file that replaces the file only on commit.
// Pieces keep each message on the shared socket small, so terminals and threads keep flowing.

/** Bytes of the file per piece unless the caller asks otherwise. */
export const TEXT_CHUNK_BYTES = 256 * 1024
const MAX_CHUNK_BYTES = 1024 * 1024
/** A save nobody continued is dropped after this long. */
const WRITE_IDLE_MS = 5 * 60 * 1000

async function readAt(handle: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let filled = 0
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled)
    if (bytesRead === 0) break
    filled += bytesRead
  }
  return buffer.subarray(0, filled)
}

/** What `path` is on disk: detected, or with `encoding` taken as told (only its byte order mark is looked for). */
export async function describeTextFile(
  handle: FileHandle,
  size: number,
  encoding?: TextEncoding
): Promise<{ binary: boolean; encoding: TextEncoding; bom: boolean; malformed: boolean }> {
  if (encoding === undefined) return detectEncoding((offset, length) => readAt(handle, offset, length), size)
  if (!isTextEncoding(encoding)) throw new Error(`Unknown encoding ${String(encoding)}`)
  const head = await readAt(handle, 0, Math.min(size, 4))
  return { binary: false, encoding, bom: bomLength(head, encoding) > 0, malformed: false }
}

export async function readTextChunk(
  root: string,
  params: { path: string; offset: number; encoding?: TextEncoding; maxBytes?: number }
): Promise<TextChunk> {
  const absolute = await resolveInside(root, params.path)
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error(`${params.path} is not a file`)
  const offset = Math.max(0, Math.floor(params.offset))
  const limit = Math.min(MAX_CHUNK_BYTES, Math.max(16, Math.floor(params.maxBytes ?? TEXT_CHUNK_BYTES)))
  const handle = await open(absolute, 'r')
  try {
    const file = await describeTextFile(handle, info.size, params.encoding)
    const base = { size: info.size, mtimeMs: info.mtimeMs, encoding: file.encoding, bom: file.bom, binary: file.binary }
    if (file.binary || offset >= info.size) return { ...base, content: '', nextOffset: info.size, malformed: file.malformed }
    const bytes = await readAt(handle, offset, Math.min(limit, info.size - offset))
    const atEnd = offset + bytes.length >= info.size
    // What the file's end cuts short is all there is; mid-file the cut character waits for the next piece.
    const whole = atEnd ? bytes.length : completeLength(bytes, file.encoding) || bytes.length
    const text = bytes.subarray(offset === 0 ? bomLength(bytes, file.encoding) : 0, whole)
    const content = decodeBytes(text, file.encoding)
    return {
      ...base,
      content,
      nextOffset: offset + whole,
      malformed: file.malformed || hasInvalidBytes(text, content, file.encoding)
    }
  } finally {
    await handle.close()
  }
}

interface PendingWrite {
  id: string
  path: string
  absolute: string
  temp: string
  handle: FileHandle
  encoding: TextEncoding
  expectedMtimeMs: number | undefined
  /** A high surrogate that ended a piece, waiting for its other half. */
  carry: string
  /** 1-based position of the next character, for naming the one that cannot be written. */
  line: number
  column: number
  bytes: number
  /** Calls run one after another, whatever order their requests were sent in. */
  tail: Promise<unknown>
  timer: ReturnType<typeof setTimeout> | undefined
}

const writes = new Map<string, PendingWrite>()

function guardMtime(path: string, current: { mtimeMs: number } | null, expected: number | undefined): void {
  if (current && expected !== undefined && Math.abs(current.mtimeMs - expected) > 1) {
    throw new Error(`${path} changed on disk since it was opened; reload it before saving`)
  }
}

function touch(write: PendingWrite): void {
  clearTimeout(write.timer)
  write.timer = setTimeout(() => void discard(write), WRITE_IDLE_MS)
  write.timer.unref?.()
}

async function discard(write: PendingWrite): Promise<void> {
  if (!writes.delete(write.id)) return
  clearTimeout(write.timer)
  await write.handle.close().catch(() => undefined)
  await rm(write.temp, { force: true }).catch(() => undefined)
}

function pending(writeId: string): PendingWrite {
  const write = writes.get(writeId)
  if (!write) throw new Error('This save is no longer open on the host; save again')
  return write
}

/** Runs `step` after the save's earlier calls; a failed step drops the save and its temp file. */
function inOrder<T>(write: PendingWrite, step: () => Promise<T>): Promise<T> {
  const run = write.tail.then(async () => {
    if (!writes.has(write.id)) throw new Error('This save is no longer open on the host; save again')
    try {
      return await step()
    } catch (error) {
      await discard(write)
      throw error
    }
  })
  write.tail = run.catch(() => undefined)
  return run
}

async function append(write: PendingWrite, content: string): Promise<number> {
  let text = write.carry + content
  write.carry = ''
  const last = text.charCodeAt(text.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) {
    write.carry = text.slice(-1)
    text = text.slice(0, -1)
  }
  let bytes: Buffer
  try {
    bytes = encodeText(text, write.encoding)
  } catch (error) {
    if (!(error instanceof UnrepresentableTextError)) throw error
    const at = advance(write.line, write.column, text.slice(0, error.index))
    throw new Error(
      `${describeCharacter(error.character)} at line ${at.line}, column ${at.column} cannot be written in ${encodingLabel(write.encoding)}; nothing was saved`
    )
  }
  const at = advance(write.line, write.column, text)
  write.line = at.line
  write.column = at.column
  await write.handle.write(bytes)
  write.bytes += bytes.length
  return bytes.length
}

function advance(line: number, column: number, text: string): { line: number; column: number } {
  let from = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', from)) {
    line++
    column = 1
    from = at + 1
  }
  return { line, column: column + text.length - from }
}

async function commit(write: PendingWrite): Promise<SavedFile> {
  if (write.carry) {
    throw new Error(
      `${describeCharacter(write.carry)} at line ${write.line}, column ${write.column} cannot be written in ${encodingLabel(write.encoding)}; nothing was saved`
    )
  }
  await write.handle.close()
  // Again here: the file may have changed while the pieces were coming in.
  const current = await stat(write.absolute).catch(() => null)
  guardMtime(write.path, current, write.expectedMtimeMs)
  // Keep the executable bit and other mode flags the original had.
  if (current) await chmod(write.temp, current.mode & 0o7777).catch(() => undefined)
  await replaceFile(write.temp, write.absolute)
  writes.delete(write.id)
  clearTimeout(write.timer)
  const saved = await stat(write.absolute)
  return { mtimeMs: saved.mtimeMs, size: saved.size }
}

export async function beginTextWrite(
  root: string,
  params: { path: string; encoding: TextEncoding; bom: boolean; expectedMtimeMs?: number; content?: string; commit?: boolean }
): Promise<{ writeId: string; saved?: SavedFile }> {
  if (!isTextEncoding(params.encoding)) throw new Error(`Unknown encoding ${String(params.encoding)}`)
  const absolute = await resolveInside(root, params.path)
  const current = await stat(absolute).catch(() => null)
  if (current && !current.isFile()) throw new Error(`${params.path} is not a file`)
  guardMtime(params.path, current, params.expectedMtimeMs)
  const id = crypto.randomUUID()
  const temp = `${absolute}.zomfy-${process.pid}-${id.slice(0, 8)}.tmp`
  const handle = await open(temp, 'w')
  const write: PendingWrite = {
    id,
    path: params.path,
    absolute,
    temp,
    handle,
    encoding: params.encoding,
    expectedMtimeMs: params.expectedMtimeMs,
    carry: '',
    line: 1,
    column: 1,
    bytes: 0,
    tail: Promise.resolve(),
    timer: undefined
  }
  writes.set(id, write)
  touch(write)
  const saved = await inOrder(write, async () => {
    if (params.bom) await handle.write(bomBytes(params.encoding))
    if (params.content) await append(write, params.content)
    return params.commit ? commit(write) : undefined
  })
  return saved ? { writeId: id, saved } : { writeId: id }
}

export async function writeTextChunk(writeId: string, content: string): Promise<{ bytes: number }> {
  const write = pending(writeId)
  touch(write)
  return inOrder(write, async () => ({ bytes: await append(write, content) }))
}

export async function commitTextWrite(writeId: string): Promise<SavedFile> {
  const write = pending(writeId)
  return inOrder(write, () => commit(write))
}

/** Drops a save and its temp file; an unknown id is a save already gone. */
export async function abortTextWrite(writeId: string): Promise<void> {
  const write = writes.get(writeId)
  if (!write) return
  await write.tail
  await discard(write)
}

/** Saves that have begun and neither committed nor been dropped. */
export function pendingTextWrites(): number {
  return writes.size
}
