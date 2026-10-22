import { useRef, useState, type ReactNode } from 'react'
import { closeSettings, selectSettingsSection, useAppOverlays } from '@/stores/app-overlay-store'
import { useCommandHandler } from '@/keybindings/keybinding-registry'
import { cn } from '@/lib/utils'
import { SETTINGS_SECTIONS, matchesSettingsSearch, sectionMatchesSearch } from './settings-navigation'
import { SettingsSearchProvider, SettingsSection } from './SettingsSection'
import { SettingsSidebar } from './SettingsSidebar'
import { AgentsPane } from './AgentsPane'
import { AppearancePane } from './AppearancePane'
import { GeneralPane } from './GeneralPane'
import { HostsPane } from './HostsPane'
import { InputEditingPane } from './InputEditingPane'
import { NotificationsPane } from './NotificationsPane'
import { ShortcutsPane } from './ShortcutsPane'
import { SkillsPane } from './SkillsPane'
import { PluginsPane } from './PluginsPane'
import { TerminalPane } from './TerminalPane'

// Orca's settings page (settings-page-renderer.tsx): it replaces the app view, with a section
// sidebar on the left and one section at a time on the right.

function renderPane(id: string, query: string): ReactNode {
  switch (id) {
    case 'agents':
      return <AgentsPane />
    case 'general':
      return <GeneralPane />
    case 'terminal':
      return <TerminalPane />
    case 'appearance':
      return <AppearancePane />
    case 'input':
      return <InputEditingPane />
    case 'notifications':
      return <NotificationsPane />
    case 'shortcuts':
      return <ShortcutsPane searchQuery={query} />
    case 'hosts':
      return <HostsPane />
    case 'skills':
      return <SkillsPane />
    case 'plugins':
      return <PluginsPane />
    default:
      return null
  }
}

export function SettingsPage() {
  const requested = useAppOverlays((s) => s.settings.section)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useCommandHandler('settings.search', () => {
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  })

  const searching = query.trim() !== ''
  const sections = searching ? SETTINGS_SECTIONS.filter((s) => sectionMatchesSearch(query, s)) : SETTINGS_SECTIONS
  const active = sections.find((s) => s.id === requested) ?? sections[0]
  const showAll = !searching || (!!active && matchesSettingsSearch(query, { title: active.title, description: active.description }))
  const isShortcuts = active?.id === 'shortcuts'

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden bg-background"
      data-settings-page
      onKeyDown={(event) => {
        // Esc leaves settings unless a field is holding text or a menu already handled it.
        if (event.key !== 'Escape' || event.defaultPrevented) return
        const target = event.target
        // Portaled menus (select lists, tooltips) bubble through React but are not inside the page.
        if (!(target instanceof Node) || !event.currentTarget.contains(target)) return
        if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.value) return
        closeSettings()
      }}
    >
      <SettingsSidebar
        activeSectionId={active?.id ?? ''}
        sections={sections}
        query={query}
        onQueryChange={setQuery}
        searchInputRef={searchInputRef}
        onBack={closeSettings}
        onSelectSection={selectSettingsSection}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className={cn('mx-auto flex w-full flex-col gap-10 px-8 pt-10 pb-24', isShortcuts ? 'max-w-5xl' : 'max-w-4xl')}>
          {!active ? (
            <div className="flex min-h-[24rem] items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/30 text-sm text-muted-foreground">
              No settings found for "{query.trim()}"
            </div>
          ) : (
            <SettingsSearchProvider value={{ query, showAll: showAll || isShortcuts }}>
              <SettingsSection id={active.id} title={active.title} description={active.description}>
                {renderPane(active.id, showAll ? '' : query)}
              </SettingsSection>
            </SettingsSearchProvider>
          )}
        </div>
      </div>
    </div>
  )
}
