import type { CellBlock, CellRange, ColumnSample, ViewSpec } from './delimited-dataset'
import type { Delimiter, UnterminatedQuote } from './delimited-scan'
import type { ColumnType } from './delimited-sort'

// What the table and its worker say to each other. A `gen` is one version of the file's text; a
// `viewId` is one choice of sort and filters. Requests name both, so an answer about text or an
// order that has since been replaced is recognised and dropped.

export type ToWorker =
  /** A new version of the text follows in chunks. `keep` leaves the version on screen answerable until this one is ready. */
  | { type: 'begin'; gen: number; delimiter: Delimiter | 'auto'; fallback: Delimiter; keep: boolean }
  | { type: 'chunk'; gen: number; text: string }
  | { type: 'end'; gen: number }
  | { type: 'view'; viewId: number; spec: ViewSpec }
  | { type: 'blocks'; requestId: number; gen: number; viewId: number; blocks: [rowBlock: number, colBlock: number][] }
  | { type: 'call'; requestId: number; gen: number; viewId: number; call: TableCall }

export type TableCall =
  | { op: 'cell'; row: number; column: number }
  | { op: 'locate'; row: number; column: number }
  | { op: 'sample'; columns: number; rows: number }
  | { op: 'widest'; column: number }
  | { op: 'copy'; range: CellRange; withNames: boolean }

export interface LoadProgress {
  type: 'progress'
  gen: number
  /** Rows read so far, a header row included. */
  rows: number
  columns: number
  /** Field count of the first row. */
  expected: number
  unevenRows: number
  unterminated: UnterminatedQuote | null
  chars: number
  delimiter: Delimiter
  done: boolean
  /** Time spent reading rows, in the worker, so far. */
  parseMs: number
}

export interface ViewReady {
  type: 'view'
  gen: number
  viewId: number
  count: number
  sortType: ColumnType | null
  plainTextSort: boolean
  computeMs: number
}

export type FromWorker =
  | LoadProgress
  | ViewReady
  /** `blocks` is null when the text or view asked about is gone. */
  | { type: 'blocks'; requestId: number; gen: number; viewId: number; blocks: CellBlock[] | null }
  | { type: 'result'; requestId: number; value: unknown }

export type CallResult<C extends TableCall> = C extends { op: 'cell' }
  ? string | null
  : C extends { op: 'locate' }
    ? { line: number; column: number } | null
    : C extends { op: 'sample' }
      ? ColumnSample | null
      : C extends { op: 'widest' }
        ? string | null
        : { text: string | null; tooLarge: boolean } | null
