import { invoke } from '@tauri-apps/api/core'
import { ChevronRight, Copy, ExternalLink, Server, Trash2 } from 'lucide-react'
import type { ListeningPort } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { copyText } from './explorer-paths'
import { t } from '@/i18n/i18n'

// Orca's local-port-section and local-port-row: a collapsible section per owner group; each row
// shows :port, process, address and owner, with open / copy / stop on hover and in its menu.

/** Orca's addressForPort: what a browser can open (IPv6 literals bracketed). */
export function addressForPort(port: ListeningPort): string {
  const host = port.connectHost.includes(':') ? `[${port.connectHost}]` : port.connectHost
  return `${host}:${port.port}`
}

export function openPortInBrowser(port: ListeningPort): void {
  const url = `${port.port === 443 || port.port === 8443 ? 'https' : 'http'}://${addressForPort(port)}`
  if ('__TAURI_INTERNALS__' in window) {
    // The OS opener (explorer / open / xdg-open) hands a URL to the default browser; WSL2
    // forwards localhost, so a distro's ports open from Windows too.
    void invoke('open_workspace_in', { target: 'explorer', host: 'local', path: url }).catch((e: unknown) => window.alert(String(e)))
  } else {
    window.open(url, '_blank', 'noopener')
  }
}

export function PortSection({
  id,
  title,
  ports,
  emptyText,
  collapsed,
  onToggle,
  ownerName,
  onStop
}: {
  id: string
  title: string
  ports: ListeningPort[]
  emptyText?: string
  collapsed: boolean
  onToggle: () => void
  ownerName: (port: ListeningPort) => string
  onStop: (port: ListeningPort) => void
}) {
  if (ports.length === 0 && !emptyText) return null
  return (
    <div className="px-3 pt-2" data-port-section={id}>
      <button
        type="button"
        className="sticky top-0 z-10 mb-1 flex w-full items-center gap-1 border-b border-border/40 bg-sidebar py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <ChevronRight size={12} className={cn('shrink-0 transition-transform', !collapsed && 'rotate-90')} />
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</span>
        {ports.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground/60">{ports.length}</span>}
      </button>
      {!collapsed &&
        (ports.length > 0 ? (
          ports.map((port) => <PortRow key={port.id} port={port} owner={ownerName(port)} onStop={onStop} />)
        ) : (
          <div className="py-1 text-xs text-muted-foreground">{emptyText}</div>
        ))}
    </div>
  )
}

function PortRow({ port, owner, onStop }: { port: ListeningPort; owner: string; onStop: (port: ListeningPort) => void }) {
  const address = addressForPort(port)
  const processLabel = port.processName ?? (port.pid ? `PID ${port.pid}` : t('Unknown process'))
  const canStop = port.workspaceId !== null && port.pid !== null
  return (
    <ContextMenu>
      <div data-port={port.port} className="group -mx-1 flex items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-accent/50">
        <ContextMenuTrigger asChild>
          <div
            tabIndex={0}
            aria-label={t('Port {port} menu', { port: port.port })}
            className="flex min-w-0 flex-1 items-center gap-2 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <div className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
              <Server size={13} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="text-xs font-medium text-foreground">:{port.port}</span>
                <span className="truncate text-xs text-muted-foreground">{processLabel}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="truncate">{address}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
                <span className="truncate">{owner}</span>
                {port.attribution && <span className="shrink-0">{port.attribution}</span>}
                {port.pid !== null && <span className="shrink-0">PID {port.pid}</span>}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <RowButton label={t('Open in Browser')} onClick={() => openPortInBrowser(port)}>
            <ExternalLink size={13} />
          </RowButton>
          <RowButton label={t('Copy {address}', { address })} onClick={() => copyText(address)}>
            <Copy size={13} />
          </RowButton>
          {canStop && (
            <RowButton label={t('Stop Process')} destructive onClick={() => onStop(port)}>
              <Trash2 size={13} />
            </RowButton>
          )}
        </div>
      </div>
      <ContextMenuContent>
        <ContextMenuLabel className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">{`:${port.port}`}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => openPortInBrowser(port)}>
          <ExternalLink size={13} />
          {t('Open in Browser')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(address)}>
          <Copy size={13} />
          {t('Copy Address')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(JSON.stringify(port, null, 2))}>
          <Copy size={13} />
          {t('Copy Details')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={!canStop} onSelect={() => onStop(port)}>
          <Trash2 size={13} />
          {t('Stop Process')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function RowButton({
  label,
  destructive,
  onClick,
  children
}: {
  label: string
  destructive?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className={cn('text-muted-foreground', destructive ? 'hover:text-destructive' : 'hover:text-foreground')}
          onClick={(event) => {
            onClick()
            if (event.detail > 0) event.currentTarget.blur()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
