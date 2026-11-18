import { RowScanner, SNIFF_CHARS, countFields, locateColumn, readColumn, readRecord, sniffDelimiter, tsvCell, type Delimiter, type UnterminatedQuote } from './delimited-scan'
import { NATURAL_SORT_MAX_ROWS, detectColumnType, sortPositions, type ColumnType, type SortDirection } from './delimited-sort'

// One delimited file as the table's worker holds it: the text in fixed-size chunks, where each
// row starts, and the order the rows are shown in. Rows are read out of the text when asked for,
// a screenful at a time. Nothing here touches the worker's message plumbing, so tests drive it
// directly.

/** The text arrives, and is kept, in pieces this long (the last one shorter). */
export const CHUNK_CHARS = 1 << 22
/** Cells are handed to the grid in blocks of this many rows and columns. */
export const ROW_BLOCK = 64
export const COL_BLOCK = 16
/** A cell longer than this reaches the grid cut short; the whole value is fetched when it is opened. */
export const CELL_MAX_CHARS = 400
/** Columns past this are counted but not shown. */
export const MAX_COLUMNS = 16_384
/** The most text one copy puts on the clipboard. */
export const COPY_MAX_CHARS = 32 * 1024 * 1024

export interface ViewSpec {
  /** Whether the first row names the columns instead of being data. */
  header: boolean
  sort: { column: number; direction: SortDirection } | null
  /** Rows must have this text in some cell (case-insensitive). */
  search: string
  /** Rows must have each text in that column (case-insensitive). */
  filters: { column: number; text: string }[]
  /** Only rows with a structural problem. */
  problemsOnly: boolean
}

export const PLAIN_VIEW: ViewSpec = { header: true, sort: null, search: '', filters: [], problemsOnly: false }

export function isPlainOrder(spec: ViewSpec): boolean {
  return !spec.sort && !spec.search && spec.filters.length === 0 && !spec.problemsOnly
}

export interface ComputedView {
  spec: ViewSpec
  /** Source row of each shown row, or null when the rows show as they are in the file. */
  order: Uint32Array | null
  count: number
  sortType: ColumnType | null
  /** The text sort fell back from natural order to code units (NATURAL_SORT_MAX_ROWS). */
  plainTextSort: boolean
}

export interface CellBlock {
  rowBlock: number
  colBlock: number
  /** cells[i][j] is row rowBlock*ROW_BLOCK+i, column colBlock*COL_BLOCK+j; null where the row has no such field. */
  cells: (string | null)[][]
  /** [i, j, full length] of cells cut to CELL_MAX_CHARS. */
  cut: [number, number, number][]
  /** Per row: its index among the file's rows, the source line it starts on, its field count. */
  source: number[]
  line: number[]
  fields: number[]
  /** Names of the block's columns when the first row is a header. */
  names: string[] | null
}

export interface ColumnSample {
  /** Per column, the widest-looking value among the sampled rows (and the header), cut to 200 characters. */
  widest: string[]
  types: ColumnType[]
  /** The first row's values when it is the header, else empty. */
  names: string[]
}

export interface CellRange {
  rowFrom: number
  rowTo: number
  colFrom: number
  colTo: number
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// How wide each ASCII character runs in a proportional font, in average lower-case letters.
const ASCII_WIDTHS = new Float32Array(128).fill(1)
for (const narrow of " .,;:|!'`ijlI") ASCII_WIDTHS[narrow.charCodeAt(0)] = 0.5
for (const slim of 'ftr()[]{}/\\-"') ASCII_WIDTHS[slim.charCodeAt(0)] = 0.7
for (let c = 65; c <= 90; c++) if (c !== 73) ASCII_WIDTHS[c] = 1.25
for (const wide of 'mwMW@%') ASCII_WIDTHS[wide.charCodeAt(0)] = 1.6

/**
 * Rough on-screen width of a value, in average letters: enough to pick the value of a column
 * worth measuring properly. CJK and other wide characters count double.
 */
export function displayWidth(value: string): number {
  let width = 0
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    width += c < 128 ? ASCII_WIDTHS[c] : c >= 0x1100 ? 2 : 1
  }
  return width
}

export class DelimitedDataset {
  delimiter: Delimiter
  done = false
  view: ComputedView = { spec: PLAIN_VIEW, order: null, count: 0, sortType: null, plainTextSort: false }

  private readonly chunks: string[] = []
  private scanner: RowScanner | null = null
  private readonly sniff: boolean
  // The text a row is read from and where the row starts in it, set by seek().
  private text = ''
  private at = 0

  /** `chunkChars` is the length of every pushed chunk but the last; tests pass a tiny one. */
  constructor(
    delimiter: Delimiter | 'auto',
    fallback: Delimiter,
    private readonly chunkChars = CHUNK_CHARS
  ) {
    this.sniff = delimiter === 'auto'
    this.delimiter = delimiter === 'auto' ? fallback : delimiter
  }

  push(chunk: string): void {
    if (!this.scanner) {
      if (this.sniff) this.delimiter = sniffDelimiter(chunk.length > SNIFF_CHARS ? chunk.slice(0, SNIFF_CHARS + 1) : chunk, this.delimiter)
      this.scanner = new RowScanner(this.delimiter)
    }
    this.chunks.push(chunk)
    this.scanner.push(chunk)
  }

  finish(): void {
    this.scanner ??= new RowScanner(this.delimiter)
    this.scanner.finish()
    this.done = true
  }

  /** Rows read so far, the header row included. */
  get rows(): number {
    return this.scanner?.rows ?? 0
  }

  /** The widest row's field count. */
  get columns(): number {
    return this.scanner?.maxFields ?? 0
  }

  /** The first row's field count, which the others are held to. */
  get expected(): number {
    return this.scanner?.expected ?? 0
  }

  get unevenRows(): number {
    return this.scanner?.uneven.length ?? 0
  }

  get unterminated(): UnterminatedQuote | null {
    return this.scanner?.unterminated ?? null
  }

  get length(): number {
    return this.scanner?.length ?? 0
  }

  /** Rows the view shows. While the file is still being read (plain order only) this grows with it. */
  get viewCount(): number {
    return this.view.order ? this.view.count : Math.max(0, this.rows - (this.view.spec.header ? 1 : 0))
  }

  sourceRow(viewRow: number): number {
    return this.view.order ? this.view.order[viewRow] : viewRow + (this.view.spec.header ? 1 : 0)
  }

  private seek(row: number): void {
    const scanner = this.scanner!
    const start = scanner.rowStart.at(row)
    const end = row + 1 < scanner.rows ? scanner.rowStart.at(row + 1) : scanner.length
    const first = Math.floor(start / this.chunkChars)
    const last = Math.max(first, Math.floor((end - 1) / this.chunkChars))
    if (first === last) {
      this.text = this.chunks[first]
      this.at = start - first * this.chunkChars
      return
    }
    // A row that straddles chunks (a handful per file) is read from a copy of its own text.
    let text = this.chunks[first].slice(start - first * this.chunkChars)
    for (let c = first + 1; c < last; c++) text += this.chunks[c]
    this.text = text + this.chunks[last].slice(0, end - last * this.chunkChars)
    this.at = 0
  }

  private rowAtOffset(offset: number): number {
    const starts = this.scanner!.rowStart
    let low = 0
    let high = starts.length - 1
    let found = -1
    while (low <= high) {
      const mid = (low + high) >>> 1
      if (starts.at(mid) <= offset) {
        found = mid
        low = mid + 1
      } else high = mid - 1
    }
    return found
  }

  /** Rows a search can find without reading fields: one regex pass over the raw text. */
  private searchRaw(needle: string, firstRow: number): Uint32Array {
    const scanner = this.scanner!
    const found: number[] = []
    const pattern = new RegExp(escapeRegExp(needle), 'gi')
    const single = new RegExp(escapeRegExp(needle), 'i')
    for (let c = 0; c < this.chunks.length; c++) {
      const chunk = this.chunks[c]
      const base = c * this.chunkChars
      pattern.lastIndex = 0
      while (pattern.exec(chunk)) {
        const row = this.rowAtOffset(base + pattern.lastIndex - 1)
        if (row >= firstRow && found[found.length - 1] !== row) found.push(row)
        const next = row + 1 < scanner.rows ? scanner.rowStart.at(row + 1) : scanner.length
        if (next - base >= chunk.length) break
        pattern.lastIndex = Math.max(pattern.lastIndex, next - base)
      }
      // A match can lie across the chunk's end, inside the one row that does.
      const edge = base + chunk.length
      if (c + 1 < this.chunks.length) {
        const row = this.rowAtOffset(edge - 1)
        const end = row + 1 < scanner.rows ? scanner.rowStart.at(row + 1) : scanner.length
        if (row >= firstRow && end > edge && found[found.length - 1] !== row) {
          this.seek(row)
          if (single.test(this.text.slice(this.at))) found.push(row)
        }
      }
    }
    return Uint32Array.from(new Set(found)).sort()
  }

  /**
   * Works out which rows a view shows and in what order. A generator so the worker can let newer
   * requests in between steps of a long one; run it to the end with `runToEnd` otherwise.
   */
  *computeView(spec: ViewSpec): Generator<void, ComputedView> {
    const scanner = this.scanner!
    const delimiter = this.delimiter
    const firstRow = spec.header ? 1 : 0
    const all = Math.max(0, scanner.rows - firstRow)
    const filters = spec.filters.filter((f) => f.text !== '').map((f) => ({ column: f.column, pattern: new RegExp(escapeRegExp(f.text), 'i') }))
    let rows: Uint32Array | null = null
    let searched = spec.search === ''

    if (spec.problemsOnly) {
      const problems = new Set<number>(scanner.uneven.view())
      if (scanner.unterminated) problems.add(scanner.unterminated.row)
      rows = Uint32Array.from(problems)
        .filter((row) => row >= firstRow && row < scanner.rows)
        .sort()
    } else if (!searched && !spec.search.includes(delimiter) && !/["\r\n]/.test(spec.search)) {
      // Without a delimiter, quote or line break in it, the text is in a row's raw text exactly
      // when it is in one of the row's fields.
      rows = this.searchRaw(spec.search, firstRow)
      searched = true
      yield
    }

    if (!searched || filters.length > 0) {
      const search = searched ? null : new RegExp(escapeRegExp(spec.search), 'i')
      const kept: number[] = []
      const total = rows ? rows.length : all
      for (let i = 0; i < total; i++) {
        const row = rows ? rows[i] : i + firstRow
        this.seek(row)
        let keep = true
        for (const filter of filters) {
          const value = readColumn(this.text, this.at, delimiter, filter.column)
          if (value === null || !filter.pattern.test(value)) {
            keep = false
            break
          }
        }
        if (keep && search) keep = readRecord(this.text, this.at, delimiter).some((value) => search.test(value))
        if (keep) kept.push(row)
        if ((i & 0x3fff) === 0x3fff) yield
      }
      rows = Uint32Array.from(kept)
    }

    let sortType: ColumnType | null = null
    let plainTextSort = false
    if (spec.sort) {
      const count = rows ? rows.length : all
      const values = new Array<string | null>(count)
      for (let i = 0; i < count; i++) {
        this.seek(rows ? rows[i] : i + firstRow)
        values[i] = readColumn(this.text, this.at, delimiter, spec.sort.column)
        if ((i & 0x3fff) === 0x3fff) yield
      }
      sortType = detectColumnType(values)
      plainTextSort = sortType === 'text' && count > NATURAL_SORT_MAX_ROWS
      yield
      const positions = sortPositions(values, spec.sort.direction, sortType)
      if (rows) {
        const sorted = new Uint32Array(count)
        for (let i = 0; i < count; i++) sorted[i] = rows[positions[i]]
        rows = sorted
      } else {
        for (let i = 0; i < count; i++) positions[i] += firstRow
        rows = positions
      }
    }
    return { spec, order: rows, count: rows ? rows.length : all, sortType, plainTextSort }
  }

  block(rowBlock: number, colBlock: number): CellBlock {
    const scanner = this.scanner!
    const delimiter = this.delimiter
    const colFrom = colBlock * COL_BLOCK
    const colTo = colFrom + COL_BLOCK
    const rowFrom = rowBlock * ROW_BLOCK
    const rowTo = Math.min(rowFrom + ROW_BLOCK, this.viewCount)
    const block: CellBlock = { rowBlock, colBlock, cells: [], cut: [], source: [], line: [], fields: [], names: null }
    for (let r = rowFrom; r < rowTo; r++) {
      const row = this.sourceRow(r)
      this.seek(row)
      const values: (string | null)[] = readRecord(this.text, this.at, delimiter, colTo, colFrom)
      const fields = countFields(this.text, this.at, delimiter)
      for (let j = 0; j < values.length; j++) {
        const value = values[j]!
        if (value.length > CELL_MAX_CHARS) {
          block.cut.push([r - rowFrom, j, value.length])
          values[j] = value.slice(0, CELL_MAX_CHARS)
        }
      }
      while (values.length < COL_BLOCK) values.push(null)
      block.cells.push(values)
      block.source.push(row)
      block.line.push(scanner.rowLine.at(row))
      block.fields.push(fields)
    }
    if (this.view.spec.header && scanner.rows > 0) {
      this.seek(0)
      block.names = readRecord(this.text, this.at, delimiter, colTo, colFrom).map((name) => name.slice(0, CELL_MAX_CHARS))
    }
    return block
  }

  /** The whole value of one cell, or null when the row has no such field. */
  cell(viewRow: number, column: number): string | null {
    if (viewRow < 0 || viewRow >= this.viewCount) return null
    this.seek(this.sourceRow(viewRow))
    return readColumn(this.text, this.at, this.delimiter, column)
  }

  /** Where a cell starts in the source (1-based line and column); a missing field gives the row's start. */
  locate(viewRow: number, column: number): { line: number; column: number } | null {
    if (viewRow < 0 || viewRow >= this.viewCount) return null
    const row = this.sourceRow(viewRow)
    const line = this.scanner!.rowLine.at(row)
    this.seek(row)
    const found = locateColumn(this.text, this.at, this.delimiter, column)
    if (!found) return { line, column: 1 }
    // On the row's first line the column counts from the row's start, which is the line's start
    // except for a byte-order mark before the very first row.
    const lead = row === 0 && found.lineDelta === 0 ? this.scanner!.rowStart.at(0) : 0
    return { line: line + found.lineDelta, column: found.column + lead }
  }

  /** What column widths and alignment are guessed from: `maxRows` rows of the view. */
  sample(columns: number, maxRows: number): ColumnSample {
    const count = this.viewCount
    const rows = Math.min(count, maxRows)
    const widest = new Array<string>(columns).fill('')
    const widths = new Array<number>(columns).fill(0)
    const values: (string | null)[][] = Array.from({ length: columns }, () => [])
    const consider = (value: string, column: number): void => {
      if (value.length * 2 <= widths[column]) return
      const cutValue = value.length > 200 ? value.slice(0, 200) : value
      const width = displayWidth(cutValue)
      if (width > widths[column]) {
        widths[column] = width
        widest[column] = cutValue
      }
    }
    // Mostly the top of the view, which is what shows first, and the rest spread to its end: a
    // counter that has grown two digits by the last row should still fit its column.
    const top = count <= maxRows ? rows : Math.ceil((rows * 2) / 3)
    for (let i = 0; i < rows; i++) {
      const r = i < top ? i : top + Math.floor(((i - top + 1) * (count - top)) / (rows - top)) - 1
      this.seek(this.sourceRow(r))
      const record = readRecord(this.text, this.at, this.delimiter, columns)
      for (let c = 0; c < record.length; c++) {
        // A cell shows its first line only, so that is what it is measured by.
        const breakAt = record[c].search(/[\r\n]/)
        consider(breakAt === -1 ? record[c] : record[c].slice(0, breakAt), c)
        values[c].push(record[c])
      }
    }
    let names: string[] = []
    if (this.view.spec.header && this.rows > 0) {
      this.seek(0)
      names = readRecord(this.text, this.at, this.delimiter, columns).map((name) => name.slice(0, CELL_MAX_CHARS))
    }
    return { widest, types: values.map(detectColumnType), names }
  }

  /** The widest-looking value of one column over every row of the view. */
  *widest(column: number): Generator<void, string> {
    let best = ''
    let bestWidth = 0
    const count = this.viewCount
    for (let r = 0; r < count; r++) {
      this.seek(this.sourceRow(r))
      const value = readColumn(this.text, this.at, this.delimiter, column)
      if (value !== null && value.length * 2 > bestWidth) {
        const cutValue = value.length > CELL_MAX_CHARS ? value.slice(0, CELL_MAX_CHARS) : value
        const width = displayWidth(cutValue)
        if (width > bestWidth) {
          bestWidth = width
          best = cutValue
        }
      }
      if ((r & 0x3fff) === 0x3fff) yield
    }
    return best
  }

  /** A range of the view as tab-separated text, or null when it would pass COPY_MAX_CHARS. */
  *copy(range: CellRange, withNames: boolean): Generator<void, string | null> {
    const lines: string[] = []
    let size = 0
    const add = (record: string[]): boolean => {
      const cells: string[] = []
      for (let c = range.colFrom; c <= range.colTo; c++) cells.push(tsvCell(record[c - range.colFrom] ?? ''))
      const line = cells.join('\t')
      size += line.length + 1
      lines.push(line)
      return size <= COPY_MAX_CHARS
    }
    if (withNames && this.view.spec.header && this.rows > 0) {
      this.seek(0)
      add(readRecord(this.text, this.at, this.delimiter, range.colTo + 1, range.colFrom))
    }
    const last = Math.min(range.rowTo, this.viewCount - 1)
    for (let r = range.rowFrom; r <= last; r++) {
      this.seek(this.sourceRow(r))
      if (!add(readRecord(this.text, this.at, this.delimiter, range.colTo + 1, range.colFrom))) return null
      if (((r - range.rowFrom) & 0x3fff) === 0x3fff) yield
    }
    return lines.join('\n')
  }
}

export function runToEnd<T>(steps: Generator<void, T>): T {
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}
