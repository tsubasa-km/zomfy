import { useEffect, useRef, type ReactNode } from 'react'
import { Files, GitCompare, GitPullRequest, Globe, Search, SquarePen, SquareTerminal } from 'lucide-react'
import { createSession } from '@/daemon-connection'
import { allWorkspaces, useStore } from '@/session-store'
import { defaultChatAgent } from '@/lib/default-chat-agent'
import { focusGroup } from './tab-group-commands'
import { newTerminalTab, openBrowserTab, openPanelTab } from './workspace-tab-model'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// What a pane with no tabs offers, as T3 Code's "Open a surface": the things a pane can show, one
// row each, with the key that opens it while the pane has the focus. The + in the tab strip has the
// rest (other agents, shells, plugin panels).

interface Surface {
  id: string
  key: string
  label: string
  icon: ReactNode
  open: () => void
  /** Why it cannot open here, when it cannot (no git checkout to diff). */
  unavailable?: boolean
}

export function EmptyPane({ workspaceId, groupId, hint }: { workspaceId: string; groupId: string; hint: string }) {
  const root = useRef<HTMLDivElement>(null)
  // Changes and pull requests only exist for a git checkout.
  const git = useStore((s) => Boolean(allWorkspaces(s).find((w) => w.id === workspaceId)?.branch))
  // New tabs join the focused group, so this pane takes focus before one opens.
  const start = (open: () => void) => () => {
    focusGroup(workspaceId, groupId)
    open()
  }
  const surfaces: Surface[] = [
    { id: 'thread', key: 'N', label: t('New thread'), icon: <SquarePen className="size-4" />, open: start(() => void createSession(workspaceId, defaultChatAgent())) },
    { id: 'terminal', key: 'T', label: t('Terminal'), icon: <SquareTerminal className="size-4" />, open: start(() => void newTerminalTab(workspaceId)) },
    { id: 'browser', key: 'B', label: t('Browser'), icon: <Globe className="size-4" />, open: start(() => openBrowserTab(workspaceId)) },
    { id: 'explorer', key: 'F', label: t('Files'), icon: <Files className="size-4" />, open: start(() => openPanelTab(workspaceId, 'panel:explorer')) },
    { id: 'search', key: 'S', label: t('Search'), icon: <Search className="size-4" />, open: start(() => openPanelTab(workspaceId, 'panel:search')) },
    {
      id: 'source-control',
      key: 'D',
      label: t('Diff'),
      icon: <GitCompare className="size-4" />,
      open: start(() => openPanelTab(workspaceId, 'panel:source-control')),
      unavailable: !git
    },
    {
      id: 'checks',
      key: 'P',
      label: t('Pull request'),
      icon: <GitPullRequest className="size-4" />,
      open: start(() => openPanelTab(workspaceId, 'panel:checks')),
      unavailable: !git
    }
  ]

  // The keys work as soon as the pane shows, unless the person is typing somewhere else.
  useEffect(() => {
    const active = document.activeElement
    const scope = root.current?.closest('[data-workspace-tabs]')
    if (!active || active === document.body || (scope?.contains(active) && !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement))) {
      root.current?.focus({ preventScroll: true })
    }
  }, [])

  return (
    // Scrolls in a short pane rather than spilling out of it.
    <div
      ref={root}
      tabIndex={0}
      data-empty-pane
      className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
        const surface = surfaces.find((s) => s.key.toLowerCase() === e.key.toLowerCase())
        if (!surface || surface.unavailable) return
        e.preventDefault()
        surface.open()
      }}
    >
      <div className="m-auto flex w-full max-w-xs flex-col gap-2 p-4">
        <p className="pb-1 text-center text-sm font-medium text-foreground" title={hint}>
          {t('Open a surface')}
        </p>
        <div className="flex flex-col">
          {surfaces.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={s.unavailable}
              data-empty-pane-start={s.id}
              onClick={s.open}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors',
                s.unavailable ? 'cursor-default text-muted-foreground/50' : 'text-foreground hover:bg-accent'
              )}
            >
              <span className={cn('flex size-4 shrink-0 items-center justify-center', s.unavailable ? 'opacity-50' : 'text-muted-foreground')}>{s.icon}</span>
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <kbd
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded border border-border bg-muted text-[10px] font-medium',
                  s.unavailable ? 'text-muted-foreground/40' : 'text-muted-foreground'
                )}
              >
                {s.key}
              </kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
