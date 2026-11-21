import { RefreshCw } from 'lucide-react'
import type { ProviderUsageLimits, UsageLimitWindow } from '@acp-harness/protocol'
import type { HostId } from '@/session-store'
import { refreshUsageLimits, useUsageLimits } from '@/stores/usage-limits-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Meter, Section } from './panel-parts'
import { formatReset } from './usage-windows'
import { t } from '@/i18n/i18n'

// How much of the host's accounts' usage limits is spent, and when each window resets.

const PROVIDER_NAMES: Record<ProviderUsageLimits['provider'], string> = { claude: 'Claude', codex: 'Codex' }

export function windowLabel(window: UsageLimitWindow): string {
  if (window.id === 'session') return t('5-hour session')
  if (window.id === 'weekly') return t('Weekly · all models')
  if (window.id === 'weekly_scoped') return window.label ? t('Weekly · {model}', { model: window.label }) : t('Weekly · one model')
  return window.label ?? window.id
}

export function resetLabel(at: number, now = Date.now()): string {
  const text = formatReset(at, now)
  return at - now < 24 * 3_600_000 ? t('Resets in {time}', { time: text }) : t('Resets {time}', { time: text })
}

function planName(plan: string | null): string {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : ''
}

export function ProviderLimits({ provider, compact = false }: { provider: ProviderUsageLimits; compact?: boolean }) {
  return (
    <div className="space-y-1.5" data-usage-provider={provider.provider}>
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{PROVIDER_NAMES[provider.provider]}</span>
        {provider.plan && <span className="text-[11px] text-muted-foreground">{planName(provider.plan)}</span>}
      </div>
      {provider.status === 'unavailable' && (
        <p className="text-[11px] text-muted-foreground">
          {provider.provider === 'claude' ? t('No plan limits apply to this sign-in (an API key, Bedrock or Vertex).') : t('No limits to show.')}
        </p>
      )}
      {provider.status === 'error' && <p className="text-[11px] break-words text-status-warning">{provider.error ?? t('Could not read the limits.')}</p>}
      {provider.windows.map((window) => (
        <div key={`${window.id}:${window.label ?? ''}`} className="space-y-0.5">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate">{windowLabel(window)}</span>
            <span className={cn('shrink-0 tabular-nums', (window.usedPercent ?? 0) >= 80 && 'text-status-warning')}>
              {window.usedPercent === null ? '—' : `${Math.round(window.usedPercent)}%`}
            </span>
          </div>
          <Meter percent={window.usedPercent ?? 0} />
          {!compact && window.resetsAt !== null && <div className="text-[11px] text-muted-foreground">{resetLabel(window.resetsAt)}</div>}
        </div>
      ))}
    </div>
  )
}

export function UsageLimitsSection({ hostId, sessionId }: { hostId: HostId; sessionId?: string }) {
  const limits = useUsageLimits(hostId, sessionId)
  return (
    <Section
      title={t('Usage limits')}
      aside={
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t('Read the limits again')}
          title={t('Read the limits again')}
          disabled={limits.loading}
          onClick={() => void refreshUsageLimits(hostId, { refresh: true, ...(sessionId ? { sessionId } : {}) })}
        >
          <RefreshCw className={cn('size-3.5', limits.loading && 'animate-spin')} />
        </Button>
      }
    >
      <div className="space-y-3" data-session-usage-limits>
        {limits.providers.map((provider) => (
          <ProviderLimits key={provider.provider} provider={provider} />
        ))}
        {limits.providers.length === 0 && (
          <p className="text-muted-foreground">{limits.loading ? t('Reading the limits…') : (limits.error ?? t('No limits to show.'))}</p>
        )}
      </div>
    </Section>
  )
}
