import { describe, expect, test } from 'bun:test'
import type { RemoteRoute } from '@zomfy/protocol'
import { BACKOFF_CAP_MS, backoffDelay, firstLiveRoute, RouteChooser } from './routes'
import { FakeTimers } from './testing'

const routes: RemoteRoute[] = [
  { kind: 'lan', url: 'http://192.168.1.20:7802' },
  { kind: 'tailnet', url: 'http://100.64.0.2:7802' },
  { kind: 'relay', url: 'https://relay.example.com' }
]

function probeOf(live: Set<string>) {
  const calls: string[] = []
  const probe = async (route: RemoteRoute) => {
    calls.push(route.kind)
    return live.has(route.kind)
  }
  return { probe, calls }
}

describe('backoff', () => {
  test('doubles from 1 s and stays under the 5 minute cap', () => {
    expect(backoffDelay(0, () => 0.999)).toBeLessThanOrEqual(1000)
    expect(backoffDelay(0, () => 0)).toBe(500)
    expect(backoffDelay(3, () => 0)).toBe(4000)
    for (let attempt = 0; attempt < 60; attempt++) {
      expect(backoffDelay(attempt, () => 0.999999)).toBeLessThanOrEqual(BACKOFF_CAP_MS)
    }
    expect(backoffDelay(100, () => 0.999999)).toBeGreaterThan(BACKOFF_CAP_MS * 0.99)
  })

  test('is jittered', () => {
    expect(backoffDelay(5, () => 0.1)).not.toBe(backoffDelay(5, () => 0.9))
  })
})

describe('route chooser', () => {
  test('picks the first live route, in order', async () => {
    const { probe, calls } = probeOf(new Set(['tailnet', 'relay']))
    expect(await firstLiveRoute(routes, probe)).toBe(1)
    expect(calls).toEqual(['lan', 'tailnet'])
    expect(await firstLiveRoute(routes, probeOf(new Set()).probe)).toBeNull()
    expect(await firstLiveRoute(routes, async () => Promise.reject(new Error('x')))).toBeNull()
  })

  test('returns to the preferred route when it recovers', async () => {
    const live = new Set(['tailnet'])
    const { probe, calls } = probeOf(live)
    const timers = new FakeTimers()
    const recovered: number[] = []
    const chooser = new RouteChooser({ routes, probe, timers, random: () => 0, onPreferredRecovered: (i) => recovered.push(i) })

    const index = await chooser.pick()
    expect(index).toBe(1)
    chooser.use(index!)
    calls.length = 0

    // While the LAN is down, only the routes before the one in use are re-probed.
    await timers.advance(60_000)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((kind) => kind === 'lan')).toBe(true)
    expect(recovered).toEqual([])

    live.add('lan')
    await timers.advance(5 * 60_000)
    expect(recovered).toEqual([0])
    // It stops watching once it has said so; the owner reconnects and calls use() again.
    expect(timers.pending).toBe(0)
  })

  test('does not watch while on the preferred route or after release', async () => {
    const timers = new FakeTimers()
    const chooser = new RouteChooser({ routes, probe: async () => true, timers, onPreferredRecovered: () => {} })
    chooser.use(0)
    expect(timers.pending).toBe(0)
    chooser.use(2)
    expect(timers.pending).toBe(1)
    chooser.release()
    expect(timers.pending).toBe(0)
  })
})
