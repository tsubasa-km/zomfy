import { useCallback, useEffect, useState } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, X } from 'lucide-react'
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search'
import { Button } from '@/components/ui/button'
import { ImeInput } from '@/lib/ime-text-field'
import { t } from '@/i18n/i18n'

// Ported from Orca's TerminalSearch.tsx: the find bar over a terminal pane.

// xterm uses index -1 when results exceed its highlight limit.
const EMPTY_RESULTS = { resultIndex: -1, resultCount: 0 }
const MAX_QUERY = 1000

function clearSearch(addon: SearchAddon): void {
  addon.clearDecorations()
  // xterm keeps the active match selected after decorations are cleared.
  addon.findNext('')
}

/** An unfinished regex throws while typing; that is a miss, not an error. */
function safeFind(find: (term: string, options: ISearchOptions) => boolean, term: string, options: ISearchOptions): void {
  try {
    find(term, options)
  } catch {
    // Invalid pattern.
  }
}

export function TerminalSearch({
  searchAddon,
  onClose
}: {
  searchAddon: SearchAddon
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState(EMPTY_RESULTS)
  const term = query.slice(0, MAX_QUERY)
  const focusOnMount = useCallback((input: HTMLInputElement | null) => {
    input?.focus()
    input?.select()
  }, [])

  // xterm needs hex colors; explicit highlights stay visible over every terminal theme.
  const options = useCallback(
    (incremental = false): ISearchOptions => ({
      caseSensitive,
      regex,
      incremental,
      decorations: {
        matchBackground: '#5c4a00',
        matchBorder: '#5c4a00',
        matchOverviewRuler: '#ffcc00',
        activeMatchBackground: '#c4580e',
        activeMatchBorder: '#ffcf6b',
        activeMatchColorOverviewRuler: '#ff9900'
      }
    }),
    [caseSensitive, regex]
  )

  const findNext = useCallback(() => {
    if (term) safeFind((t, o) => searchAddon.findNext(t, o), term, options())
  }, [searchAddon, term, options])
  const findPrevious = useCallback(() => {
    if (term) safeFind((t, o) => searchAddon.findPrevious(t, o), term, options())
  }, [searchAddon, term, options])

  useEffect(() => {
    const disposable = searchAddon.onDidChangeResults(setResults)
    return () => {
      disposable.dispose()
      clearSearch(searchAddon)
    }
  }, [searchAddon])

  useEffect(() => {
    if (!term) {
      clearSearch(searchAddon)
      setResults(EMPTY_RESULTS)
      return
    }
    safeFind((t, o) => searchAddon.findNext(t, o), term, options(true))
  }, [term, searchAddon, options])

  const status = !term
    ? '0/0'
    : results.resultCount === 0
      ? t('No results')
      : results.resultIndex === -1
        ? `${results.resultCount}+`
        : `${results.resultIndex + 1}/${results.resultCount}`

  return (
    <div
      data-terminal-search-root
      className="absolute top-2 right-2 z-50 flex items-center gap-1 rounded-lg border border-border bg-popover/95 px-2 py-1 text-popover-foreground shadow-floating backdrop-blur-sm"
      style={{ width: 340, maxWidth: 'calc(100% - 16px)' }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
        else if (e.key === 'Enter' && e.shiftKey) findPrevious()
        else if (e.key === 'Enter') findNext()
      }}
    >
      <ImeInput
        ref={focusOnMount}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('Search...')}
        className="min-w-0 flex-1 border-none bg-transparent text-sm text-popover-foreground outline-none placeholder:text-muted-foreground"
      />
      <Button
        type="button"
        variant={caseSensitive ? 'secondary' : 'ghost'}
        size="icon-xs"
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((v) => !v)}
        className="shrink-0"
        title={t('Case sensitive')}
      >
        <CaseSensitive size={14} />
      </Button>
      <Button
        type="button"
        variant={regex ? 'secondary' : 'ghost'}
        size="icon-xs"
        aria-pressed={regex}
        onClick={() => setRegex((v) => !v)}
        className="shrink-0"
        title={t('Regex')}
      >
        <Regex size={14} />
      </Button>
      <span data-terminal-search-status className="shrink-0 px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {status}
      </span>
      <div className="mx-0.5 h-4 w-px bg-border" />
      <Button type="button" variant="ghost" size="icon-xs" onClick={findPrevious} className="shrink-0" title={t('Previous match')}>
        <ChevronUp size={14} />
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" onClick={findNext} className="shrink-0" title={t('Next match')}>
        <ChevronDown size={14} />
      </Button>
      <div className="mx-0.5 h-4 w-px bg-border" />
      <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} className="shrink-0" title={t('Close')}>
        <X size={14} />
      </Button>
    </div>
  )
}
