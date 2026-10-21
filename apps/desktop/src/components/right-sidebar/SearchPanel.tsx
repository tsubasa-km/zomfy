import { useEffect, useMemo, useRef, useState } from 'react'
import { CaseSensitive, ChevronRight, ChevronsDownUp, ChevronsUpDown, Loader2, Regex, ReplaceAll, Search as SearchIcon, WholeWord, X } from 'lucide-react'
import { HARNESS_METHODS, type SearchMatch, type SearchParams, type SearchResult } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { openEditorTab } from '@/session-store'
import { ImeInput } from '@/lib/ime-text-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FileResultRow, MatchResultRow, ToggleButton } from './search-result-rows'
import { hitCount, matchParts, replacementFor, searchPattern } from './search-match-preview'
import { onFindInFolder, takeFindInFolder } from './search-requests'

// Orca's explorer search (SearchQueryRow, SearchFilters, SearchResultsPane): query row with
// case/word/regex toggles, include/exclude globs, results grouped by file with counts. Replace
// follows VS Code's search view, which Orca does not have.

const DEBOUNCE_MS = 300
const INPUT_CLASS =
  'rounded-sm border border-border bg-input/50 px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring'

interface SearchForm {
  query: string
  replacement: string
  showReplace: boolean
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  include: string
  exclude: string
}

const EMPTY: SearchForm = {
  query: '',
  replacement: '',
  showReplace: false,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: '',
  exclude: ''
}
/** The panel unmounts when another sidebar tab opens; each workspace keeps its search. */
const savedForms = new Map<string, SearchForm>()

type ReplaceTarget = { paths: string[]; line?: number; count: number }

export function SearchPanel({ workspaceId }: { workspaceId: string }) {
  const [form, setForm] = useState<SearchForm>(() => {
    const include = takeFindInFolder(workspaceId)
    const saved = savedForms.get(workspaceId) ?? EMPTY
    return include === null ? saved : { ...saved, include }
  })
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<ReplaceTarget | null>(null)
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const queryRef = useRef<HTMLInputElement>(null)

  const update = (change: Partial<SearchForm>) => setForm((f) => ({ ...f, ...change }))
  useEffect(() => void savedForms.set(workspaceId, form), [workspaceId, form])
  useEffect(
    () =>
      onFindInFolder((request) => {
        if (request.workspaceId !== workspaceId) return
        takeFindInFolder(workspaceId)
        update({ include: request.include })
        queryRef.current?.focus()
      }),
    [workspaceId]
  )

  const params: SearchParams = useMemo(
    () => ({
      workspaceId,
      query: form.query,
      caseSensitive: form.caseSensitive,
      wholeWord: form.wholeWord,
      regex: form.regex,
      include: form.include,
      exclude: form.exclude
    }),
    [workspaceId, form.query, form.caseSensitive, form.wholeWord, form.regex, form.include, form.exclude]
  )

  useEffect(() => {
    const current = ++generation.current
    if (!params.query) {
      setResult(null)
      setError(null)
      setSearching(false)
      return
    }
    const timer = setTimeout(() => {
      setSearching(true)
      void harnessRequest(HARNESS_METHODS.search, params)
        .then((r) => current === generation.current && (setResult(r), setError(null)))
        .catch((e: unknown) => current === generation.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => current === generation.current && setSearching(false))
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [params, revision])

  const byFile = useMemo(() => {
    const files = new Map<string, SearchMatch[]>()
    for (const match of result?.matches ?? []) {
      const list = files.get(match.path) ?? []
      list.push(match)
      files.set(match.path, list)
    }
    return files
  }, [result])
  const pattern = useMemo(() => searchPattern(form), [form])
  const hitsByFile = useMemo(() => {
    const counts = new Map<string, number>()
    for (const [path, matches] of byFile) counts.set(path, matches.reduce((n, m) => n + hitCount(m, pattern), 0))
    return counts
  }, [byFile, pattern])
  const total = [...hitsByFile.values()].reduce((a, b) => a + b, 0)

  async function replace(target: ReplaceTarget) {
    setConfirm(null)
    try {
      await harnessRequest(HARNESS_METHODS.searchReplace, {
        ...params,
        replacement: form.replacement,
        paths: target.paths,
        ...(target.line !== undefined ? { line: target.line } : {})
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setRevision((r) => r + 1)
  }

  const allCollapsed = byFile.size > 0 && collapsed.size >= byFile.size
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1.5 border-b border-border px-2 pt-2 pb-1.5">
        <div className="flex items-start gap-1">
          <button
            type="button"
            aria-label="Toggle Replace"
            title="Toggle Replace"
            aria-expanded={form.showReplace}
            className="flex h-7 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => update({ showReplace: !form.showReplace })}
          >
            <ChevronRight className={cn('size-3 transition-transform', form.showReplace && 'rotate-90')} />
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex h-7 items-center gap-1 rounded-sm border border-border bg-input/50 px-1.5 focus-within:border-ring">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <ImeInput
                ref={queryRef}
                autoFocus
                aria-label="Search files"
                placeholder="Search"
                spellCheck={false}
                value={form.query}
                onChange={(e) => update({ query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setRevision((r) => r + 1)
                  if (e.key === 'Escape' && form.query) update({ query: '' })
                }}
                className="min-w-0 flex-1 bg-transparent py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
              />
              {searching && <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />}
              {form.query && (
                <ToggleButton active={false} title="Clear search" onClick={() => update({ query: '' })}>
                  <X className="size-3" />
                </ToggleButton>
              )}
              <ToggleButton active={form.caseSensitive} title="Match Case" onClick={() => update({ caseSensitive: !form.caseSensitive })}>
                <CaseSensitive className="size-3.5" />
              </ToggleButton>
              <ToggleButton active={form.wholeWord} title="Match Whole Word" onClick={() => update({ wholeWord: !form.wholeWord })}>
                <WholeWord className="size-3.5" />
              </ToggleButton>
              <ToggleButton active={form.regex} title="Use Regular Expression" onClick={() => update({ regex: !form.regex })}>
                <Regex className="size-3.5" />
              </ToggleButton>
            </div>
            {form.showReplace && (
              <div className="flex items-center gap-1">
                <ImeInput
                  aria-label="Replace"
                  placeholder="Replace"
                  spellCheck={false}
                  value={form.replacement}
                  onChange={(e) => update({ replacement: e.target.value })}
                  className={cn(INPUT_CLASS, 'h-7 min-w-0 flex-1')}
                />
                <ToggleButton
                  active={false}
                  title="Replace All"
                  onClick={() => total > 0 && setConfirm({ paths: [...byFile.keys()], count: total })}
                >
                  <ReplaceAll className="size-3.5" />
                </ToggleButton>
              </div>
            )}
          </div>
        </div>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Files To Include</span>
          <ImeInput
            spellCheck={false}
            placeholder="files to include (e.g. *.ts, src/**)"
            value={form.include}
            onChange={(e) => update({ include: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Files To Exclude</span>
          <ImeInput
            spellCheck={false}
            placeholder="files to exclude (e.g. *.min.js, dist/**)"
            value={form.exclude}
            onChange={(e) => update({ exclude: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      {!error && result && (result.matches.length > 0 || result.truncated) && (
        <div className="flex items-center border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate" data-search-summary="">
            {total} result{total !== 1 ? 's' : ''} in {byFile.size} file{byFile.size !== 1 ? 's' : ''}
            {result.truncated && ' (results truncated)'}
          </span>
          <ToggleButton
            active={false}
            title={allCollapsed ? 'Expand All' : 'Collapse All'}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(byFile.keys()))}
          >
            {allCollapsed ? <ChevronsUpDown className="size-3" /> : <ChevronsDownUp className="size-3" />}
          </ToggleButton>
        </div>
      )}
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto pb-2">
        {error && (
          <div role="alert" className="p-2 text-xs break-words whitespace-pre-wrap text-destructive">
            {error}
          </div>
        )}
        {!error && result && result.matches.length === 0 && !searching && (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">No results found</div>
        )}
        {!form.query && (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">Type to search in files</div>
        )}
        {!error &&
          [...byFile.entries()].map(([path, matches]) => {
            const isCollapsed = collapsed.has(path)
            return (
              <div key={path}>
                <FileResultRow
                  path={path}
                  count={hitsByFile.get(path) ?? matches.length}
                  collapsed={isCollapsed}
                  onToggle={() =>
                    setCollapsed((current) => {
                      const next = new Set(current)
                      if (isCollapsed) next.delete(path)
                      else next.add(path)
                      return next
                    })
                  }
                  onReplaceAll={form.showReplace ? () => void replace({ paths: [path], count: hitsByFile.get(path) ?? matches.length }) : undefined}
                />
                {!isCollapsed &&
                  matches.map((match) => {
                    const parts = matchParts(match, pattern)
                    return (
                      <MatchResultRow
                        key={`${match.line}:${match.column}`}
                        path={path}
                        match={match}
                        parts={parts}
                        replacement={form.showReplace ? replacementFor(parts.hit, form, form.replacement) : null}
                        onOpen={() => openEditorTab({ workspaceId, kind: 'file', path, staged: false, line: match.line })}
                        onReplace={form.showReplace ? () => void replace({ paths: [path], line: match.line, count: hitCount(match, pattern) }) : undefined}
                      />
                    )
                  })}
              </div>
            )
          })}
      </div>
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace All</DialogTitle>
            <DialogDescription className="break-words">
              Replace {confirm?.count} occurrence{confirm?.count !== 1 ? 's' : ''} across {confirm?.paths.length} file
              {confirm?.paths.length !== 1 ? 's' : ''} with "{form.replacement}"?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button autoFocus onClick={() => confirm && void replace(confirm)}>
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
