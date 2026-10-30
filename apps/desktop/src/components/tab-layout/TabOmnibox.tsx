import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Globe, Search } from 'lucide-react'
import { createSession } from '@/daemon-connection'
import { openEditorTab } from '@/session-store'
import type { ChatAgentId } from '@acp-harness/protocol'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { useChatAgents, workspaceHostId } from '@/lib/chat-agents'
import { Input } from '@/components/ui/input'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import { cn } from '@/lib/utils'
import { looksLikeSearchQuery, normalizeAddress } from '@/stores/browser-tab-store'
import { groupOfTab, layoutFor, useTabLayout } from '@/stores/tab-layout-store'
import { TabKindIcon } from './TabKindIcon'
import { matchFiles, workspaceFiles } from './workspace-file-index'
import { activateTab, openBrowserTab, tabTitle, useWorkspaceTabs, type WorkspaceTab } from './workspace-tab-model'
import { t } from '@/i18n/i18n'

// Orca's new-tab omnibox (TabBarCreateEntry.tsx): one box that switches to an open tab, opens a
// file, opens a URL or search, or launches an agent.

const PLACEHOLDER = t('Search open tabs, files, URLs, agents…')

type Option =
  | { kind: 'tab'; tab: WorkspaceTab; title: string }
  | { kind: 'agent'; id: ChatAgentId; label: string }
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string; url: string }

function optionKey(option: Option): string {
  switch (option.kind) {
    case 'tab':
      return `tab:${option.tab.id}`
    case 'agent':
      return `agent:${option.id}`
    case 'file':
      return `file:${option.path}`
    case 'url':
      return `url:${option.url}`
    case 'search':
      return `search:${option.query}`
  }
}

function presentation(option: Option): { icon: React.ReactNode; label: string; detail: string } {
  switch (option.kind) {
    case 'tab':
      return { icon: <TabKindIcon tab={option.tab} className="shrink-0" />, label: t('Switch to tab'), detail: option.title }
    case 'agent':
      return { icon: <TuiAgentIcon agent={option.id} size={14} />, label: t('Launch agent'), detail: option.label }
    case 'file':
      return { icon: <FileText className="size-3.5 shrink-0" />, label: t('Open file'), detail: option.path }
    case 'url':
      return { icon: <Globe className="size-3.5 shrink-0" />, label: t('Open URL'), detail: option.url }
    case 'search':
      return { icon: <Search className="size-3.5 shrink-0" />, label: t('Search Google'), detail: option.query }
  }
}

export function TabOmnibox({
  workspaceId,
  query,
  onQueryChange,
  onDone
}: {
  workspaceId: string
  query: string
  onQueryChange: (query: string) => void
  /** Closes the menu after an option ran. */
  onDone: () => void
}) {
  const tabs = useWorkspaceTabs(workspaceId)
  const chatAgents = useChatAgents(workspaceHostId(workspaceId)).agents
  const meta = useTabLayout((s) => s.meta)
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Radix focuses the menu itself on open; take focus back once it has.
    const timer = setTimeout(() => input.current?.focus(), 0)
    let live = true
    void workspaceFiles(workspaceId).then((list) => live && setFiles(list))
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [workspaceId])

  const options = useMemo((): Option[] => {
    const q = query.trim()
    if (!q) return []
    const lower = q.toLowerCase()
    const result: Option[] = []
    for (const tab of tabs) {
      const title = tabTitle(tab, meta[tab.id])
      if (title.toLowerCase().includes(lower) && result.length < 3) result.push({ kind: 'tab', tab, title })
    }
    for (const agent of chatAgents) {
      if (agent.status !== 'ready') continue
      if (agent.id.startsWith(lower) || agent.label.toLowerCase().startsWith(lower)) {
        result.push({ kind: 'agent', id: agent.id, label: agent.label })
      }
    }
    for (const path of matchFiles(files, q, 5)) result.push({ kind: 'file', path })
    if (looksLikeSearchQuery(q)) result.push({ kind: 'search', query: q, url: normalizeAddress(q) })
    else result.push({ kind: 'url', url: normalizeAddress(q) })
    return result
  }, [query, tabs, meta, files, chatAgents])

  const active = Math.min(selected, Math.max(0, options.length - 1))

  const run = (option: Option | undefined) => {
    if (!option) return
    onDone()
    switch (option.kind) {
      case 'tab': {
        const group = groupOfTab(layoutFor(workspaceId), option.tab.id)
        if (group) activateTab(workspaceId, group.id, option.tab.id)
        break
      }
      case 'agent':
        void createSession(workspaceId, option.id)
        break
      case 'file':
        openEditorTab({ workspaceId, kind: 'file', path: option.path, staged: false })
        break
      case 'url':
        openBrowserTab(workspaceId, option.url)
        break
      case 'search':
        openBrowserTab(workspaceId, option.url)
        break
    }
  }

  return (
    <div
      className="pb-1"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Radix's typeahead would otherwise eat the letters typed here.
        if (e.key !== 'Escape') e.stopPropagation()
      }}
    >
      <div className="-mx-1 flex items-center px-3">
        <Input
          ref={input}
          data-tab-omnibox
          value={query}
          role="combobox"
          aria-expanded={options.length > 0}
          aria-label={PLACEHOLDER}
          placeholder={PLACEHOLDER}
          className="h-9 rounded-none border-0 bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 md:text-xs dark:bg-transparent"
          onChange={(e) => {
            onQueryChange(e.target.value)
            setSelected(0)
          }}
          onKeyDown={(e) => {
            if (isImeOwnedKeyboardEvent(e)) return
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length > 0) {
              e.preventDefault()
              const delta = e.key === 'ArrowDown' ? 1 : -1
              setSelected((active + delta + options.length) % options.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(options[active])
            }
          }}
        />
      </div>
      {options.length > 0 && (
        <div role="listbox" className="mt-1 space-y-0.5 px-1">
          {options.map((option, index) => {
            const { icon, label, detail } = presentation(option)
            return (
              <button
                key={optionKey(option)}
                type="button"
                role="option"
                data-omnibox-option={option.kind}
                aria-selected={index === active}
                className={cn(
                  'flex h-6 w-full items-center gap-1.5 rounded-[7px] px-1 text-left text-[11px] leading-5 outline-none',
                  index === active
                    ? 'bg-black/8 text-accent-foreground dark:bg-white/14'
                    : 'text-muted-foreground hover:bg-black/8 hover:text-accent-foreground dark:hover:bg-white/14'
                )}
                onMouseEnter={() => setSelected(index)}
                onClick={() => run(option)}
              >
                {icon}
                <span className="shrink-0 truncate font-medium">{label}</span>
                <span className="shrink-0 text-muted-foreground/70" aria-hidden>
                  ·
                </span>
                <span className="min-w-0 flex-1 truncate">{detail}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
