import { isAscii, isUtf8 } from 'node:buffer'
import iconv from 'iconv-lite'
import { TEXT_ENCODINGS, type TextEncoding } from '@acp-harness/protocol'

// Bytes to text and back, for every encoding a file can be in. Both directions run here on the host,
// through one codec (iconv-lite), so what a file decodes to always encodes back to the same bytes'
// characters, and the window only ever carries text. A browser could decode these encodings but has
// no encoder for them, and would need the raw bytes shipped to it.

const CODEC: Record<TextEncoding, string> = {
  utf8: 'utf8',
  utf16le: 'utf16le',
  utf16be: 'utf16be',
  // Windows' Shift_JIS, which is what files called Shift_JIS almost always are.
  shiftjis: 'cp932',
  eucjp: 'eucjp',
  windows1252: 'windows1252',
  gb18030: 'gb18030',
  big5: 'big5',
  euckr: 'euckr'
}

const LABEL: Record<TextEncoding, string> = {
  utf8: 'UTF-8',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  shiftjis: 'Shift_JIS',
  eucjp: 'EUC-JP',
  windows1252: 'Windows-1252',
  gb18030: 'GB18030',
  big5: 'Big5',
  euckr: 'EUC-KR'
}

const BOMS: Partial<Record<TextEncoding, Buffer>> = {
  utf8: Buffer.from([0xef, 0xbb, 0xbf]),
  utf16le: Buffer.from([0xff, 0xfe]),
  utf16be: Buffer.from([0xfe, 0xff])
}

export function isTextEncoding(value: unknown): value is TextEncoding {
  return typeof value === 'string' && (TEXT_ENCODINGS as readonly string[]).includes(value)
}

export function encodingLabel(encoding: TextEncoding): string {
  return LABEL[encoding]
}

/** The byte order mark `encoding` can start with; empty for encodings that have none. */
export function bomBytes(encoding: TextEncoding): Buffer {
  return BOMS[encoding] ?? Buffer.alloc(0)
}

/** How many leading bytes of `head` are `encoding`'s byte order mark (0 when it has none). */
export function bomLength(head: Buffer, encoding: TextEncoding): number {
  const bom = BOMS[encoding]
  return bom && head.length >= bom.length && head.subarray(0, bom.length).equals(bom) ? bom.length : 0
}

/** Bytes per code unit: a line feed is this many bytes, and offsets into the text are multiples of it. */
export function unitSize(encoding: TextEncoding): 1 | 2 {
  return encoding === 'utf16le' || encoding === 'utf16be' ? 2 : 1
}

/** Text of whole characters; a byte order mark is not handled here. Invalid bytes read as U+FFFD. */
export function decodeBytes(bytes: Buffer, encoding: TextEncoding): string {
  if (encoding === 'utf8') return bytes.toString('utf8')
  return iconv.decode(bytes, CODEC[encoding], { stripBOM: false })
}

/** Whether `bytes`, decoded to `text`, held something `encoding` does not define. */
export function hasInvalidBytes(bytes: Buffer, text: string, encoding: TextEncoding): boolean {
  if (encoding === 'utf8') return !isUtf8(bytes)
  if (unitSize(encoding) === 2) return !text.isWellFormed()
  return text.includes('�')
}

/**
 * How many leading bytes of `bytes` are whole characters, when `bytes` starts at a character
 * boundary: what is left over is the beginning of a character the next read completes.
 */
export function completeLength(bytes: Buffer, encoding: TextEncoding): number {
  const n = bytes.length
  switch (encoding) {
    case 'utf8': {
      let i = n - 1
      let back = 0
      while (i >= 0 && back < 3 && (bytes[i]! & 0xc0) === 0x80) {
        i--
        back++
      }
      if (i < 0) return n
      const lead = bytes[i]!
      const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
      return n - i < need ? i : n
    }
    case 'utf16le':
    case 'utf16be': {
      let even = n - (n % 2)
      if (even >= 2) {
        const high = bytes[encoding === 'utf16le' ? even - 1 : even - 2]!
        // A high surrogate waits for its low half.
        if (high >= 0xd8 && high <= 0xdb) even -= 2
      }
      return even
    }
    case 'windows1252':
      return n
    default: {
      let i = 0
      while (i < n) {
        const length = multibyteLength(bytes, i, encoding)
        if (i + length > n) break
        i += length
      }
      return i
    }
  }
}

function multibyteLength(bytes: Buffer, at: number, encoding: TextEncoding): number {
  const b = bytes[at]!
  if (b < 0x80) return 1
  switch (encoding) {
    case 'shiftjis':
      return (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc) ? 2 : 1
    case 'eucjp':
      return b === 0x8f ? 3 : b === 0x8e || (b >= 0xa1 && b <= 0xfe) ? 2 : 1
    case 'gb18030': {
      if (b < 0x81 || b === 0xff) return 1
      const next = bytes[at + 1]
      return next !== undefined && next >= 0x30 && next <= 0x39 ? 4 : 2
    }
    default:
      return b >= 0x81 && b <= 0xfe ? 2 : 1
  }
}

/** Text an encoding has no bytes for; `index` is where in the text given to `encodeText`. */
export class UnrepresentableTextError extends Error {
  constructor(
    readonly index: number,
    readonly character: string
  ) {
    super(`${describeCharacter(character)} cannot be written in this encoding`)
  }
}

export function describeCharacter(character: string): string {
  const code = character.codePointAt(0) ?? 0
  const hex = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
  if (code >= 0xd800 && code <= 0xdfff) return `An unpaired surrogate (${hex})`
  return code < 0x20 || code === 0xfffd ? hex : `"${character}" (${hex})`
}

/**
 * `text` in `encoding`, or an UnrepresentableTextError: nothing is ever swapped for a "?". What
 * counts as representable is that the bytes decode back to the same text.
 */
export function encodeText(text: string, encoding: TextEncoding): Buffer {
  if (encoding === 'utf8' || unitSize(encoding) === 2) {
    if (!text.isWellFormed()) {
      const index = firstDifference(text, text.toWellFormed())
      throw new UnrepresentableTextError(index, text.charAt(index))
    }
    return encoding === 'utf8' ? Buffer.from(text, 'utf8') : iconv.encode(text, CODEC[encoding])
  }
  const bytes = iconv.encode(text, CODEC[encoding])
  const back = iconv.decode(bytes, CODEC[encoding], { stripBOM: false })
  if (back !== text) {
    const index = firstDifference(text, back)
    throw new UnrepresentableTextError(index, String.fromCodePoint(text.codePointAt(index) ?? 0xfffd))
  }
  return bytes
}

function firstDifference(a: string, b: string): number {
  let i = 0
  while (i < a.length && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

export interface EncodingGuess {
  binary: boolean
  encoding: TextEncoding
  bom: boolean
  /** No candidate fits every byte looked at; `encoding` is the closest. */
  malformed: boolean
}

const HEAD_BYTES = 64 * 1024
const BLOCK_BYTES = 1024 * 1024
/** UTF-8 validity is checked on every byte up to here; a larger file is judged by this much of it. */
export const DETECT_SCAN_BYTES = 64 * 1024 * 1024
/** How much text the Shift_JIS / EUC-JP comparison reads, from the first byte that is not ASCII. */
const LEGACY_SAMPLE_BYTES = 1024 * 1024

/**
 * What a file's bytes are, in this order: a byte order mark; UTF-16 without one (NULs in every other
 * byte); binary (a NUL in the first 8 KB, git's rule); UTF-8 when every byte is valid UTF-8, which
 * text in a legacy encoding practically never is; then Shift_JIS or EUC-JP, whichever the bytes are
 * valid in. When nothing fits, the one with the fewest invalid bytes is named and flagged.
 */
export async function detectEncoding(read: (offset: number, length: number) => Promise<Buffer>, size: number): Promise<EncodingGuess> {
  const text = (encoding: TextEncoding, bom = false, malformed = false): EncodingGuess => ({ binary: false, encoding, bom, malformed })
  const head = await read(0, Math.min(size, HEAD_BYTES))
  for (const encoding of ['utf8', 'utf16le', 'utf16be'] as const) {
    if (bomLength(head, encoding) > 0) return text(encoding, true)
  }
  const wide = utf16WithoutBom(head.subarray(0, 8192))
  if (wide) return text(wide)
  if (head.subarray(0, 8192).includes(0)) return { binary: true, encoding: 'utf8', bom: false, malformed: false }

  const end = Math.min(size, DETECT_SCAN_BYTES)
  let offset = 0
  let firstNonAscii = -1
  let utf8 = true
  while (offset < end) {
    const block = await read(offset, Math.min(BLOCK_BYTES, end - offset))
    if (block.length === 0) break
    const last = offset + block.length >= end
    // A character cut by the block's end is checked with the next block; one cut by the file's end is invalid.
    const whole = last && end === size ? block.length : completeLength(block, 'utf8')
    if (firstNonAscii === -1 && !isAscii(block)) firstNonAscii = offset
    if (whole === 0 || !isUtf8(block.subarray(0, whole))) {
      utf8 = false
      break
    }
    offset += last ? block.length : whole
  }
  if (utf8) return text('utf8')

  // Everything before this block is ASCII, so the block starts on a character in any of the candidates.
  const sample = await read(firstNonAscii, Math.min(LEGACY_SAMPLE_BYTES, size - firstNonAscii))
  const atEnd = firstNonAscii + sample.length >= size
  const sjis = scoreShiftJis(atEnd ? sample : sample.subarray(0, completeLength(sample, 'shiftjis')))
  const euc = scoreEucJp(atEnd ? sample : sample.subarray(0, completeLength(sample, 'eucjp')))
  if (sjis.invalid === 0 && euc.invalid === 0) {
    // Text that is valid both ways is EUC-JP read as half-width katakana far more often than the reverse:
    // EUC-JP prose is full of kana and JIS punctuation, and real half-width text stays below 0xE0.
    if (euc.kana * 10 >= euc.chars) return text('eucjp')
    if (!sample.some((b) => b >= 0xe0)) return text('shiftjis')
    return text(sjis.halfWidth > sjis.chars - sjis.halfWidth ? 'eucjp' : 'shiftjis')
  }
  if (sjis.invalid === 0) return text('shiftjis')
  if (euc.invalid === 0) return text('eucjp')

  const asUtf8 = sample.toString('utf8')
  let utf8Invalid = 0
  let utf8Chars = 0
  for (let i = 0; i < asUtf8.length; i++) {
    const code = asUtf8.charCodeAt(i)
    if (code === 0xfffd) utf8Invalid++
    else if (code >= 0x80) utf8Chars++
  }
  const ratio = (invalid: number, chars: number): number => invalid / Math.max(1, invalid + chars)
  const candidates: [TextEncoding, number][] = [
    ['utf8', ratio(utf8Invalid, utf8Chars)],
    ['shiftjis', ratio(sjis.invalid, sjis.chars)],
    ['eucjp', ratio(euc.invalid, euc.chars)]
  ]
  candidates.sort((a, b) => a[1] - b[1])
  return text(candidates[0]![0], false, true)
}

/** Mostly-ASCII UTF-16 has a NUL as every other byte, on one side only, and never two together. */
function utf16WithoutBom(head: Buffer): 'utf16le' | 'utf16be' | null {
  const pairs = Math.floor(head.length / 2)
  if (pairs < 4) return null
  let even = 0
  let odd = 0
  for (let i = 0; i < pairs * 2; i += 2) {
    const a = head[i] === 0
    const b = head[i + 1] === 0
    if (a && b) return null
    if (a) even++
    if (b) odd++
  }
  if (odd * 10 >= pairs * 4 && even * 50 <= pairs) return 'utf16le'
  if (even * 10 >= pairs * 4 && odd * 50 <= pairs) return 'utf16be'
  return null
}

interface LegacyScore {
  /** Characters outside ASCII that are valid. */
  chars: number
  invalid: number
  halfWidth: number
  kana: number
}

function scoreShiftJis(bytes: Buffer): LegacyScore {
  const score: LegacyScore = { chars: 0, invalid: 0, halfWidth: 0, kana: 0 }
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    if (b < 0x80) continue
    if (b >= 0xa1 && b <= 0xdf) {
      score.chars++
      score.halfWidth++
      continue
    }
    const trail = bytes[i + 1]
    // 0x85, 0x86, 0xEB, 0xEC and 0xEF lead no character in CP932.
    const lead = (b >= 0x81 && b <= 0x9f && b !== 0x85 && b !== 0x86) || (b >= 0xe0 && b <= 0xfc && b !== 0xeb && b !== 0xec && b !== 0xef)
    if (lead && trail !== undefined && trail >= 0x40 && trail <= 0xfc && trail !== 0x7f) {
      score.chars++
      i++
    } else score.invalid++
  }
  return score
}

function scoreEucJp(bytes: Buffer): LegacyScore {
  const score: LegacyScore = { chars: 0, invalid: 0, halfWidth: 0, kana: 0 }
  const high = (b: number | undefined): boolean => b !== undefined && b >= 0xa1 && b <= 0xfe
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    if (b < 0x80) continue
    if (b === 0x8e && bytes[i + 1] !== undefined && bytes[i + 1]! >= 0xa1 && bytes[i + 1]! <= 0xdf) {
      score.chars++
      score.halfWidth++
      i++
    } else if (b === 0x8f && high(bytes[i + 1]) && high(bytes[i + 2])) {
      score.chars++
      i += 2
    } else if (high(b) && high(bytes[i + 1])) {
      score.chars++
      // Rows 1, 4 and 5: punctuation, hiragana, katakana.
      if (b === 0xa1 || b === 0xa4 || b === 0xa5) score.kana++
      i++
    } else score.invalid++
  }
  return score
}

/** `detectEncoding` for bytes already in memory. */
export function detectBufferEncoding(bytes: Buffer): Promise<EncodingGuess> {
  return detectEncoding(async (offset, length) => bytes.subarray(offset, offset + length), bytes.length)
}
