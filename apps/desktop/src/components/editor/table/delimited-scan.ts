// Reading delimiter-separated text (CSV, TSV and their kin) as RFC 4180 describes it, leniently:
// a field that starts with a quote runs to its closing quote (line breaks and doubled quotes
// included), a quote anywhere else is an ordinary character, and text after a closing quote stays
// part of the field. Everything here is plain string work so the table's worker, the source's
// structure checks and the tests share one reading of a file.

export const DELIMITERS = [',', '\t', ';', '|'] as const
export type Delimiter = (typeof DELIMITERS)[number]

const QUOTE = 34
const LF = 10
const CR = 13
const BOM = 0xfeff

/** A Uint32Array that grows; a 100 MB file has a couple of million rows, too many for a plain array. */
export class U32List {
  data = new Uint32Array(1024)
  length = 0

  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = new Uint32Array(this.data.length * 2)
      grown.set(this.data)
      this.data = grown
    }
    this.data[this.length++] = value
  }

  at(index: number): number {
    return this.data[index]
  }

  view(): Uint32Array {
    return this.data.subarray(0, this.length)
  }
}

export interface UnterminatedQuote {
  /** Index of the row the open quote swallowed the rest of the text into. */
  row: number
  /** Where the quote opens in the source, 1-based. */
  line: number
  column: number
}

const AT_FIELD_START = 0
const IN_FIELD = 1
const IN_QUOTES = 2
/** Just after a quote inside a quoted field: the next character says whether it closed the field. */
const AFTER_QUOTE = 3

/**
 * Finds where each row starts. Text arrives in chunks of any size; offsets and lines are those of
 * the whole text. Fields are not materialised here: a row is read from its start offset when
 * someone wants to see it (readRecord), which is what keeps a large file to eight bytes a row.
 */
export class RowScanner {
  /** Offset of each row's first character. */
  readonly rowStart = new U32List()
  /** The source line (1-based) each row starts on; a quoted line break makes rows and lines differ. */
  readonly rowLine = new U32List()
  /** Rows whose field count is not the first row's. */
  readonly uneven = new U32List()
  /** Per-row field counts, kept only when asked for (delimiter sniffing). */
  readonly fieldCounts: U32List | null
  rows = 0
  /** Field count of the first row, which the others are held to. */
  expected = 0
  maxFields = 0
  /** Characters consumed so far. */
  length = 0
  unterminated: UnterminatedQuote | null = null

  private readonly delimiter: number
  private state = AT_FIELD_START
  private line = 1
  private lineStart = 0
  private previous = 0
  private rowOpen = false
  private separators = 0
  private currentStart = 0
  private currentLine = 1
  private quoteLine = 1
  private quoteColumn = 1

  constructor(delimiter: string, keepFieldCounts = false) {
    this.delimiter = delimiter.charCodeAt(0)
    this.fieldCounts = keepFieldCounts ? new U32List() : null
  }

  push(chunk: string): void {
    const delimiter = this.delimiter
    const base = this.length
    const n = chunk.length
    let state = this.state
    let previous = this.previous
    for (let i = 0; i < n; i++) {
      const c = chunk.charCodeAt(i)
      if (state === IN_QUOTES) {
        if (c === QUOTE) state = AFTER_QUOTE
        else if (c === CR || (c === LF && previous !== CR)) {
          this.line++
          this.lineStart = base + i + 1
        } else if (c === LF) this.lineStart = base + i + 1
        previous = c
        continue
      }
      if (state === AFTER_QUOTE && c === QUOTE) {
        state = IN_QUOTES
        previous = c
        continue
      }
      if (c === delimiter) {
        if (!this.rowOpen) this.open(base + i)
        this.separators++
        state = AT_FIELD_START
      } else if (c === LF || c === CR) {
        if (c === LF && previous === CR) {
          // The second half of a CRLF whose CR already ended the row.
          this.lineStart = base + i + 1
        } else {
          if (this.rowOpen) this.close()
          else this.blank(base + i)
          this.line++
          this.lineStart = base + i + 1
          state = AT_FIELD_START
        }
      } else if (state === AT_FIELD_START) {
        if (c === BOM && base + i === 0) {
          previous = c
          continue
        }
        if (!this.rowOpen) this.open(base + i)
        if (c === QUOTE) {
          state = IN_QUOTES
          this.quoteLine = this.line
          this.quoteColumn = base + i - this.lineStart + 1
        } else state = IN_FIELD
      } else if (state === AFTER_QUOTE) state = IN_FIELD
      previous = c
    }
    this.state = state
    this.previous = previous
    this.length = base + n
  }

  /** Ends the text: closes a last row that has no line break and reports a quote left open. */
  finish(): void {
    if (this.state === IN_QUOTES) this.unterminated = { row: this.rows, line: this.quoteLine, column: this.quoteColumn }
    if (this.rowOpen) this.close()
    this.state = AT_FIELD_START
  }

  private open(offset: number): void {
    this.rowOpen = true
    this.currentStart = offset
    this.currentLine = this.line
  }

  private close(): void {
    this.emit(this.currentStart, this.currentLine, this.separators + 1)
    this.rowOpen = false
    this.separators = 0
  }

  /** An empty line is an empty value in a one-column table and nothing at all in any other. */
  private blank(offset: number): void {
    if (this.expected === 1) this.emit(offset, this.line, 1)
  }

  private emit(start: number, line: number, fields: number): void {
    if (this.rows === 0) this.expected = fields
    else if (fields !== this.expected) this.uneven.push(this.rows)
    if (fields > this.maxFields) this.maxFields = fields
    this.rowStart.push(start)
    this.rowLine.push(line)
    this.fieldCounts?.push(fields)
    this.rows++
  }
}

// Where the field read last by readField / skipField stopped: the index of its delimiter or line
// break, or the text's length. A module variable rather than a returned pair because these run
// once per field of a file.
let stop = 0

function skipField(text: string, from: number, delimiter: number): void {
  const n = text.length
  let i = from
  if (i < n && text.charCodeAt(i) === QUOTE) {
    i++
    for (;;) {
      const close = text.indexOf('"', i)
      if (close === -1) {
        stop = n
        return
      }
      if (text.charCodeAt(close + 1) === QUOTE) i = close + 2
      else {
        i = close + 1
        break
      }
    }
  }
  for (; i < n; i++) {
    const c = text.charCodeAt(i)
    if (c === delimiter || c === LF || c === CR) break
  }
  stop = i
}

function readField(text: string, from: number, delimiter: number): string {
  const n = text.length
  let i = from
  let value = ''
  if (i < n && text.charCodeAt(i) === QUOTE) {
    i++
    for (;;) {
      const close = text.indexOf('"', i)
      if (close === -1) {
        stop = n
        return value + text.slice(i)
      }
      if (text.charCodeAt(close + 1) === QUOTE) {
        value += text.slice(i, close + 1)
        i = close + 2
      } else {
        value += text.slice(i, close)
        i = close + 1
        break
      }
    }
  }
  const tail = i
  for (; i < n; i++) {
    const c = text.charCodeAt(i)
    if (c === delimiter || c === LF || c === CR) break
  }
  stop = i
  return tail === from ? text.slice(from, i) : i > tail ? value + text.slice(tail, i) : value
}

/** The fields of the record that starts at `from`: those from index `first` up to (not including) `limit`. */
export function readRecord(text: string, from: number, delimiter: string, limit = Infinity, first = 0): string[] {
  const code = delimiter.charCodeAt(0)
  const fields: string[] = []
  let i = from
  for (let c = 0; c < first; c++) {
    skipField(text, i, code)
    if (stop >= text.length || text.charCodeAt(stop) !== code) return fields
    i = stop + 1
  }
  while (first + fields.length < limit) {
    fields.push(readField(text, i, code))
    if (stop >= text.length || text.charCodeAt(stop) !== code) break
    i = stop + 1
  }
  return fields
}

/** How many fields the record that starts at `from` has. */
export function countFields(text: string, from: number, delimiter: string): number {
  const code = delimiter.charCodeAt(0)
  let count = 0
  let i = from
  for (;;) {
    skipField(text, i, code)
    count++
    if (stop >= text.length || text.charCodeAt(stop) !== code) return count
    i = stop + 1
  }
}

/** Field `column` of the record that starts at `from`, or null when the record is shorter. */
export function readColumn(text: string, from: number, delimiter: string, column: number): string | null {
  const code = delimiter.charCodeAt(0)
  let i = from
  for (let c = 0; c < column; c++) {
    skipField(text, i, code)
    if (stop >= text.length || text.charCodeAt(stop) !== code) return null
    i = stop + 1
  }
  return readField(text, i, code)
}

/**
 * Where field `column` of the record at `from` starts, as lines below the record's first line and
 * a 1-based column on that line (the offset from `from` when it is still the first line). Null
 * when the record is shorter.
 */
export function locateColumn(text: string, from: number, delimiter: string, column: number): { lineDelta: number; column: number } | null {
  const code = delimiter.charCodeAt(0)
  let i = from
  for (let c = 0; c < column; c++) {
    skipField(text, i, code)
    if (stop >= text.length || text.charCodeAt(stop) !== code) return null
    i = stop + 1
  }
  let lineDelta = 0
  let lineStart = from
  for (let k = from; k < i; k++) {
    const ch = text.charCodeAt(k)
    if (ch === CR || (ch === LF && text.charCodeAt(k - 1) !== CR)) {
      lineDelta++
      lineStart = k + 1
    } else if (ch === LF) lineStart = k + 1
  }
  return { lineDelta, column: i - lineStart + 1 }
}

/** How much of a file the delimiter is guessed from. */
export const SNIFF_CHARS = 64 * 1024
const SNIFF_ROWS = 200

/**
 * Guesses the delimiter from the start of a file: the candidate that splits the most rows into
 * the same number (more than one) of fields. `fallback` (what the extension suggests) wins ties
 * and stands when no candidate splits anything.
 */
export function sniffDelimiter(sample: string, fallback: Delimiter): Delimiter {
  const cut = sample.length > SNIFF_CHARS
  const text = cut ? sample.slice(0, SNIFF_CHARS) : sample
  let best: Delimiter = fallback
  let bestScore = 0
  let bestFields = 0
  for (const candidate of DELIMITERS) {
    const scanner = new RowScanner(candidate, true)
    scanner.push(text)
    // A sample cut mid-file ends in half a row, which would count against every candidate.
    if (!cut || scanner.rows === 0) scanner.finish()
    const counts = scanner.fieldCounts!.view().subarray(0, SNIFF_ROWS)
    if (counts.length === 0) continue
    const seen = new Map<number, number>()
    for (const count of counts) seen.set(count, (seen.get(count) ?? 0) + 1)
    let fields = 0
    let rows = 0
    for (const [count, times] of seen) {
      if (count > 1 && (times > rows || (times === rows && count > fields))) {
        fields = count
        rows = times
      }
    }
    const score = rows / counts.length
    const better =
      score > bestScore || (score === bestScore && score > 0 && candidate !== best && (candidate === fallback || (best !== fallback && fields > bestFields)))
    if (better) {
      best = candidate
      bestScore = score
      bestFields = fields
    }
  }
  return best
}

/**
 * A value as one cell of tab-separated text for the clipboard. Spreadsheets read a cell that
 * starts with a quote as quoted, so a value holding a tab or line break (or starting with a
 * quote) is quoted with its quotes doubled, and anything else goes as it is.
 */
export function tsvCell(value: string): string {
  if (value.charCodeAt(0) !== QUOTE && !/[\t\n\r]/.test(value)) return value
  return `"${value.replaceAll('"', '""')}"`
}
