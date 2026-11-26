import { describe, expect, test } from 'bun:test'
import { createTranslator } from './i18n'
import { phaseText, phaseValue } from './turn-phase'

const NOW = 1_000_000_000_000
const base = { createdAt: NOW - 10_000, lastActivityAt: NOW - 1000 }

describe('phaseText', () => {
  const ja = createTranslator('ja')
  const en = createTranslator('en')

  test('says whose turn it is in the desktop’s words', () => {
    expect(phaseText({ ...base, status: 'needs-you' }, ja, NOW)).toBe('回答待ち')
    expect(phaseText({ ...base, status: 'working', yourTurnSince: null }, ja, NOW)).toBe('作業中')
    expect(phaseText({ ...base, status: 'idle', yourTurnSince: NOW - 1000 }, en, NOW)).toBe('Your turn')
    expect(phaseText({ ...base, status: 'idle', yourTurnSince: NOW - 1000, background: { tasks: ['build'], wakeUps: [] } }, ja, NOW)).toBe(
      'バックグラウンドで作業中'
    )
  })

  test('a row shows only a wake-up time beside its mark', () => {
    const wake = { tasks: [], wakeUps: [{ id: 'w', at: NOW + 3_600_000, recurring: false, prompt: 'check' }] }
    expect(phaseValue({ ...base, status: 'idle', background: wake }, NOW)).toMatch(/\d/)
    expect(phaseValue({ ...base, status: 'idle', background: { tasks: ['build'], wakeUps: [] } }, NOW)).toBeNull()
    expect(phaseValue({ ...base, status: 'idle', yourTurnSince: NOW - 1000 }, NOW)).toBeNull()
  })

  test('a quiet thread says nothing', () => {
    expect(phaseText({ ...base, status: 'idle', yourTurnSince: null }, en, NOW)).toBeNull()
  })
})
