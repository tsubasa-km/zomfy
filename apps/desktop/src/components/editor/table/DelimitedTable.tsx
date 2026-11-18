import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, FilterX, ListFilter, Search, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'
import type { TextPreviewProps } from '../text-previews'
import { formatByteSize } from '../editor-file-kind'
import { CellViewer } from './CellViewer'
import { TableSource } from './delimited-client'
import { CELL_MAX_CHARS, COL_BLOCK, COPY_MAX_CHARS, MAX_COLUMNS, ROW_BLOCK, type ViewSpec } from './delimited-dataset'
import { delimiterForPath } from './delimited-files'
import { showSourceDelimiter } from './delimited-language'
import type { Delimiter } from './delimited-scan'
import { NATURAL_SORT_MAX_ROWS, type ColumnType, type SortDirection } from './delimited-sort'
import { PagedScroll, indexAt, selectionAfterKey, selectionRange, type Selection } from './table-geometry'
import './delimited-table.css'

const ROW_HEIGHT = 24
const HEAD_HEIGHT = 28
const FILTER_HEIGHT = 28
const OVERSCAN_ROWS = 6
const DEFAULT_WIDTH = 120
const MIN_WIDTH = 36
/** Widths guessed from a sample stop here so one long value does not push the rest off screen; dragging and fitting go further. */
const AUTO_MAX_WIDTH = 420
const FIT_MAX_WIDTH = 2400
const SAMPLE_ROWS = 300
const isMac = navigator.userAgent.includes('Mac')

const DELIMITER_LABELS: Record<Delimiter, string> = {
  ',': t('Comma'),
  '\t': t('Tab'),
  ';': t('Semicolon'),
  '|': t('Pipe')
}

const TYPE_LABELS: Record<ColumnType, string> = {
  number: t('Sorted as numbers'),
  date: t('Sorted as dates'),
  text: t('Sorted as text')
}

/** What a person set up on one file's table, kept while the window lives so switching tabs or view modes does not lose it. */
interface TableSetup {
  delimiter: Delimiter | 'auto'
  header: boolean
  sort: { column: number; direction: SortDirection } | null
  search: string
  filters: Record<number, string>
  showFilters: boolean
  widths: Record<number, number>
  top: number
  left: number
}

const setups = new Map<string, TableSetup>()
const MAX_SETUPS = 100

function setupFor(key: string): TableSetup {
  let setup = setups.get(key)
  if (!setup) {
    setup = { delimiter: 'auto', header: true, sort: null, search: '', filters: {}, showFilters: false, widths: {}, top: 0, left: 0 }
    if (setups.size >= MAX_SETUPS) setups.delete(setups.keys().next().value!)
    setups.set(key, setup)
  }
  return setup
}

function count(n: number): string {
  return n.toLocaleString()
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

let measurer: CanvasRenderingContext2D | null = null
/** The width `text` takes in the grid's font (`weight` 500 is the header's). */
function textWidth(text: string, style: CSSStyleDeclaration, weight = 400): number {
  measurer ??= document.createElement('canvas').getContext('2d')
  if (!measurer) return text.length * 7
  measurer.font = `${weight} ${style.fontSize} ${style.fontFamily}`
  const spacing = Number.parseFloat(style.letterSpacing) || 0
  return measurer.measureText(text).width + spacing * text.length
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A cell's text as shown: on one line, with what the search or the column's filter found marked. */
function cellText(value: string, cut: boolean, marks: RegExp | null): React.ReactNode {
  let text = cut ? `${value}…` : value
  let broken = false
  if (text.includes('\n') || text.includes('\r')) {
    broken = true
    text = text.replace(/\r\n|\r|\n/g, '⏎')
  }
  if (!marks && !broken) return text
  const parts: React.ReactNode[] = []
  const pattern = new RegExp(marks ? `(⏎)|${marks.source}` : '(⏎)', 'gi')
  let last = 0
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m[0] === '') {
      pattern.lastIndex++
      continue
    }
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      m[1] ? (
        <span key={m.index} className="dt-break">
          {m[1]}
        </span>
      ) : (
        <mark key={m.index}>{m[0]}</mark>
      )
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/**
 * A delimited file as a table beside (or instead of) its source. It only shows: edits happen in
 * the source and arrive here as new text. The rows are read in a worker; this component lays out
 * the window of them that is on screen.
 */
export function DelimitedTable(props: TextPreviewProps): React.JSX.Element {
  const [source, setSource] = useState<TableSource | null>(null)
  useEffect(() => {
    const created = new TableSource()
    setSource(created)
    return () => created.dispose()
  }, [])
  if (!source) return <div className="dt-grid h-full" />
  return <Table key={`${props.workspaceId}\n${props.path}`} source={source} {...props} />
}

function Table({ source, content, workspaceId, path, revealLine }: TextPreviewProps & { source: TableSource }): React.JSX.Element {
  useSyncExternalStore(source.subscribe, source.getVersion)
  const setup = useMemo(() => setupFor(`${workspaceId}\n${path}`), [workspaceId, path])
  const fallback = delimiterForPath(path) ?? ','
  const [delimiter, setDelimiter] = useState(setup.delimiter)
  const [header, setHeader] = useState(setup.header)
  const [sort, setSort] = useState(setup.sort)
  const [search, setSearch] = useState(setup.search)
  const [filters, setFilters] = useState(setup.filters)
  const [showFilters, setShowFilters] = useState(setup.showFilters)
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [userWidths, setUserWidths] = useState(setup.widths)
  const [auto, setAuto] = useState<{ widths: number[]; types: ColumnType[] }>({ widths: [], types: [] })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [viewer, setViewer] = useState<{ row: number; column: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [resizing, setResizing] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const searchBox = useRef<HTMLInputElement>(null)
  const paged = useRef(new PagedScroll()).current
  const noteTimer = useRef<number | undefined>(undefined)

  Object.assign(setup, { delimiter, header, sort, search, filters, showFilters, widths: userWidths })

  // Reading the text. The first version goes at once; edits wait for a pause in typing that
  // grows with the file, since every version is read from the top.
  const loaded = useRef(false)
  useEffect(() => {
    const delay = !loaded.current ? 0 : content.length < 256 * 1024 ? 80 : content.length < 8 * 1024 * 1024 ? 250 : 600
    const timer = setTimeout(() => {
      loaded.current = true
      source.load(content, delimiter, fallback)
    }, delay)
    return () => clearTimeout(timer)
  }, [source, content, delimiter, fallback])

  const quietSearch = useDebounced(search, 200)
  const quietFilters = useDebounced(filters, 200)
  const spec = useMemo<ViewSpec>(
    () => ({
      header,
      sort,
      search: quietSearch,
      filters: Object.entries(quietFilters)
        .filter(([, text]) => text !== '')
        .map(([column, text]) => ({ column: Number(column), text })),
      problemsOnly
    }),
    [header, sort, quietSearch, quietFilters, problemsOnly]
  )
  useEffect(() => source.setView(spec), [source, spec])

  const status = source.status
  const columns = Math.min(status?.columns ?? 0, MAX_COLUMNS)
  const rowCount = source.rowCount
  // While an edited large file is read again its rows come back from the top; the table keeps
  // its old height meanwhile so the place scrolled to is still there when they have.
  const heightFloor = useRef(0)
  if (!source.reading) heightFloor.current = rowCount
  const layoutRows = Math.max(rowCount, source.reading ? heightFloor.current : 0)
  const filtered = spec.search !== '' || spec.filters.length > 0 || problemsOnly
  const totalRows = Math.max(0, (status?.rows ?? 0) - (header ? 1 : 0))

  // The source colours and checks the file with the delimiter the table reads it with.
  const readDelimiter = status?.delimiter
  useEffect(() => {
    if (readDelimiter) showSourceDelimiter(workspaceId, path, readDelimiter)
  }, [workspaceId, path, readDelimiter])

  const flash = useCallback((message: string) => {
    setNote(message)
    window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setNote(null), 2500)
  }, [])
  useEffect(() => () => window.clearTimeout(noteTimer.current), [])

  // Geometry.
  const headHeight = HEAD_HEIGHT + (showFilters ? FILTER_HEIGHT : 0)
  const gutterWidth = Math.max(44, String(Math.max(1, status?.rows ?? 1)).length * 7.5 + 22)
  const columnStarts = useMemo(() => {
    const starts = new Float64Array(columns + 1)
    for (let c = 0; c < columns; c++) starts[c + 1] = starts[c] + (userWidths[c] ?? auto.widths[c] ?? DEFAULT_WIDTH)
    return starts
  }, [columns, userWidths, auto])
  const tableWidth = columnStarts[columns]
  const bodyHeight = Math.max(0, viewport.height - headHeight)
  const placedTop = useMemo(() => paged.configure(layoutRows * ROW_HEIGHT, bodyHeight), [paged, layoutRows, bodyHeight])

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewport({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element && Math.abs(element.scrollTop - placedTop) > 0.5) element.scrollTop = placedTop
  }, [placedTop])

  // Back to where this file's table was left, once its rows are there to scroll to.
  const restored = useRef(false)
  useLayoutEffect(() => {
    const element = scroller.current
    if (restored.current || !element || !status?.done || viewport.height === 0) return
    restored.current = true
    if (setup.top === 0 && setup.left === 0) return
    element.scrollTop = paged.scrollTo(setup.top)
    element.scrollLeft = setup.left
    setScroll({ top: paged.top, left: setup.left })
  }, [status?.done, viewport.height, paged, setup])

  const onScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const element = event.currentTarget
    const moved = paged.onScroll(element.scrollTop)
    if (moved !== null) element.scrollTop = moved
    setScroll({ top: paged.top, left: element.scrollLeft })
    if (restored.current) Object.assign(setup, { top: paged.top, left: element.scrollLeft })
  }

  const firstRow = Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN_ROWS)
  const lastRow = Math.min(rowCount - 1, Math.ceil((scroll.top + bodyHeight) / ROW_HEIGHT) + OVERSCAN_ROWS)
  const firstCol = columns === 0 ? 0 : Math.max(0, indexAt(columnStarts, columns, scroll.left) - 1)
  const lastCol = columns === 0 ? -1 : Math.min(columns - 1, indexAt(columnStarts, columns, scroll.left + viewport.width - gutterWidth) + 1)

  useEffect(() => {
    if (columns > 0) source.want(firstRow, Math.max(firstRow, lastRow), firstCol, lastCol)
  })

  // Column widths and alignment from a sample of the rows, taken again when the shape of the
  // table changes but not when it is merely sorted or filtered.
  const ready = source.view !== null && status !== null && source.view.gen === status.gen
  const sampleKey = status && rowCount + (header ? 1 : 0) > 0 ? `${status.gen}|${status.delimiter}|${columns}|${header}|${status.done}|${ready}` : ''
  useEffect(() => {
    if (!sampleKey || columns === 0) return
    let stale = false
    const rows = Math.max(20, Math.min(SAMPLE_ROWS, Math.floor(200_000 / columns)))
    void source.call({ op: 'sample', columns, rows }).then((sample) => {
      const element = scroller.current
      if (stale || !sample || !element) return
      const style = getComputedStyle(element)
      const names = header ? (source.block(0, 0)?.names ?? []) : []
      setAuto({
        widths: sample.widest.map((text, c) => {
          const name = c < COL_BLOCK ? (names[c] ?? '') : ''
          // The sample's widest value is picked by character count; a tenth more covers one with wider letters.
          const width = Math.max(textWidth(text, style) * 1.1 + 20, textWidth(name || t('Column {n}', { n: c + 1 }), style, 500) + 36)
          return Math.round(Math.max(MIN_WIDTH + 12, Math.min(AUTO_MAX_WIDTH, width)))
        }),
        types: sample.types
      })
    })
    return () => {
      stale = true
    }
    // Keyed on sampleKey alone: it names everything the sample depends on.
  }, [source, sampleKey])

  const nameOf = (column: number): string => {
    const block = header ? source.block(Math.floor(firstRow / ROW_BLOCK), Math.floor(column / COL_BLOCK)) : undefined
    return block?.names?.[column % COL_BLOCK] || t('Column {n}', { n: column + 1 })
  }

  /** The cell under a point of the window, clamped to the table. */
  const cellAt = (clientX: number, clientY: number): { row: number; col: number } => {
    const element = scroller.current!
    const box = element.getBoundingClientRect()
    const x = clientX - box.left - gutterWidth + element.scrollLeft
    const y = clientY - box.top - headHeight + paged.top
    return {
      row: Math.max(0, Math.min(rowCount - 1, Math.floor(y / ROW_HEIGHT))),
      col: indexAt(columnStarts, columns, Math.max(0, x))
    }
  }

  const reveal = (row: number, column: number): void => {
    const element = scroller.current
    if (!element) return
    const top = row * ROW_HEIGHT
    if (top < paged.top) element.scrollTop = paged.scrollTo(top)
    else if (top + ROW_HEIGHT > paged.top + bodyHeight) element.scrollTop = paged.scrollTo(top + ROW_HEIGHT - bodyHeight)
    const width = viewport.width - gutterWidth
    if (columnStarts[column] < element.scrollLeft) element.scrollLeft = columnStarts[column]
    else if (columnStarts[column + 1] > element.scrollLeft + width) element.scrollLeft = Math.min(columnStarts[column], columnStarts[column + 1] - width)
    setScroll({ top: paged.top, left: element.scrollLeft })
  }

  // Dragging: over cells, row numbers or column names, each extending what the press started.
  const drag = useRef<{ kind: Selection['kind']; x: number; y: number; timer: number } | null>(null)
  const beginDrag = (kind: Selection['kind'], event: React.PointerEvent): void => {
    if (event.button !== 0 || rowCount === 0 || columns === 0) return
    const at = cellAt(event.clientX, event.clientY)
    setSelection((current) =>
      event.shiftKey && current && current.kind === kind
        ? { ...current, row: at.row, col: at.col }
        : { kind, anchorRow: at.row, anchorCol: at.col, row: at.row, col: at.col }
    )
    const extend = (): void => {
      const state = drag.current
      const element = scroller.current
      if (!state || !element) return
      // Past an edge the table scrolls under the pointer.
      const box = element.getBoundingClientRect()
      if (state.kind !== 'columns') {
        if (state.y > box.bottom - 4) element.scrollTop += ROW_HEIGHT
        else if (state.y < box.top + headHeight + 4) element.scrollTop -= ROW_HEIGHT
      }
      if (state.kind !== 'rows') {
        if (state.x > box.right - 4) element.scrollLeft += 40
        else if (state.x < box.left + gutterWidth + 4) element.scrollLeft -= 40
      }
      const to = cellAt(state.x, state.y)
      setSelection((current) => (current && (current.row !== to.row || current.col !== to.col) ? { ...current, row: to.row, col: to.col } : current))
    }
    const move = (e: PointerEvent): void => {
      if (!drag.current) return
      drag.current.x = e.clientX
      drag.current.y = e.clientY
      extend()
    }
    const end = (): void => {
      window.clearInterval(drag.current?.timer)
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    drag.current = { kind, x: event.clientX, y: event.clientY, timer: window.setInterval(extend, 60) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }
  useEffect(
    () => () => {
      window.clearInterval(drag.current?.timer)
      drag.current = null
    },
    []
  )

  const range = selection ? selectionRange(selection, rowCount, columns) : null

  const copy = (withNames?: boolean): void => {
    if (!selection || !range || rowCount === 0) return
    const names = withNames ?? (selection.kind === 'columns' || selection.kind === 'all')
    void source.call({ op: 'copy', range, withNames: names }).then(async (copied) => {
      if (!copied) return
      if (copied.text === null) {
        toast.error(t('That is too much to copy at once (the limit is {size} of text).', { size: formatByteSize(COPY_MAX_CHARS) }))
        return
      }
      try {
        await navigator.clipboard.writeText(copied.text)
        flash(t('Copied {rows} × {columns} cells', { rows: count(range.rowTo - range.rowFrom + 1), columns: count(range.colTo - range.colFrom + 1) }))
      } catch (error) {
        toast.error(t('Could not copy'), { description: error instanceof Error ? error.message : String(error) })
      }
    })
  }

  const showInSource = (row: number, column: number): void => {
    void source.call({ op: 'locate', row, column }).then((found) => {
      if (found) revealLine(found.line, found.column)
    })
  }

  const toggleSort = (column: number): void => {
    setSort((current) =>
      current?.column !== column ? { column, direction: 'asc' } : current.direction === 'asc' ? { column, direction: 'desc' } : null
    )
  }

  const fitColumn = (column: number): void => {
    void source.call({ op: 'widest', column }).then((widest) => {
      const element = scroller.current
      if (widest === null || !element) return
      const style = getComputedStyle(element)
      const line = widest.split(/\r\n|\r|\n/)[0]
      const width = Math.max(textWidth(line, style) + 22, textWidth(nameOf(column), style, 500) + 36)
      setUserWidths((widths) => ({ ...widths, [column]: Math.round(Math.max(MIN_WIDTH, Math.min(FIT_MAX_WIDTH, width))) }))
    })
  }

  const beginResize = (column: number, event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = columnStarts[column + 1] - columnStarts[column]
    setResizing(column)
    const move = (e: PointerEvent): void =>
      setUserWidths((widths) => ({ ...widths, [column]: Math.round(Math.max(MIN_WIDTH, startWidth + e.clientX - startX)) }))
    const end = (): void => {
      setResizing(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    const mod = isMac ? event.metaKey : event.ctrlKey
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (mod && key === 'c') {
      event.preventDefault()
      copy()
    } else if (mod && key === 'f') {
      event.preventDefault()
      event.stopPropagation()
      searchBox.current?.focus()
      searchBox.current?.select()
    } else if (key === 'Enter' && selection) {
      event.preventDefault()
      setViewer({ row: selection.row, column: selection.col })
    } else if (key === 'Escape' && selection) {
      setSelection(null)
    } else {
      const next = selectionAfterKey(selection, { key: event.key, shift: event.shiftKey, mod }, rowCount, columns, Math.max(1, Math.floor(bodyHeight / ROW_HEIGHT) - 1))
      if (!next) return
      event.preventDefault()
      setSelection(next)
      if (next.kind === 'cells') reveal(next.row, next.col)
    }
  }

  const onContextMenu = (event: React.MouseEvent): void => {
    if (rowCount === 0 || columns === 0) return
    const at = cellAt(event.clientX, event.clientY)
    const inside = range && at.row >= range.rowFrom && at.row <= range.rowTo && at.col >= range.colFrom && at.col <= range.colTo
    if (!inside) setSelection({ kind: 'cells', anchorRow: at.row, anchorCol: at.col, row: at.row, col: at.col })
    else setSelection((current) => current && { ...current, row: at.row, col: at.col })
  }

  const marks = useMemo(() => (spec.search ? new RegExp(escapeRegExp(spec.search), 'gi') : null), [spec.search])
  const columnMarks = useMemo(() => new Map(spec.filters.map((f) => [f.column, new RegExp(escapeRegExp(f.text), 'gi')])), [spec.filters])

  // What is on screen.
  const realTop = scroll.top - paged.offset
  const headCells: React.ReactNode[] = []
  const filterCells: React.ReactNode[] = []
  for (let c = firstCol; c <= lastCol; c++) {
    const left = gutterWidth + columnStarts[c]
    const width = columnStarts[c + 1] - columnStarts[c]
    const sorted = sort?.column === c ? sort.direction : null
    const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown
    const name = nameOf(c)
    const extra = status !== null && c >= status.expected
    headCells.push(
      <div
        key={c}
        className="dt-hcell"
        style={{ left, width, height: HEAD_HEIGHT }}
        data-selected={range && selection?.kind !== 'rows' && c >= range.colFrom && c <= range.colTo ? '' : undefined}
        data-extra={extra || !header ? '' : undefined}
        title={extra ? t('{name}: not in the first row; only some rows have this field', { name }) : name}
        onPointerDown={(event) => beginDrag('columns', event)}
      >
        <span className="dt-hname">{name}</span>
        <button
          type="button"
          className="dt-sort"
          data-active={sorted ? '' : undefined}
          title={sorted && source.view?.sortType ? TYPE_LABELS[source.view.sortType] : t('Sort')}
          aria-label={t('Sort by {name}', { name })}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => toggleSort(c)}
        >
          <SortIcon className="size-3" />
        </button>
        <div
          className="dt-resize"
          data-active={resizing === c ? '' : undefined}
          title={t('Drag to resize; double-click to fit the content')}
          onPointerDown={(event) => beginResize(c, event)}
          onDoubleClick={() => fitColumn(c)}
        />
      </div>
    )
    if (showFilters) {
      filterCells.push(
        <div key={c} className="dt-filter" style={{ left, width, top: HEAD_HEIGHT, height: FILTER_HEIGHT }} onPointerDown={(event) => event.stopPropagation()}>
          <Input
            className="h-[22px] rounded-sm px-1.5 py-0 text-xs shadow-none md:text-xs"
            value={filters[c] ?? ''}
            placeholder={t('Filter')}
            aria-label={t('Filter {name}', { name })}
            onChange={(event) => setFilters((current) => ({ ...current, [c]: event.target.value }))}
          />
        </div>
      )
    }
  }

  const numberCells: React.ReactNode[] = []
  const rowCells: React.ReactNode[] = []
  const firstBlock = Math.floor(firstCol / COL_BLOCK)
  const lastBlock = Math.floor(Math.max(firstCol, lastCol) / COL_BLOCK)
  for (let r = firstRow; r <= lastRow; r++) {
    const top = r * ROW_HEIGHT - paged.offset
    const rowBlock = Math.floor(r / ROW_BLOCK)
    const i = r % ROW_BLOCK
    const cells: React.ReactNode[] = []
    let fields = -1
    let line = 0
    let sourceRow = -1
    for (let cb = firstBlock; cb <= lastBlock; cb++) {
      const block = source.block(rowBlock, cb)
      const values = block?.cells[i]
      if (!block || !values) continue
      fields = block.fields[i]
      line = block.line[i]
      sourceRow = block.source[i]
      const from = Math.max(firstCol, cb * COL_BLOCK)
      const to = Math.min(lastCol, cb * COL_BLOCK + COL_BLOCK - 1)
      for (let c = from; c <= to; c++) {
        const j = c - cb * COL_BLOCK
        const value = values[j]
        const cut = value !== null && value.length >= CELL_MAX_CHARS && block.cut.some((entry) => entry[0] === i && entry[1] === j)
        cells.push(
          <div
            key={c}
            className="dt-cell"
            style={{ left: columnStarts[c], width: columnStarts[c + 1] - columnStarts[c] }}
            data-number={auto.types[c] === 'number' ? '' : undefined}
            data-missing={value === null && status !== null && c < status.expected ? '' : undefined}
            data-extra={value !== null && status !== null && c >= status.expected ? '' : undefined}
          >
            {value === null ? null : cellText(value, cut, columnMarks.get(c) ?? marks)}
          </div>
        )
      }
    }
    const uneven = fields !== -1 && status !== null && fields !== status.expected
    const openQuote = status?.unterminated != null && sourceRow === status.unterminated.row
    numberCells.push(
      <div
        key={r}
        className="dt-rownum"
        style={{ top, height: ROW_HEIGHT }}
        data-selected={range && selection?.kind !== 'columns' && r >= range.rowFrom && r <= range.rowTo ? '' : undefined}
        data-problem={openQuote ? 'quote' : uneven ? 'uneven' : undefined}
        title={
          openQuote
            ? t('A quote opened on this row is never closed, so the rest of the file became part of it.')
            : uneven
              ? t('This row has {fields} fields; the first row has {expected}.', { fields, expected: status.expected })
              : line > 0
                ? t('Line {line} of the source. Click to show it there.', { line })
                : undefined
        }
        onPointerDown={(event) => {
          beginDrag('rows', event)
          if (event.button === 0 && !event.shiftKey && line > 0) revealLine(line)
        }}
      >
        {sourceRow === -1 ? '' : count(header ? sourceRow : sourceRow + 1)}
      </div>
    )
    rowCells.push(
      <div key={r} className="dt-row" style={{ top, height: ROW_HEIGHT }}>
        {cells}
      </div>
    )
  }

  let selectionBox: React.ReactNode = null
  let cursorBox: React.ReactNode = null
  if (range && selection && rowCount > 0 && columns > 0) {
    // Clipped to around the viewport: a whole column of a long file would be an element millions of pixels tall.
    const top = Math.max(range.rowFrom * ROW_HEIGHT - paged.offset, realTop - 2000)
    const bottom = Math.min((range.rowTo + 1) * ROW_HEIGHT - paged.offset, realTop + bodyHeight + 2000)
    const left = columnStarts[range.colFrom]
    if (bottom > top) selectionBox = <div className="dt-selection" style={{ top, left, width: columnStarts[range.colTo + 1] - left, height: bottom - top }} />
    if (selection.kind === 'cells' && selection.row < rowCount && selection.col < columns) {
      cursorBox = (
        <div
          className="dt-cursor"
          style={{
            top: selection.row * ROW_HEIGHT - paged.offset,
            left: columnStarts[selection.col],
            width: columnStarts[selection.col + 1] - columnStarts[selection.col],
            height: ROW_HEIGHT
          }}
        />
      )
    }
  }

  const anyFilter = Object.values(filters).some((text) => text !== '')
  const unterminated = status?.unterminated ?? null
  const unevenRows = status?.unevenRows ?? 0
  const empty = status?.done === true && status.rows === 0
  const menuCell = selection && selection.row < rowCount && selection.col < columns ? selection : null

  return (
    <div className="dt-grid flex h-full min-h-0 min-w-0 flex-col" data-delimited-table>
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-hidden border-b border-border px-2">
        <div className="relative max-w-64 min-w-28 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchBox}
            className="h-6 rounded-md pr-6 pl-7 text-xs shadow-none md:text-xs"
            value={search}
            placeholder={t('Search rows')}
            aria-label={t('Search rows')}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearch('')
                scroller.current?.focus()
              } else if (event.key === 'Enter' || event.key === 'ArrowDown') scroller.current?.focus()
            }}
          />
          {search !== '' && (
            <button
              type="button"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t('Clear search')}
              onClick={() => setSearch('')}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button
          variant="ghost"
          size="xs"
          className={cn('text-muted-foreground', (showFilters || anyFilter) && 'bg-foreground/10 text-foreground')}
          aria-pressed={showFilters}
          title={t('Filter single columns')}
          onClick={() => setShowFilters((shown) => !shown)}
        >
          <ListFilter />
          {t('Filters')}
        </Button>
        {(anyFilter || search !== '' || sort !== null || problemsOnly) && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            title={t('Clear sort and filters')}
            aria-label={t('Clear sort and filters')}
            onClick={() => {
              setSearch('')
              setFilters({})
              setSort(null)
              setProblemsOnly(false)
            }}
          >
            <FilterX />
          </Button>
        )}
        <div className="min-w-0 flex-1" />
        <Button
          variant="ghost"
          size="xs"
          className={cn('text-muted-foreground', header && 'bg-foreground/10 text-foreground')}
          aria-pressed={header}
          title={t('Use the first row as the column names')}
          onClick={() => setHeader((on) => !on)}
        >
          {t('Header row')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" className="text-muted-foreground" title={t('Delimiter')}>
              {status ? DELIMITER_LABELS[status.delimiter] : t('Delimiter')}
              {delimiter === 'auto' && status && <span className="text-muted-foreground/70">{t('(detected)')}</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={delimiter} onValueChange={(value) => setDelimiter(value as Delimiter | 'auto')}>
              <DropdownMenuRadioItem value="auto">{t('Detect automatically')}</DropdownMenuRadioItem>
              {(Object.keys(DELIMITER_LABELS) as Delimiter[]).map((choice) => (
                <DropdownMenuRadioItem key={choice} value={choice}>
                  {DELIMITER_LABELS[choice]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={scroller}
            className="dt-scroller min-h-0 flex-1"
            tabIndex={0}
            role="grid"
            aria-rowcount={rowCount}
            aria-colcount={columns}
            onScroll={onScroll}
            onKeyDown={onKeyDown}
            onContextMenu={onContextMenu}
          >
            <div className="dt-canvas" style={{ width: Math.max(gutterWidth + tableWidth, viewport.width), height: headHeight + paged.real }}>
              <div className="dt-head" style={{ height: headHeight }}>
                <div
                  className="dt-corner"
                  style={{ width: gutterWidth }}
                  title={t('Select all')}
                  onClick={() => rowCount > 0 && columns > 0 && setSelection({ kind: 'all', anchorRow: 0, anchorCol: 0, row: 0, col: 0 })}
                />
                {headCells}
                {filterCells}
              </div>
              <div className="dt-gutter" style={{ width: gutterWidth, height: paged.real }}>
                {numberCells}
              </div>
              <div
                className="dt-body"
                style={{ top: headHeight, left: gutterWidth, width: tableWidth, height: paged.real }}
                onPointerDown={(event) => beginDrag('cells', event)}
                onDoubleClick={(event) => {
                  if (rowCount === 0 || columns === 0) return
                  const at = cellAt(event.clientX, event.clientY)
                  setViewer({ row: at.row, column: at.col })
                }}
              >
                {rowCells}
                {selectionBox}
                {cursorBox}
              </div>
            </div>
            {(empty || (status?.done && rowCount === 0 && !source.busy)) && (
              <div className="pointer-events-none absolute inset-x-0 text-center text-xs text-muted-foreground" style={{ top: headHeight + 24 }}>
                {empty ? t('This file has no rows.') : filtered ? t('No rows match.') : t('Only the header row.')}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        {menuCell && (
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => copy()}>
              {t('Copy')}
              <ContextMenuShortcut>{isMac ? '⌘C' : 'Ctrl+C'}</ContextMenuShortcut>
            </ContextMenuItem>
            {header && <ContextMenuItem onSelect={() => copy(true)}>{t('Copy with Column Names')}</ContextMenuItem>}
            <ContextMenuItem onSelect={() => setViewer({ row: menuCell.row, column: menuCell.col })}>
              {t('View Whole Cell')}
              <ContextMenuShortcut>Enter</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => showInSource(menuCell.row, menuCell.col)}>{t('Show in Source')}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setSort({ column: menuCell.col, direction: 'asc' })}>{t('Sort Ascending')}</ContextMenuItem>
            <ContextMenuItem onSelect={() => setSort({ column: menuCell.col, direction: 'desc' })}>{t('Sort Descending')}</ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void source.call({ op: 'cell', row: menuCell.row, column: menuCell.col }).then((value) => {
                  if (value === null) return
                  setFilters((current) => ({ ...current, [menuCell.col]: value.slice(0, 200) }))
                  setShowFilters(true)
                })
              }}
            >
              {t('Filter Column by This Value')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => fitColumn(menuCell.col)}>{t('Fit Column to Content')}</ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      <div className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-border px-2 text-[11px] whitespace-nowrap text-muted-foreground" data-table-status>
        <span data-table-counts>
          {filtered && !source.busy
            ? t('{shown} of {total} rows', { shown: count(rowCount), total: count(totalRows) })
            : totalRows === 1
              ? t('1 row')
              : t('{count} rows', { count: count(totalRows) })}
          {' × '}
          {(status?.columns ?? 0) === 1 ? t('1 column') : t('{count} columns', { count: count(status?.columns ?? 0) })}
        </span>
        {status && status.columns > MAX_COLUMNS && (
          <span className="text-foreground">{t('Showing the first {shown} of {total} columns', { shown: count(MAX_COLUMNS), total: count(status.columns) })}</span>
        )}
        {range && selection && (
          <span>
            {t('{rows} × {columns} selected', { rows: count(range.rowTo - range.rowFrom + 1), columns: count(range.colTo - range.colFrom + 1) })}
          </span>
        )}
        {sort && source.view?.sortType && !source.busy && (
          <span>
            {TYPE_LABELS[source.view.sortType]}
            {source.view.plainTextSort && ` · ${t('by character code, not natural order, above {count} rows', { count: count(NATURAL_SORT_MAX_ROWS) })}`}
          </span>
        )}
        {note && <span className="text-foreground">{note}</span>}
        <div className="flex-1" />
        {status && !status.done && source.totalChars > 0 && (
          <span>{t('Reading… {percent}%', { percent: Math.floor((status.chars / source.totalChars) * 100) })}</span>
        )}
        {status?.done && source.busy && <span>{t('Updating…')}</span>}
        {unevenRows > 0 && (
          <button
            type="button"
            className={cn('flex items-center gap-1 rounded px-1 text-foreground hover:bg-foreground/8', problemsOnly && 'bg-foreground/10')}
            aria-pressed={problemsOnly}
            data-table-problems
            title={t('Rows whose field count differs from the first row ({expected}). Click to show only the rows with problems.', {
              expected: status?.expected ?? 0
            })}
            onClick={() => setProblemsOnly((only) => !only)}
          >
            <TriangleAlert className="size-3 text-status-warning" />
            {unevenRows === 1 ? t('1 uneven row') : t('{count} uneven rows', { count: count(unevenRows) })}
          </button>
        )}
        {unterminated && (
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1 text-foreground hover:bg-foreground/8"
            data-table-quote
            title={t('A quote is opened and never closed. Click to show where.')}
            onClick={() => revealLine(unterminated.line, unterminated.column)}
          >
            <TriangleAlert className="size-3 text-destructive" />
            {t('Unterminated quote at line {line}', { line: count(unterminated.line) })}
          </button>
        )}
        {status?.done && (
          <span title={t('Time spent reading the rows, off the main thread')}>
            {t('{count} characters read in {ms} ms', { count: count(status.chars), ms: count(Math.round(status.parseMs)) })}
          </span>
        )}
      </div>

      {viewer && (
        <CellViewer
          source={source}
          row={viewer.row}
          column={viewer.column}
          columnName={nameOf(viewer.column)}
          onShowInSource={() => showInSource(viewer.row, viewer.column)}
          onClose={() => {
            setViewer(null)
            scroller.current?.focus()
          }}
        />
      )}
    </div>
  )
}
