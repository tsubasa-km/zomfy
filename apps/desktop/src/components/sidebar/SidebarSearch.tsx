import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { setFilters, useSidebarStore } from '@/stores/sidebar-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n/i18n'

// Orca's WorkspaceKanbanSearchField (counter + clear, Escape clears), over the chat list.

export function SidebarSearch({ matchCount, totalCount }: { matchCount: number; totalCount: number }) {
  const query = useSidebarStore((s) => s.filters.query)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtering = query.trim() !== ''

  return (
    <div className="px-2 pt-1">
      <div className="relative flex min-w-0 items-center">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          aria-label={t('Search threads')}
          placeholder={t('Search threads')}
          data-sidebar-search
          className="h-7 border-worktree-sidebar-border bg-background pr-16 pl-7 text-xs"
          onChange={(e) => setFilters({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
            e.preventDefault()
            if (query) setFilters({ query: '' })
            else inputRef.current?.blur()
          }}
        />
        {query && (
          <div className="absolute right-1 flex items-center gap-0.5">
            {filtering && (
              <span aria-hidden className="text-[10px] text-muted-foreground tabular-nums" data-search-count>
                {matchCount} / {totalCount}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('Clear search')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setFilters({ query: '' })
                inputRef.current?.focus()
              }}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
