import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { connectHost } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import type { HostPill } from '@/lib/add-project-form'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// "Where" as a light inline choice (docs/specs/add-project-dialog.md): one pill per host with its
// connection state; a host that is not connected connects when picked.

const DOT: Record<HostPill['state'], string> = {
  connected: 'bg-emerald-500',
  connecting: 'animate-pulse bg-amber-500',
  offline: 'border border-muted-foreground/60 bg-transparent'
}

export function AddRepoHostRow({
  pills,
  hostId,
  disabled,
  onSelect,
  onConnectSsh
}: {
  pills: HostPill[]
  hostId: HostId
  disabled: boolean
  onSelect: (hostId: HostId) => void
  onConnectSsh: () => void
}) {
  const [connecting, setConnecting] = useState<HostId | null>(null)

  async function pick(pill: HostPill) {
    if (pill.state === 'connected') return onSelect(pill.id)
    setConnecting(pill.id)
    try {
      await connectHost(pill.id)
      onSelect(pill.id)
    } catch {
      // The host row shows it as not connected still; the sidebar's host says why.
    } finally {
      setConnecting(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t('Host')} data-add-repo-hosts>
      <span className="mr-0.5 text-xs font-medium text-muted-foreground">{t('Where')}</span>
      {pills.map((pill) => {
        const selected = pill.id === hostId
        const busy = connecting === pill.id || pill.state === 'connecting'
        const label = pill.label || t('This computer')
        return (
          <button
            key={pill.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || busy}
            onClick={() => void pick(pill)}
            title={pill.state === 'connected' ? label : pill.state === 'connecting' ? t('Connecting') : t('Not connected: click to connect')}
            className={cn(
              'inline-flex h-7 max-w-[14rem] min-w-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-60',
              selected ? 'border-ring bg-accent font-medium text-accent-foreground' : 'border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
            data-add-repo-host={pill.id}
            data-state={pill.state}
          >
            {busy ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <span className={cn('size-2 shrink-0 rounded-full', DOT[pill.state])} />}
            <span className="min-w-0 truncate">{label}</span>
          </button>
        )
      })}
      <button
        type="button"
        disabled={disabled}
        onClick={onConnectSsh}
        title={t('Connect SSH host…')}
        aria-label={t('Connect SSH host…')}
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        data-add-repo-host-ssh
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}
