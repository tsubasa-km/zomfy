import type { CellRange } from './delimited-dataset'

// The arithmetic of the grid that has nothing to do with React: scrolling past the tallest
// element a browser will lay out, and what the keyboard does to a selection.

/** Browsers stop laying out somewhere past 16 million pixels; the scrolled element stays well under. */
export const MAX_SCROLL_PX = 8_000_000

/**
 * Scrolling a list taller than an element can be. The list is cut into pages; within a page the
 * scrollbar moves the content pixel for pixel, and each page starts a little further down the
 * list than the scrollbar alone would reach. Dragging the thumb a long way lands on the page that
 * part of the scrollbar stands for (the scheme SlickGrid uses). A list that fits is scrolled as is.
 */
export class PagedScroll {
  /** Height of the whole list. */
  total = 0
  /** Height the scrolled element is given. */
  real = 0
  /** How far the content is shifted up from where the element's scroll position alone would put it. */
  offset = 0
  private viewport = 0
  private scrollTop = 0
  private pageHeight = 0
  private pages = 1
  private jump = 0

  /** The list position at the top of the viewport. */
  get top(): number {
    return this.scrollTop + this.offset
  }

  /** Sets the sizes, keeping the list position. Returns the element scroll position that shows it. */
  configure(total: number, viewport: number, max = MAX_SCROLL_PX): number {
    const top = this.top
    this.total = total
    this.viewport = viewport
    this.real = Math.min(total, max)
    this.pageHeight = this.real / 100
    this.pages = this.real < total ? Math.floor(total / this.pageHeight) : 1
    this.jump = this.pages > 1 ? (total - this.real) / (this.pages - 1) : 0
    return this.scrollTo(top)
  }

  /** Moves to a list position. Returns the element scroll position that shows it. */
  scrollTo(top: number): number {
    const clamped = Math.max(0, Math.min(top, this.total - this.viewport))
    const page = this.jump > 0 ? Math.min(this.pages - 1, Math.floor(clamped / this.pageHeight)) : 0
    this.offset = Math.round(page * this.jump)
    this.scrollTop = clamped - this.offset
    return this.scrollTop
  }

  /** Takes in the element's new scroll position. Returns the position to move it to when a page was crossed, else null. */
  onScroll(scrollTop: number): number | null {
    if (this.jump === 0) {
      this.scrollTop = scrollTop
      return null
    }
    const distance = Math.abs(scrollTop - this.scrollTop)
    if (distance < this.viewport) {
      const moved = this.scrollTo(scrollTop + this.offset)
      return moved === scrollTop ? null : moved
    }
    const span = this.real - this.viewport
    const page = span <= 0 ? 0 : Math.min(this.pages - 1, Math.floor((scrollTop * ((this.total - this.viewport) / span)) / this.pageHeight))
    this.offset = Math.round(page * this.jump)
    this.scrollTop = scrollTop
    return null
  }
}

/** The index of the last entry of ascending `starts` that is not past `position`. */
export function indexAt(starts: ArrayLike<number>, count: number, position: number): number {
  let low = 0
  let high = count - 1
  while (low < high) {
    const mid = (low + high + 1) >>> 1
    if (starts[mid] <= position) low = mid
    else high = mid - 1
  }
  return Math.max(0, low)
}

/** What is selected: a block of cells, whole rows, whole columns or everything, from an anchor to where the cursor is. */
export interface Selection {
  kind: 'cells' | 'rows' | 'columns' | 'all'
  anchorRow: number
  anchorCol: number
  row: number
  col: number
}

export function selectionRange(selection: Selection, rows: number, columns: number): CellRange {
  const wholeRows = selection.kind === 'rows' || selection.kind === 'all'
  const wholeColumns = selection.kind === 'columns' || selection.kind === 'all'
  return {
    rowFrom: wholeColumns ? 0 : Math.min(selection.anchorRow, selection.row),
    rowTo: wholeColumns ? rows - 1 : Math.min(rows - 1, Math.max(selection.anchorRow, selection.row)),
    colFrom: wholeRows ? 0 : Math.min(selection.anchorCol, selection.col),
    colTo: wholeRows ? columns - 1 : Math.min(columns - 1, Math.max(selection.anchorCol, selection.col))
  }
}

export interface KeyPress {
  key: string
  shift: boolean
  /** Ctrl, or Cmd on a Mac. */
  mod: boolean
}

/**
 * The selection after a navigation key, spreadsheet style: arrows move the cursor, Shift extends
 * from the anchor, Ctrl jumps to the edge, Ctrl+A takes everything, Shift+Space the cursor's rows
 * and Ctrl+Space its columns. Null when the key is not one of these.
 */
export function selectionAfterKey(selection: Selection | null, press: KeyPress, rows: number, columns: number, pageRows: number): Selection | null {
  if (rows === 0 || columns === 0) return null
  const from = selection ?? { kind: 'cells', anchorRow: 0, anchorCol: 0, row: 0, col: 0 }
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key
  if (press.mod && key === 'a') return { kind: 'all', anchorRow: 0, anchorCol: 0, row: from.row, col: from.col }
  if (key === ' ' && press.shift) return { ...from, kind: 'rows' }
  if (key === ' ' && press.mod) return { ...from, kind: 'columns' }
  let row = Math.min(from.row, rows - 1)
  let col = Math.min(from.col, columns - 1)
  switch (key) {
    case 'ArrowUp':
      row = press.mod ? 0 : row - 1
      break
    case 'ArrowDown':
      row = press.mod ? rows - 1 : row + 1
      break
    case 'ArrowLeft':
      col = press.mod ? 0 : col - 1
      break
    case 'ArrowRight':
      col = press.mod ? columns - 1 : col + 1
      break
    case 'PageUp':
      row -= pageRows
      break
    case 'PageDown':
      row += pageRows
      break
    case 'Home':
      col = 0
      if (press.mod) row = 0
      break
    case 'End':
      col = columns - 1
      if (press.mod) row = rows - 1
      break
    default:
      return null
  }
  row = Math.max(0, Math.min(rows - 1, row))
  col = Math.max(0, Math.min(columns - 1, col))
  if (!press.shift) return { kind: 'cells', anchorRow: row, anchorCol: col, row, col }
  // Extending whole rows or columns keeps them whole.
  const kind = from.kind === 'all' ? 'cells' : from.kind
  return { kind, anchorRow: from.anchorRow, anchorCol: from.anchorCol, row, col }
}
