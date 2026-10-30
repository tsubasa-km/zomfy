import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Server } from 'lucide-react'
import { HARNESS_METHODS, type ListeningPort, type PortScanResult } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allWorkspaces, useStore } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PortSection } from './port-row'
import { t } from '@/i18n/i18n'

// Orca's LocalWorkspacePortsPanel: the daemon host's listeners in Active Workspace, Other
// Workspaces and External sections, rescanned on an interval while the panel is open.

const POLL_MS = 10_000

export function PortsPanel({ workspaceId }: { workspaceId: string }) {
  const [scan, setScan] = useState<PortScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ other: true, external: true })
  const inFlight = useRef(false)
  // Joined to a string so the selector returns a stable value.
  const names = useStore((s) => JSON.stringify(allWorkspaces(s).map((w) => [w.id, w.displayName || w.name])))
  const workspaceNames = useMemo(() => new Map<string, string>(JSON.parse(names)), [names])

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)
    try {
      setScan(await harnessRequest(HARNESS_METHODS.portsList, { workspaceId }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      setRefreshing(false)
    }
  }, [workspaceId])

  useEffect(() => {
    setScan(null)
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  async function stop(port: ListeningPort) {
    if (port.pid === null) return
    try {
      await harnessRequest(HARNESS_METHODS.portsKill, { workspaceId, pid: port.pid, port: port.port })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    await refresh()
  }

  const ports = scan?.ports ?? []
  const active = ports.filter((p) => p.workspaceId === workspaceId)
  const other = ports.filter((p) => p.workspaceId !== null && p.workspaceId !== workspaceId)
  const external = ports.filter((p) => p.workspaceId === null)
  const ownerName = (port: ListeningPort) =>
    port.workspaceId ? (workspaceNames.get(port.workspaceId) ?? t('Workspace')) : t('Unassigned')
  const sectionProps = (id: string) => ({
    collapsed: collapsed[id] ?? false,
    onToggle: () => setCollapsed((c) => ({ ...c, [id]: !c[id] })),
    ownerName,
    onStop: (port: ListeningPort) => void stop(port)
  })

  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto" data-ports-panel="">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t('Ports')}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('Refresh Ports')}
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {t('Refresh Ports')}
          </TooltipContent>
        </Tooltip>
      </div>
      {(error || scan?.unavailableReason) && (
        <div role="alert" className="border-b border-border px-3 py-2 text-xs break-words text-muted-foreground">
          {error ?? t('Port scan unavailable on {platform}: {reason}', { platform: scan?.platform, reason: scan?.unavailableReason })}
        </div>
      )}
      {!scan?.unavailableReason && (
        <>
          <PortSection
            id="active"
            title={t('Active Workspace')}
            ports={active}
            emptyText={scan ? t('No ports detected') : t('Scanning...')}
            {...sectionProps('active')}
          />
          <PortSection id="other" title={t('Other Workspaces')} ports={other} {...sectionProps('other')} />
          <PortSection id="external" title={t('External')} ports={external} {...sectionProps('external')} />
        </>
      )}
      {scan && !scan.unavailableReason && ports.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center text-muted-foreground">
          <Server size={32} className="mb-3 opacity-50" />
          <p className="text-sm">{t('No local ports detected')}</p>
        </div>
      )}
    </div>
  )
}
