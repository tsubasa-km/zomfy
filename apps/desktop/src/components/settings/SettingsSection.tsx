import { createContext, useContext, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { matchesSettingsSearch, type SettingsSearchEntry } from './settings-navigation'

// Orca's SettingsSection + SearchableSetting: a titled section with its rows in a soft card;
// while searching, rows that do not match hide unless the section itself matched.

interface SettingsSearchState {
  query: string
  /** The section's own title matched, so every row stays visible. */
  showAll: boolean
}

const SettingsSearchContext = createContext<SettingsSearchState>({ query: '', showAll: true })

export const SettingsSearchProvider = SettingsSearchContext.Provider

/** The settings search text, for parts that fold away and must open to show what matched. */
export function useSettingsSearchQuery(): string {
  return useContext(SettingsSearchContext).query
}

export function SettingsSection({
  id,
  title,
  headerAction,
  bodyClassName,
  children
}: {
  id: string
  title: string
  headerAction?: ReactNode
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section id={id} data-settings-section={id} className="scroll-mt-8 space-y-6">
      {/* The title alone: the section's one-line summary (settings-navigation) only restated the rows
          below it, which name and explain themselves; it still feeds the settings search. */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
        <div className="min-w-0">
          <h2 className="text-2xl leading-tight font-semibold text-foreground">{title}</h2>
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div className={cn('rounded-xl border border-border/50 bg-card/50 px-7 py-6 shadow-xs', bodyClassName)}>
        {children}
      </div>
    </section>
  )
}

/** Hides its row while a search is active and the row does not match. */
export function SearchableSetting({
  entry,
  className,
  children
}: {
  entry: SettingsSearchEntry
  className?: string
  children: ReactNode
}) {
  const { query, showAll } = useContext(SettingsSearchContext)
  if (!showAll && !matchesSettingsSearch(query, entry)) return null
  return (
    <div data-setting-row className={className}>
      {children}
    </div>
  )
}
