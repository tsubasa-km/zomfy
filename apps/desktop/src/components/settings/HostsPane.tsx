import { RefreshCw, Unplug } from 'lucide-react'
import { connectHost, disconnectHost } from '@/daemon-connection'
import { LOCAL_HOST, useStore, type HostEntry } from '@/session-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SshHostPicker } from '@/components/ssh/SshHostPicker'
import { DefaultShellRow } from './TerminalPane'
import { SettingsRow, SettingsSubsectionHeader } from './settings-form-controls'

/** Connection dot colours follow Orca's SshStatusSegment; an unverifiable daemon is not shown as dead. */
export function hostDotClass(host: Pick<HostEntry, 'connection'>): string {
  switch (host.connection.kind) {
    case 'connected':
      return 'bg-status-success'
    case 'connecting':
      return 'bg-status-warning'
    case 'offline':
      return host.connection.daemon === 'unverifiable'
        ? 'bg-muted-foreground'
        : host.connection.daemon === 'live'
          ? 'bg-status-warning'
          : 'bg-destructive'
  }
}

export function hostConnectionLabel(host: Pick<HostEntry, 'connection'>): string {
  const c = host.connection
  switch (c.kind) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting…'
    case 'offline':
      switch (c.daemon) {
        case 'unverifiable':
          return `Unreachable, daemon state unverifiable: ${c.reason}`
        case 'live':
          return `Daemon live but not reachable from here: ${c.reason}`
        case 'exited':
          return `Daemon exited: ${c.reason}`
        default:
          return `Offline: ${c.reason}`
      }
  }
}

export function sortedHosts(hosts: Record<string, HostEntry>): HostEntry[] {
  return Object.values(hosts).sort((a, b) =>
    a.id === LOCAL_HOST ? -1 : b.id === LOCAL_HOST ? 1 : a.label.localeCompare(b.label)
  )
}

function HostCard({ host }: { host: HostEntry }) {
  const platform = host.harness?.host.platform
  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-background/40 px-4 py-3" data-host-card={host.id}>
      <SettingsSubsectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className={cn('inline-block size-2 rounded-full', hostDotClass(host))} />
            {host.label}
            {platform ? <span className="text-xs font-normal text-muted-foreground">{platform}</span> : null}
          </span>
        }
        description={hostConnectionLabel(host)}
        action={
          <span className="inline-flex gap-1.5">
            {host.connection.kind === 'offline' ? (
              <Button variant="outline" size="xs" onClick={() => void connectHost(host.id)}>
                <RefreshCw />
                Reconnect
              </Button>
            ) : null}
            {host.id !== LOCAL_HOST ? (
              <Button variant="outline" size="xs" onClick={() => disconnectHost(host.id)}>
                <Unplug />
                Disconnect
              </Button>
            ) : null}
          </span>
        }
      />
      {host.notice ? <p className="text-xs text-muted-foreground">{host.notice}</p> : null}
      <div className="divide-y divide-border/40">
        <SettingsRow
          label="Connection"
          keywords={['daemon', 'wsl', 'remote', 'connected', 'offline']}
          control={
            <span className="text-xs text-muted-foreground">
              {host.connection.kind === 'connected' ? host.connection.url : host.connection.kind}
            </span>
          }
        />
        {host.connection.kind === 'connected' ? <DefaultShellRow hostId={host.id} /> : null}
      </div>
    </div>
  )
}

export function HostsPane() {
  const hosts = useStore((s) => s.hosts)
  const list = sortedHosts(hosts)
  return (
    <div className="space-y-3">
      {list.length === 0 ? <p className="text-sm text-muted-foreground">No hosts yet.</p> : null}
      {list.map((host) => (
        <HostCard key={host.id} host={host} />
      ))}
      <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 px-4 py-3" data-ssh-connect>
        <SettingsSubsectionHeader title="Connect SSH host" description="Runs a daemon on the host and reaches it through an SSH tunnel." />
        <SshHostPicker />
      </div>
    </div>
  )
}
