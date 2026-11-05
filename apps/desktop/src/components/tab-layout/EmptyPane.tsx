import type { ReactNode } from 'react'
import { Files, GitCompare, Globe, SquareTerminal } from 'lucide-react'
import { createSession } from '@/daemon-connection'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { focusGroup } from './tab-group-commands'
import { newTerminalTab, openBrowserTab, openPanelTab } from './workspace-tab-model'
import { t } from '@/i18n/i18n'

// What a pane with no tabs offers in its middle: the usual first tabs, one click each. The + in the
// tab strip has the rest (other agents, shells, panels).

function StartButton({ icon, label, onClick, kind }: { icon: ReactNode; label: string; onClick: () => void; kind: string }) {
  return (
    <button
      type="button"
      data-empty-pane-start={kind}
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm whitespace-nowrap text-foreground transition-colors hover:bg-accent"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      {label}
    </button>
  )
}

export function EmptyPane({ workspaceId, groupId, hint }: { workspaceId: string; groupId: string; hint: string }) {
  // New tabs join the focused group, so this pane takes focus before one opens.
  const start = (open: () => void) => () => {
    focusGroup(workspaceId, groupId)
    open()
  }
  return (
    // Scrolls in a short pane rather than spilling out of it.
    <div data-empty-pane className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="m-auto flex w-full max-w-md flex-col items-center gap-3 p-4 text-center">
        <p className="text-sm text-muted-foreground">{hint}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <StartButton
            kind="claude"
            icon={<TuiAgentIcon agent="claude" size={14} />}
            label={t('Claude chat')}
            onClick={start(() => void createSession(workspaceId))}
          />
          <StartButton kind="terminal" icon={<SquareTerminal className="size-4" />} label={t('Terminal')} onClick={start(() => void newTerminalTab(workspaceId))} />
          <StartButton kind="browser" icon={<Globe className="size-4" />} label={t('Browser')} onClick={start(() => openBrowserTab(workspaceId))} />
          <StartButton
            kind="explorer"
            icon={<Files className="size-4" />}
            label={t('Explorer')}
            onClick={start(() => openPanelTab(workspaceId, 'panel:explorer'))}
          />
          <StartButton
            kind="source-control"
            icon={<GitCompare className="size-4" />}
            label={t('Source Control')}
            onClick={start(() => openPanelTab(workspaceId, 'panel:source-control'))}
          />
        </div>
      </div>
    </div>
  )
}
