import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CaseSensitive, Regex, TriangleAlert, WholeWord, X } from 'lucide-react'
import { HARNESS_METHODS, type FileFindMatch, type FileFindResult, type FileLine, type FileLineIndex, type TextEncoding } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { EditorTab } from '@/session-store'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { EditorHeaderButton, EditorPanelHeader } from './EditorPanelHeader'
import { EncodingMenu } from './TextFormatMenus'
import { claimEditorStatus, EditorStatusItems } from './EditorStatus'
import type { OpenedDocument } from './document-transfer'
import { useFileDiskWatch } from './use-file-disk-watch'
import { EDITOR_FONT_FAMILY } from './use-dark-class'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// A text file too large to load, read-only: only the lines on screen are fetched, by number, from
// the line index its host builds. Find runs on the host and reports matches as it goes.

const ROW_PX = 18
const PAGE_LINES = 200
const KEPT_PAGES = 40
/** The scrollbar's track stands for the whole file but is never taller than a browser can lay out. */
const MAX_TRACK_PX = 4_000_000
const MAX_MATCHES = 10_000

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** A file whose tab holds no edits changed on disk and is too large to simply read again. */
export function FileChangedNotice({ onReload }: { onReload: () => void }): React.JSX.Element {
  return (
    <div role="alert" className="shrink-0 border-b border-status-warning-border bg-status-warning-background px-4 py-2 text-xs" data-file-changed>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TriangleAlert className="size-3.5 shrink-0 text-status-warning" />
          <span className="min-w-0 font-medium text-foreground">{t('This file changed on disk.')}</span>
        </div>
        <Button type="button" size="xs" variant="outline" onClick={onReload}>
          {t('Reload from Disk')}
        </Button>
      </div>
    </div>
  )
}

interface FindState {
  matches: FileFindMatch[]
  /** Index into `matches` of the one shown; -1 before the first is found. */
  current: number
  /** Line the scan has reached, or null when it is over. */
  scanning: number | null
  capped: boolean
  error: string | null
}

const NO_FIND: FindState = { matches: [], current: -1, scanning: null, capped: false, error: null }

/** First index in `matches` (ordered by line) at or after `line`. */
function firstAtOrAfter(matches: FileFindMatch[], line: number): number {
  let low = 0
  let high = matches.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (matches[mid]!.line < line) low = mid + 1
    else high = mid
  }
  return low
}

function LineText({ line, matches, current }: { line: FileLine; matches: FileFindMatch[]; current: FileFindMatch | null }): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let at = 0
  for (const match of matches) {
    const start = match.column - 1
    if (start < at) continue
    if (start > at) parts.push(line.text.slice(at, start))
    parts.push(
      <mark
        key={start}
        className={cn('rounded-[2px] text-inherit', match === current ? 'bg-amber-400/70' : 'bg-amber-400/30')}
        {...(match === current ? { 'data-current-match': '' } : {})}
      >
        {line.text.slice(start, start + match.length)}
      </mark>
    )
    at = start + match.length
  }
  parts.push(line.text.slice(at))
  return (
    <>
      {parts}
      {line.clipped && <span className="text-muted-foreground"> … {t('(line cut here)')}</span>}
    </>
  )
}

export function LargeFileViewer({
  tab,
  opened,
  chosenEncoding
}: {
  tab: EditorTab
  /** What the first read of the file said; the file itself was not loaded. */
  opened: OpenedDocument
  chosenEncoding: TextEncoding | undefined
}): React.JSX.Element {
  const { workspaceId, path } = tab
  const [encoding, setEncoding] = useState<TextEncoding | undefined>(chosenEncoding ?? opened.format.encoding)
  const [generation, setGeneration] = useState(0)
  const [index, setIndex] = useState<FileLineIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const [top, setTop] = useState(Math.max(0, (tab.line ?? 1) - 1))
  const [height, setHeight] = useState(0)
  const [, setLoadedPages] = useState(0)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState({ caseSensitive: false, regex: false, wholeWord: false })
  const [find, setFind] = useState<FindState>(NO_FIND)
  const [goto, setGoto] = useState('')
  const pages = useRef(new Map<number, FileLine[]>())
  const pending = useRef(new Set<number>())
  /** Pages read while the index was still short of their end; read again as it grows. */
  const partial = useRef(new Set<number>())
  const mtime = useRef<number | undefined>(undefined)
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const gotoInput = useRef<HTMLInputElement>(null)
  const wheel = useRef(0)

  const lineCount = index?.lineCount ?? 0
  const rows = Math.max(1, Math.ceil(height / ROW_PX))
  const maxTop = Math.max(0, lineCount - Math.max(1, rows - 2))
  const first = Math.min(top, maxTop)
  const trackPx = Math.min(MAX_TRACK_PX, lineCount * ROW_PX)

  // The index: asked for until the host has read the whole file. Lines found so far are already shown.
  useEffect(() => {
    let live = true
    pages.current.clear()
    pending.current.clear()
    partial.current.clear()
    setIndex(null)
    setError(null)
    setChanged(false)
    setFind(NO_FIND)
    void (async () => {
      for (;;) {
        const next = await harnessRequest(HARNESS_METHODS.fsLineIndex, { workspaceId, path, ...(encoding ? { encoding } : {}) })
        if (!live) return
        mtime.current = next.mtimeMs
        setIndex(next)
        if (next.complete) return
        await new Promise((resolve) => setTimeout(resolve, 250))
        if (!live) return
      }
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [workspaceId, path, encoding, generation])

  useFileDiskWatch({
    workspaceId,
    path,
    knownMtimeMs: mtime,
    enabled: index !== null,
    onChange: () => setChanged(true)
  })

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    setHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  // The lines on screen, a page at a time; pages far from here are dropped.
  const version = index ? `${index.mtimeMs}:${index.encoding}` : ''
  const known = index?.lineCount ?? 0
  const complete = index?.complete ?? false
  useEffect(() => {
    if (!index || known === 0) return
    const from = Math.floor(first / PAGE_LINES)
    const to = Math.floor(Math.min(known - 1, first + rows) / PAGE_LINES)
    for (let page = from; page <= to; page++) {
      if ((pages.current.has(page) && !partial.current.has(page)) || pending.current.has(page)) continue
      pending.current.add(page)
      const startLine = page * PAGE_LINES + 1
      void harnessRequest(HARNESS_METHODS.fsReadLines, { workspaceId, path, encoding: index.encoding, mtimeMs: index.mtimeMs, startLine, count: PAGE_LINES })
        .then((result) => {
          if (`${mtime.current}:${index.encoding}` !== version) return
          // A page the index has not finished is asked for again once it has.
          pages.current.set(page, result.lines)
          if (result.lines.length === PAGE_LINES || result.complete) partial.current.delete(page)
          else partial.current.add(page)
          if (pages.current.size > KEPT_PAGES) {
            const far = [...pages.current.keys()].sort((a, b) => Math.abs(b - page) - Math.abs(a - page))[0]!
            pages.current.delete(far)
          }
          setLoadedPages((n) => n + 1)
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => pending.current.delete(page))
    }
  }, [workspaceId, path, version, known, complete, first, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrollTo = useCallback((line0: number) => setTop(Math.max(0, Math.round(line0))), [])

  // The scrollbar follows the view, and dragging it moves the view; `synced` tells the two apart.
  const synced = useRef(-1)
  useEffect(() => {
    const bar = track.current
    if (!bar) return
    const range = bar.scrollHeight - bar.clientHeight
    const target = maxTop > 0 ? Math.round((first / maxTop) * range) : 0
    synced.current = target
    bar.scrollTop = target
  }, [first, maxTop, trackPx, height])

  const onTrackScroll = (): void => {
    const bar = track.current
    if (!bar || Math.abs(bar.scrollTop - synced.current) <= 1) return
    const range = bar.scrollHeight - bar.clientHeight
    synced.current = bar.scrollTop
    if (range > 0) setTop(Math.round((bar.scrollTop / range) * maxTop))
  }

  const onWheel = (event: React.WheelEvent): void => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    wheel.current += event.deltaMode === 1 ? event.deltaY * ROW_PX : event.deltaY
    const lines = Math.trunc(wheel.current / ROW_PX)
    if (lines === 0) return
    wheel.current -= lines * ROW_PX
    setTop((current) => Math.max(0, Math.min(maxTop, Math.min(current, maxTop) + lines)))
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      findInput.current?.select()
      return
    }
    if (mod && event.key.toLowerCase() === 'g') {
      event.preventDefault()
      gotoInput.current?.select()
      return
    }
    if (event.target instanceof HTMLInputElement) return
    const page = Math.max(1, rows - 2)
    const move: Record<string, number> = { ArrowDown: first + 1, ArrowUp: first - 1, PageDown: first + page, PageUp: first - page, Home: 0, End: maxTop }
    const next = move[event.key]
    if (next === undefined) return
    event.preventDefault()
    scrollTo(Math.min(maxTop, next))
  }

  // Find: the host scans a stretch per request and says where to go on, so matches arrive as it reads.
  const scan = useRef(0)
  const runFind = useCallback(
    (text: string) => {
      const token = ++scan.current
      if (!index || !text) {
        setFind(NO_FIND)
        return
      }
      setFind({ ...NO_FIND, scanning: 1 })
      void (async () => {
        const found: FileFindMatch[] = []
        let fromLine: number | null = 1
        while (fromLine !== null && found.length < MAX_MATCHES) {
          const result: FileFindResult = await harnessRequest(HARNESS_METHODS.fsFindInFile, {
            workspaceId,
            path,
            encoding: index.encoding,
            mtimeMs: index.mtimeMs,
            query: text,
            ...options,
            fromLine,
            maxMatches: 500
          })
          if (scan.current !== token) return
          found.push(...result.matches)
          fromLine = result.nextLine
          const matches = found.slice()
          setFind((state) => ({ ...state, matches, scanning: fromLine, capped: fromLine !== null && found.length >= MAX_MATCHES }))
        }
        setFind((state) => ({ ...state, scanning: null }))
      })().catch((e: unknown) => scan.current === token && setFind({ ...NO_FIND, error: e instanceof Error ? e.message : String(e) }))
    },
    [index, workspaceId, path, options]
  )

  useEffect(() => {
    const timer = setTimeout(() => runFind(query), 300)
    return () => clearTimeout(timer)
  }, [query, runFind])

  const showMatch = (at: number): void => {
    const match = find.matches[at]
    if (!match) return
    setFind((state) => ({ ...state, current: at }))
    revealMatch.current = true
    if (match.line - 1 < first || match.line - 1 >= first + rows - 2) scrollTo(Math.min(maxTop, match.line - 1 - Math.floor(rows / 3)))
  }
  const step = (by: 1 | -1): void => {
    const count = find.matches.length
    if (count === 0) return
    if (find.current === -1) showMatch(by === 1 ? firstAtOrAfter(find.matches, first + 1) % count : (firstAtOrAfter(find.matches, first + 1) - 1 + count) % count)
    else showMatch((find.current + by + count) % count)
  }

  const currentMatch = find.matches[find.current] ?? null
  // The match's line may arrive after the jump; bring it into view sideways once it is drawn.
  const revealMatch = useRef(false)
  useEffect(() => {
    if (!revealMatch.current) return
    const mark = viewport.current?.querySelector('[data-current-match]')
    if (!mark) return
    revealMatch.current = false
    mark.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })

  const goToLine = (): void => {
    const line = Number.parseInt(goto.replaceAll(',', ''), 10)
    if (!Number.isFinite(line)) return
    scrollTo(Math.min(maxTop, Math.max(0, line - 1)))
    viewport.current?.focus()
  }

  const visible: { number: number; line: FileLine | undefined; matches: FileFindMatch[] }[] = []
  for (let i = 0; i < rows && first + i < lineCount; i++) {
    const number = first + i + 1
    const line = pages.current.get(Math.floor((number - 1) / PAGE_LINES))?.[(number - 1) % PAGE_LINES]
    const matches: FileFindMatch[] = []
    for (let at = firstAtOrAfter(find.matches, number); find.matches[at]?.line === number; at++) matches.push(find.matches[at]!)
    visible.push({ number, line, matches })
  }

  const gutterCh = Math.max(4, String(Math.max(1, lineCount)).length) + 1
  const findLabel = find.error
    ? find.error
    : !query
      ? ''
      : find.matches.length === 0
        ? find.scanning !== null
          ? t('Searching…')
          : t('No results')
        : `${find.current + 1 || '–'} / ${find.matches.length.toLocaleString()}${find.capped || find.scanning !== null ? '+' : ''}`
  const toggle = (key: keyof typeof options): void => setOptions((current) => ({ ...current, [key]: !current[key] }))
  const rowStyle = { height: ROW_PX, lineHeight: `${ROW_PX}px` }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-editor-surface" data-editor-tab={tab.id} data-large-file onKeyDown={onKeyDown} onPointerDownCapture={() => claimEditorStatus(tab.id)}>
      <EditorPanelHeader
        workspaceId={workspaceId}
        path={path}
        external
        status={
          <>
            <span className="shrink-0 text-xs text-muted-foreground" data-large-file-status>
              {t('{size}, read-only', { size: formatBytes(index?.size ?? opened.size) })}
              {index && ` · ${index.complete ? t('{n} lines', { n: index.lineCount.toLocaleString() }) : t('Indexing… {percent}%', { percent: Math.floor((index.indexedBytes / Math.max(1, index.size)) * 100) })}`}
            </span>
            {error && (
              <span className="min-w-0 truncate text-xs text-destructive" title={error}>
                {error}
              </span>
            )}
          </>
        }
        controls={
          index ? (
            <EditorStatusItems owner={tab.id}>
            <EncodingMenu
              format={{ encoding: index.encoding, bom: index.bom }}
              malformed={index.malformed}
              onReopen={(next) => {
                setEncoding(next ?? undefined)
                setGeneration((n) => n + 1)
              }}
            />
            </EditorStatusItems>
          ) : undefined
        }
        menuItems={
          <>
            <DropdownMenuItem onSelect={() => setGeneration((n) => n + 1)}>{t('Reload from Disk')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => gotoInput.current?.select()}>{t('Go to Line…')}</DropdownMenuItem>
          </>
        }
      />
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-1 text-xs" data-large-file-toolbar>
        <input
          ref={findInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') step(event.shiftKey ? -1 : 1)
            if (event.key === 'Escape') setQuery('')
          }}
          placeholder={t('Find in file')}
          aria-label={t('Find in file')}
          spellCheck={false}
          className="h-6 w-56 min-w-0 rounded border border-border bg-background px-2 text-xs outline-none focus:border-ring"
          data-large-file-find
        />
        <EditorHeaderButton label={t('Match Case')} pressed={options.caseSensitive} onClick={() => toggle('caseSensitive')}>
          <CaseSensitive size={14} />
        </EditorHeaderButton>
        <EditorHeaderButton label={t('Match Whole Word')} pressed={options.wholeWord} onClick={() => toggle('wholeWord')}>
          <WholeWord size={14} />
        </EditorHeaderButton>
        <EditorHeaderButton label={t('Use Regular Expression')} pressed={options.regex} onClick={() => toggle('regex')}>
          <Regex size={14} />
        </EditorHeaderButton>
        <EditorHeaderButton label={t('Previous match')} disabled={find.matches.length === 0} onClick={() => step(-1)}>
          <ArrowUp size={14} />
        </EditorHeaderButton>
        <EditorHeaderButton label={t('Next match')} disabled={find.matches.length === 0} onClick={() => step(1)}>
          <ArrowDown size={14} />
        </EditorHeaderButton>
        <span className={cn('min-w-0 truncate', find.error ? 'text-destructive' : 'text-muted-foreground')} data-large-file-find-status title={find.error ?? undefined}>
          {findLabel}
        </span>
        {find.scanning !== null && (
          <>
            <span className="shrink-0 text-muted-foreground">{Math.floor((find.scanning / Math.max(1, lineCount)) * 100)}%</span>
            <EditorHeaderButton
              label={t('Stop searching')}
              onClick={() => {
                scan.current++
                setFind((state) => ({ ...state, scanning: null, capped: true }))
              }}
            >
              <X size={14} />
            </EditorHeaderButton>
          </>
        )}
        <span className="flex-1" />
        <label className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {t('Line')}
          <input
            ref={gotoInput}
            value={goto}
            onChange={(event) => setGoto(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && goToLine()}
            inputMode="numeric"
            placeholder={String(first + 1)}
            aria-label={t('Go to Line…')}
            className="h-6 w-24 rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
            data-large-file-goto
          />
        </label>
      </div>
      {changed && <FileChangedNotice onReload={() => setGeneration((n) => n + 1)} />}
      <div
        ref={viewport}
        tabIndex={0}
        onWheel={onWheel}
        className="flex min-h-0 flex-1 overflow-hidden text-[13px] font-normal outline-none"
        style={{ fontFamily: EDITOR_FONT_FAMILY }}
        data-large-file-lines
      >
        <div className="shrink-0 select-none pr-3 text-right text-muted-foreground/70" style={{ width: `${gutterCh + 2}ch` }} aria-hidden>
          {visible.map((row) => (
            <div key={row.number} style={rowStyle}>
              {row.number}
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="w-max min-w-full">
            {visible.map((row) => (
              <div key={row.number} className="whitespace-pre pr-6 text-foreground" style={rowStyle} data-line={row.number}>
                {row.line ? <LineText line={row.line} matches={row.matches} current={currentMatch} /> : ' '}
              </div>
            ))}
          </div>
        </div>
        <div ref={track} onScroll={onTrackScroll} className="w-3.5 shrink-0 overflow-x-hidden overflow-y-scroll" data-large-file-scrollbar>
          <div style={{ height: trackPx + height }} />
        </div>
      </div>
    </div>
  )
}
