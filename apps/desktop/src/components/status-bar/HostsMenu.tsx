import { useState } from 'react'
import { LoaderCircle, RotateCw, Server, Settings2, TriangleAlert, Unplug } from 'lucide-react'
import { connectHost, disconnectHost } from '@/daemon-connection'
import { LOCAL_HOST, useStore, type HostEntry } from '@/session-store'
import { openSettings } from '@/stores/app-overlay-store'
import { claudeCliWarning, updateClaudeCliOn, useClaudeCliStatus, useClaudeCliUpdating } from '@/stores/claude-cli-store'
import { hostConnectionLabel, hostDotClass, sortedHosts } from '@/components/settings/HostsPane'
import { SshConnectDialog } from '@/components/sidebar/SshConnectDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The machines Zomfy runs on, as status bar items: the sidebar lists projects, not hosts, so
// connecting, reconnecting and a host's warnings (an old Claude Code) live here.

export function HostsMenu() {
  const hosts = useStore((s) => s.hosts)
  const [sshOpen, setSshOpen] = useState(false)
  const list = sortedHosts(hosts)
  if (list.length === 0) return null
  return (
    <>
      {list.map((host) => (
        <HostItem key={host.id} host={host} onConnectSsh={() => setSshOpen(true)} />
      ))}
      <SshConnectDialog open={sshOpen} onClose={() => setSshOpen(false)} />
    </>
  )
}

function HostItem({ host, onConnectSsh }: { host: HostEntry; onConnectSsh: () => void }) {
  const cli = useClaudeCliStatus(host.id)
  const updating = useClaudeCliUpdating(host.id)
  const kind = host.connection.kind
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${host.label}: ${hostConnectionLabel(host)}`}
          data-status-host={host.id}
          className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
        >
          <span className={cn('inline-block size-2 rounded-full', hostDotClass(host), kind === 'connecting' && 'animate-pulse')} />
          <span className="max-w-40 truncate">{host.label}</span>
          {cli?.outdated && <TriangleAlert className="size-3 text-amber-500" aria-label={t('Claude Code is out of date')} data-claude-cli-outdated />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuLabel className="space-y-0.5">
          <div className="text-xs font-medium text-foreground">{host.label}</div>
          <div className="text-[11px] font-normal break-words text-muted-foreground">{hostConnectionLabel(host)}</div>
          {host.notice && <div className="text-[11px] font-normal break-words text-muted-foreground">{host.notice}</div>}
        </DropdownMenuLabel>
        {cli?.outdated && (
          <DropdownMenuItem disabled={updating} onSelect={() => void updateClaudeCliOn(host.id)} title={claudeCliWarning(cli)}>
            {updating ? <LoaderCircle className="size-3.5 animate-spin" /> : <TriangleAlert className="size-3.5 text-amber-500" />}
            {updating ? t('Updating Claude Code…') : t('Update Claude Code ({version} → {expected}+)', { version: cli.version, expected: cli.expected })}
          </DropdownMenuItem>
        )}
        {kind === 'offline' && (
          <DropdownMenuItem onSelect={() => void connectHost(host.id)}>
            <RotateCw className="size-3.5" />
            {t('Reconnect')}
          </DropdownMenuItem>
        )}
        {host.id !== LOCAL_HOST && kind !== 'offline' && (
          <DropdownMenuItem onSelect={() => disconnectHost(host.id)}>
            <Unplug className="size-3.5" />
            {t('Disconnect')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onConnectSsh}>
          <Server className="size-3.5" />
          {t('Connect SSH host…')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openSettings('hosts')}>
          <Settings2 className="size-3.5" />
          {t('Host settings…')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
