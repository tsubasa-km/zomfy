import type { RefObject } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useShortcutKeys } from '@/keybindings/keybinding-registry'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { SETTINGS_NAV_GROUPS, type SettingsNavSection } from './settings-navigation'

// Orca's SettingsSidebar: back button, search field, then grouped section links.

export function SettingsSidebar({
  activeSectionId,
  sections,
  query,
  onQueryChange,
  searchInputRef,
  onBack,
  onSelectSection
}: {
  activeSectionId: string
  sections: readonly SettingsNavSection[]
  query: string
  onQueryChange: (query: string) => void
  searchInputRef: RefObject<HTMLInputElement | null>
  onBack: () => void
  onSelectSection: (id: string) => void
}) {
  const searchKeys = useShortcutKeys('settings.search')
  const navItemClassName = (active: boolean) =>
    cn(
      'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-worktree-sidebar-ring/50',
      active
        ? 'bg-worktree-sidebar-accent font-medium text-worktree-sidebar-accent-foreground ring-1 ring-worktree-sidebar-ring/25'
        : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-accent/60 hover:text-worktree-sidebar-foreground'
    )

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-worktree-sidebar-border bg-worktree-sidebar">
      <div className="border-b border-worktree-sidebar-border px-3 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="w-full justify-start gap-2 text-[13px] text-muted-foreground">
          <ArrowLeft className="size-4" />
          Back to app
        </Button>
      </div>

      <div className="border-b border-worktree-sidebar-border px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            data-settings-search
            className="bg-background/60 pr-14 pl-9 text-[13px]"
          />
          {query === '' && searchKeys ? (
            <span className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
              <ShortcutKeyCombo keys={searchKeys} className="inline-flex gap-0.5" separatorClassName="text-[10px] text-muted-foreground" />
            </span>
          ) : null}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Settings sections">
        <div className="space-y-5">
          {SETTINGS_NAV_GROUPS.map((group) => {
            const groupSections = sections.filter((s) => s.group === group.id)
            if (groupSections.length === 0) return null
            return (
              <div key={group.id} className="space-y-2">
                <p className="px-3 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">{group.title}</p>
                <div className="space-y-1">
                  {groupSections.map((section) => {
                    const Icon = section.icon
                    const active = activeSectionId === section.id
                    return (
                      <button
                        key={section.id}
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        data-settings-nav={section.id}
                        onClick={() => onSelectSection(section.id)}
                        className={navItemClassName(active)}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="truncate">{section.title}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {sections.length === 0 ? <p className="px-3 text-xs text-muted-foreground">No matching settings.</p> : null}
        </div>
      </nav>
    </aside>
  )
}
