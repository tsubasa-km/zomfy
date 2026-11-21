import type { ProviderUsageLimits } from '@acp-harness/protocol'

// Pure helpers for the usage-limit readouts (the Session panel, the status bar meter).

/** `in 2h 10m` within a day; a weekday and time past that. */
export function formatReset(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((at - now) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** The window nearest its limit, for a one-glance meter. */
export function busiestWindow(providers: ProviderUsageLimits[]): { provider: ProviderUsageLimits; window: ProviderUsageLimits['windows'][number] } | null {
  let best: ReturnType<typeof busiestWindow> = null
  for (const provider of providers) {
    for (const window of provider.windows) {
      if (window.usedPercent === null) continue
      if (!best || window.usedPercent > (best.window.usedPercent ?? 0)) best = { provider, window }
    }
  }
  return best
}
