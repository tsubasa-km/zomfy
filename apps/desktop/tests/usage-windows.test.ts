import { describe, expect, test } from 'bun:test'
import type { ProviderUsageLimits } from '@acp-harness/protocol'
import { busiestWindow, formatReset } from '../src/components/right-sidebar/session-panel/usage-windows'

const provider = (name: ProviderUsageLimits['provider'], percents: (number | null)[]): ProviderUsageLimits => ({
  provider: name,
  plan: null,
  status: 'ok',
  updatedAt: 0,
  windows: percents.map((usedPercent, i) => ({ id: i === 0 ? 'session' : 'weekly', usedPercent, resetsAt: null }))
})

describe('formatReset', () => {
  const now = Date.parse('2026-11-21T10:00:00Z')
  test('minutes, then hours and minutes, within a day', () => {
    expect(formatReset(now + 5 * 60_000, now)).toBe('5m')
    expect(formatReset(now + (2 * 60 + 10) * 60_000, now)).toBe('2h 10m')
    expect(formatReset(now - 60_000, now)).toBe('0m')
  })
  test('a date past a day', () => {
    expect(formatReset(now + 3 * 86_400_000, now)).not.toMatch(/^\d+h/)
  })
})

describe('busiestWindow', () => {
  test('the window nearest its limit across providers', () => {
    const claude = provider('claude', [53, 87])
    const codex = provider('codex', [90, null])
    expect(busiestWindow([claude, codex])).toEqual({ provider: codex, window: codex.windows[0]! })
  })
  test('none without a percentage', () => {
    expect(busiestWindow([provider('claude', [null])])).toBeNull()
    expect(busiestWindow([])).toBeNull()
  })
})
