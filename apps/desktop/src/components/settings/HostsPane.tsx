import { RefreshCw } from 'lucide-react'
import { connectHost } from '@/daemon-connection'
import { LOCAL_HOST, useStore, type HostEntry } from '@/session-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DefaultShellRow } from './TerminalPane'
import { SettingsRow, SettingsSubsectionHeader } from './settings-form-controls'

/** Connection dot colours follow Orca's SshStatusSegment. */
export function hostDotClass(host: Pick<HostEntry, 'connection'>): string {
  switch (host.connection.kind) {
    case 'connected':
      return 'bg-status-success'
    case 'connecting':
      return 'bg-status-warning'
    case 'offline':
      return 'bg-destructive'
  }
}

export function hostConnectionLabel(host: Pick<HostEntry, 'connection'>): string {
  switch (host.connection.kind) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting…'
    case 'offline':
      return `Offline: ${host.connection.reason}`
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
          host.connection.kind === 'offline' ? (
            <Button variant="outline" size="xs" onClick={() => void connectHost(host.id)}>
              <RefreshCw />
              Reconnect
            </Button>
          ) : null
        }
      />
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
    </div>
  )
}
