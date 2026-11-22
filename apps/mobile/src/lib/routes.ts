// Ordered routes, after T3 Code's connection driver (MIT): a host has a list of routes (LAN,
// tailnet, then the relay) in order of preference. The phone uses the first that answers, keeps
// re-probing the earlier ones while it sits on a later one, and moves back when one recovers.
// Retries wait a jittered, doubling delay capped at 5 minutes.

import type { RemoteRoute } from '@zomfy/protocol'

export const BACKOFF_BASE_MS = 1000
export const BACKOFF_CAP_MS = 5 * 60_000

/**
 * The wait before retry number `attempt` (0-based): 1 s, 2 s, 4 s … capped at 5 minutes, scaled by
 * a random factor in [0.5, 1) so many phones do not retry in step.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, Math.min(attempt, 30)))
  return Math.round(exponential * (0.5 + random() * 0.5))
}

export interface Timers {
  now(): number
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

/** Whether a route answers as the expected host. */
export type RouteProbe = (route: RemoteRoute) => Promise<boolean>

/** The index of the first route among `routes[0..end)` that answers, tried in order; null if none. */
export async function firstLiveRoute(routes: readonly RemoteRoute[], probe: RouteProbe, end = routes.length): Promise<number | null> {
  for (let i = 0; i < Math.min(end, routes.length); i++) {
    if (await probe(routes[i]!).catch(() => false)) return i
  }
  return null
}

export interface RouteChooserOptions {
  routes: readonly RemoteRoute[]
  probe: RouteProbe
  timers?: Timers
  random?: () => number
  /** Called when a route earlier than the one in use answers again. */
  onPreferredRecovered: (index: number) => void
}

/** Picks a route and, while a worse one is in use, watches the better ones. */
export class RouteChooser {
  private readonly timers: Timers
  private readonly random: () => number
  private watchTimer: unknown = null
  private watchAttempt = 0
  private inUse: number | null = null
  private stopped = false

  constructor(private readonly options: RouteChooserOptions) {
    this.timers = options.timers ?? realTimers
    this.random = options.random ?? Math.random
  }

  get routes(): readonly RemoteRoute[] {
    return this.options.routes
  }

  /** The first route that answers, or null when none does. */
  pick(): Promise<number | null> {
    return firstLiveRoute(this.options.routes, this.options.probe)
  }

  /** The connection now runs on route `index`; earlier routes are re-probed until one answers. */
  use(index: number): void {
    this.inUse = index
    this.watchAttempt = 0
    this.scheduleWatch()
  }

  /** The connection dropped: stop watching until the next `use`. */
  release(): void {
    this.inUse = null
    this.clearWatch()
  }

  stop(): void {
    this.stopped = true
    this.release()
  }

  /**
   * Re-probe the better routes now rather than at the next timer (the app came to the front, or
   * the network changed: T3 Code's wakeups reset the backoff the same way).
   */
  probeNow(): void {
    if (this.stopped || this.inUse === null || this.inUse === 0) return
    this.clearWatch()
    this.watchAttempt = 0
    void this.watch()
  }

  private clearWatch(): void {
    if (this.watchTimer !== null) this.timers.clearTimeout(this.watchTimer)
    this.watchTimer = null
  }

  private scheduleWatch(): void {
    this.clearWatch()
    if (this.stopped || this.inUse === null || this.inUse === 0) return
    // Re-probing starts a few seconds in, so a route that flaps is not taken back at once.
    const delay = Math.max(5000, backoffDelay(this.watchAttempt + 2, this.random))
    this.watchTimer = this.timers.setTimeout(() => void this.watch(), delay)
  }

  private async watch(): Promise<void> {
    this.watchTimer = null
    const current = this.inUse
    if (this.stopped || current === null) return
    const better = await firstLiveRoute(this.options.routes, this.options.probe, current)
    if (this.stopped || this.inUse !== current) return
    if (better !== null) {
      this.inUse = null
      this.options.onPreferredRecovered(better)
      return
    }
    this.watchAttempt++
    this.scheduleWatch()
  }
}
