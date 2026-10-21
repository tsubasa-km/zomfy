import { useEffect, useRef, useState } from 'react'
import { CaseSensitive, ChevronRight, File, Regex } from 'lucide-react'
import { HARNESS_METHODS, type SearchMatch, type SearchResult } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { openEditorTab } from '@/session-store'
import { cn } from '@/lib/utils'

// Follows Orca's explorer search (SearchQueryRow, SearchFilters, SearchResultItems): a query row with
// case/regex toggles, results grouped by file with match counts.

const DEBOUNCE_MS = 300

export function SearchPanel({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    if (!query.trim()) {
      setResult(null)
      setError(null)
      return
    }
    const timer = setTimeout(() => {
      setSearching(true)
      void harnessRequest(HARNESS_METHODS.search, { workspaceId, query, caseSensitive, regex })
        .then((r) => current === generation.current && (setResult(r), setError(null)))
        .catch((e: unknown) => current === generation.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => current === generation.current && setSearching(false))
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [workspaceId, query, caseSensitive, regex])

  const byFile = new Map<string, SearchMatch[]>()
  for (const match of result?.matches ?? []) {
    const list = byFile.get(match.path) ?? []
    list.push(match)
    byFile.set(match.path, list)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-2 pb-1">
        <div className="flex items-center gap-1 rounded-md border border-input bg-background px-2 shadow-xs focus-within:border-ring focus-within:ring-1 focus-within:ring-ring dark:bg-input/30">
          <input
            aria-label="Search in workspace"
            autoFocus
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
          />
          <Toggle label="Match case" active={caseSensitive} onClick={() => setCaseSensitive(!caseSensitive)}>
            <CaseSensitive className="size-3.5" />
          </Toggle>
          <Toggle label="Use regular expression" active={regex} onClick={() => setRegex(!regex)}>
            <Regex className="size-3.5" />
          </Toggle>
        </div>
        <p className="mt-1.5 h-4 text-[11px] text-muted-foreground">
          {searching
            ? 'Searching…'
            : error
              ? ''
              : result
                ? `${result.matches.length}${result.truncated ? '+' : ''} results in ${byFile.size} files`
                : ''}
        </p>
        {error && <p className="text-xs break-words text-destructive">{error}</p>}
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {[...byFile.entries()].map(([path, matches]) => {
          const slash = path.lastIndexOf('/')
          const open = !collapsed.has(path)
          return (
            <div key={path} data-search-file={path}>
              <button
                type="button"
                className="flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent"
                onClick={() => {
                  const next = new Set(collapsed)
                  if (open) next.add(path)
                  else next.delete(path)
                  setCollapsed(next)
                }}
              >
                <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                <File className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate text-foreground">{path.slice(slash + 1)}</span>
                {slash >= 0 && <span className="truncate text-[11px] text-muted-foreground">{path.slice(0, slash)}</span>}
                <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground tabular-nums">
                  {matches.length}
                </span>
              </button>
              {open &&
                matches.map((match) => (
                  <button
                    key={`${match.line}:${match.column}`}
                    type="button"
                    data-search-match={`${path}:${match.line}`}
                    className="flex w-full items-baseline gap-2 rounded-sm py-0.5 pr-2 pl-8 text-left text-xs hover:bg-accent"
                    onClick={() => openEditorTab({ workspaceId, kind: 'file', path, staged: false, line: match.line })}
                  >
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{match.line}</span>
                    <span className="truncate font-mono text-[11px] text-foreground/90">
                      <Highlighted text={match.text.trim()} query={query} caseSensitive={caseSensitive} regex={regex} />
                    </span>
                  </button>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Toggle({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground',
        active && 'bg-accent text-foreground ring-1 ring-ring/40'
      )}
    >
      {children}
    </button>
  )
}

function Highlighted({
  text,
  query,
  caseSensitive,
  regex
}: {
  text: string
  query: string
  caseSensitive: boolean
  regex: boolean
}) {
  let pattern: RegExp
  try {
    pattern = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi')
  } catch {
    return <>{text}</>
  }
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (!match[0]) break
    parts.push(text.slice(last, match.index))
    parts.push(
      <mark key={match.index} className="rounded-sm bg-amber-400/35 text-inherit">
        {match[0]}
      </mark>
    )
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}
