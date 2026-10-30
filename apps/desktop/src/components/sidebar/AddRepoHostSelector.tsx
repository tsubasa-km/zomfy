import { useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react'
import { connectHost } from '@/daemon-connection'
import { LOCAL_HOST, useStore, type HostEntry, type HostId } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Orca's AddRepoHostSelector: which machine the project goes on. Hosts that are not connected
// offer Connect; WSL distros the app has not started yet are listed too.

interface HostRow {
  id: HostId
  label: string
  detail: string
  state: 'connected' | 'connecting' | 'offline'
}

function hostRows(hosts: Record<HostId, HostEntry>, distros: string[]): HostRow[] {
  const rows: HostRow[] = Object.values(hosts)
    .sort((a, b) => (a.id === LOCAL_HOST ? -1 : b.id === LOCAL_HOST ? 1 : a.label.localeCompare(b.label)))
    .map((h) => ({
      id: h.id,
      label: h.label,
      detail: h.id === LOCAL_HOST ? t('This computer') : h.id.startsWith('wsl:') ? t('WSL distro') : t('SSH host'),
      state: h.connection.kind
    }))
  for (const distro of distros) {
    if (!hosts[`wsl:${distro}`]) rows.push({ id: `wsl:${distro}`, label: `WSL: ${distro}`, detail: t('WSL distro'), state: 'offline' })
  }
  return rows
}

const STATE_LABEL: Record<HostRow['state'], string> = { connected: t('Connected'), connecting: t('Connecting'), offline: t('Not connected') }

export function AddRepoHostSelector({
  hostId,
  onSelect,
  onConnectSsh
}: {
  hostId: HostId
  onSelect: (hostId: HostId) => void
  onConnectSsh: () => void
}) {
  const hosts = useStore((s) => s.hosts)
  const [open, setOpen] = useState(false)
  const [distros, setDistros] = useState<string[] | null>(null)
  const rows = hostRows(hosts, distros ?? [])
  const selected = rows.find((r) => r.id === hostId) ?? rows[0]

  return (
    <div className="flex items-center gap-2 text-xs" data-add-repo-host>
      <span className="font-medium text-muted-foreground">{t('Host')}</span>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (o && distros === null && isTauri()) void invoke<string[]>('wsl_distros').then(setDistros, () => setDistros([]))
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className="h-7 max-w-[18rem] min-w-0 gap-1.5 rounded-md border border-border bg-muted/30 px-2 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <span className="min-w-0 truncate">{selected?.label ?? t('This computer')}</span>
            {selected && selected.state !== 'connected' ? (
              <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{STATE_LABEL[selected.state]}</span>
            ) : null}
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(340px,calc(100vw-1rem))] min-w-[var(--radix-popover-trigger-width)] p-0">
          <Command>
            <CommandList>
              <CommandItem
                value="Connect SSH host"
                onSelect={() => {
                  setOpen(false)
                  onConnectSsh()
                }}
                className="items-start gap-2 px-3 py-2 text-xs text-muted-foreground"
                data-add-repo-host-ssh
              >
                <Plus className="mt-0.5 size-3 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t('Connect SSH host…')}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{t('Use an existing machine over SSH.')}</span>
                </span>
              </CommandItem>
              {rows.map((row) => (
                <CommandItem
                  key={row.id}
                  value={`${row.label} ${row.id}`}
                  disabled={row.state !== 'connected' && row.state !== 'offline'}
                  onSelect={() => {
                    if (row.state !== 'connected') return
                    onSelect(row.id)
                    setOpen(false)
                  }}
                  className={cn('items-start gap-2 px-3 py-2 text-xs', row.state === 'connecting' && 'opacity-55')}
                  data-add-repo-host-option={row.id}
                >
                  <Check className={cn('mt-0.5 size-3 text-muted-foreground', row.id === hostId ? 'opacity-70' : 'opacity-0')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{row.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {row.detail} - {STATE_LABEL[row.state]}
                    </span>
                  </span>
                  {row.state !== 'connected' ? (
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      className="ml-2 h-auto shrink-0 gap-1 self-center px-0 py-0 text-[11px] font-normal text-muted-foreground hover:text-foreground hover:no-underline"
                      disabled={row.state === 'connecting'}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void connectHost(row.id).then(() => onSelect(row.id), () => undefined)
                      }}
                    >
                      {row.state === 'connecting' ? <Loader2 className="size-3 animate-spin" /> : null}
                      {row.state === 'connecting' ? t('Connecting') : t('Connect')}
                    </Button>
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
