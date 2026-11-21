import { Gauge } from 'lucide-react'
import { LOCAL_HOST, findWorkspace, useStore } from '@/session-store'
import { requestDrawer } from '@/stores/drawer-request-store'
import { useUsageLimits } from '@/stores/usage-limits-store'
import { busiestWindow } from './usage-windows'
import { Segment } from '@/components/status-bar/status-bar-segments'
import { registerStatusBarItem } from '@/components/status-bar/status-bar-registry'
import { cn } from '@/lib/utils'
import { resetLabel, windowLabel } from './UsageLimitsSection'
import { t } from '@/i18n/i18n'

// The status bar's usage meter: the front workspace's host's Claude 5-hour and weekly use at a
// glance; the tooltip has every window, a click opens the Session panel.

function UsageLimitsSegment() {
  const workspaceId = useStore((s) => (s.dashboardOpen ? null : s.activeWorkspaceId))
  useStore((s) => s.hosts)
  const hostId = (workspaceId ? findWorkspace(workspaceId)?.hostId : null) ?? LOCAL_HOST
  const { providers } = useUsageLimits(hostId)
  const shown = providers.filter((p) => p.status === 'ok' && p.windows.length > 0)
  const top = busiestWindow(shown)
  if (!top) return null
  const claude = shown.find((p) => p.provider === 'claude') ?? shown[0]!
  const session = claude.windows.find((w) => w.id === 'session')
  const weekly = claude.windows.find((w) => w.id === 'weekly')
  const peak = top.window.usedPercent ?? 0
  const percent = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${Math.round(value)}%`)
  return (
    <Segment
      label={t('Usage limits')}
      tooltip={
        <div className="space-y-0.5">
          {shown.flatMap((provider) =>
            provider.windows.map((window) => (
              <div key={`${provider.provider}:${window.id}:${window.label ?? ''}`}>
                {provider.provider === 'claude' ? 'Claude' : 'Codex'} · {windowLabel(window)}: {percent(window.usedPercent)}
                {window.resetsAt !== null ? ` · ${resetLabel(window.resetsAt)}` : ''}
              </div>
            ))
          )}
        </div>
      }
      onClick={() => workspaceId && requestDrawer(workspaceId, 'panel:agent', 'show')}
      className={cn(peak >= 95 ? 'text-destructive' : peak >= 80 && 'text-status-warning')}
    >
      <Gauge className="size-3" />
      <span className="tabular-nums" data-status-usage-limits>
        {session || weekly ? `${t('5h')} ${percent(session?.usedPercent)} · ${t('Week')} ${percent(weekly?.usedPercent)}` : percent(peak)}
      </span>
    </Segment>
  )
}

registerStatusBarItem({ id: 'usage-limits', label: t('Usage limits'), side: 'right', order: 60, render: () => <UsageLimitsSegment /> })
