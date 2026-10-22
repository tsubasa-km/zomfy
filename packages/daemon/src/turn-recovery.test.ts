import { describe, expect, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { detectUsageLimit, parseResetTime } from './usage-limit.ts'
import { MAX_AUTO_RESUME_ATTEMPTS, TurnAutoResume, nextAutoResume } from './turn-auto-resume.ts'
import { CONTINUE_PROMPT, recoveryPrompt } from './turn-recovery.ts'
import type { SessionRecord, SessionRegistry } from './session-registry.ts'

// 2026-10-22 10:00 local time.
const NOW = new Date(2026, 9, 22, 10, 0, 0).getTime()

describe('detectUsageLimit', () => {
  test('the SDK rate_limit_event reset wins, in epoch seconds', () => {
    const resetsAt = Math.floor(NOW / 1000) + 3600
    expect(detectUsageLimit({ text: 'anything', rejected: { resetsAt } }, NOW)).toEqual({ resetsAt: resetsAt * 1000 })
  })
  test('the assistant error code alone marks a limit, reset unknown', () => {
    expect(detectUsageLimit({ text: 'API Error', assistantError: 'rate_limit' }, NOW)).toEqual({ resetsAt: null })
  })
  test('the CLI result text', () => {
    const epoch = Math.floor(NOW / 1000) + 7200
    expect(detectUsageLimit({ text: `Claude AI usage limit reached|${epoch}` }, NOW)).toEqual({ resetsAt: epoch * 1000 })
    expect(detectUsageLimit({ text: "You've hit your limit · resets 3pm (Asia/Tokyo)" }, NOW)).toEqual({
      resetsAt: new Date(2026, 9, 22, 15, 0).getTime()
    })
  })
  test('other errors are not limits', () => {
    expect(detectUsageLimit({ text: 'Invalid API key', assistantError: 'authentication_failed' }, NOW)).toBeUndefined()
  })
  test('a stale reset reads as unknown', () => {
    expect(detectUsageLimit({ text: 'x', rejected: { resetsAt: Math.floor(NOW / 1000) - 3600 } }, NOW)).toEqual({ resetsAt: null })
  })
})

describe('parseResetTime', () => {
  test('clock times roll to the next occurrence', () => {
    expect(parseResetTime('5-hour limit reached ∙ resets 9:30am', NOW)).toBe(new Date(2026, 9, 23, 9, 30).getTime())
    expect(parseResetTime('Your limit will reset at 12pm', NOW)).toBe(new Date(2026, 9, 22, 12, 0).getTime())
    expect(parseResetTime('reset at 15:00', NOW)).toBe(new Date(2026, 9, 22, 15, 0).getTime())
  })
  test('dated resets (weekly limits)', () => {
    expect(parseResetTime('Weekly limit reached ∙ resets Oct 27, 3pm', NOW)).toBe(new Date(2026, 9, 27, 15, 0).getTime())
  })
  test('durations are not clock times', () => {
    expect(parseResetTime('resets 5 hours from now', NOW)).toBeNull()
    expect(parseResetTime('limit reached', NOW)).toBeNull()
  })
})

describe('nextAutoResume', () => {
  test('a known reset fires a minute after it', () => {
    expect(nextAutoResume(NOW + 3_600_000, 0, NOW)).toEqual({ fireAt: NOW + 3_660_000, resetKnown: true, attempt: 0 })
  })
  test('unknown resets back off 15, 30, then 60 minutes', () => {
    expect(nextAutoResume(null, 0, NOW).fireAt).toBe(NOW + 15 * 60_000)
    expect(nextAutoResume(null, 1, NOW).fireAt).toBe(NOW + 30 * 60_000)
    expect(nextAutoResume(null, 5, NOW)).toEqual({ fireAt: NOW + 60 * 60_000, resetKnown: false, attempt: 5 })
  })
})

describe('TurnAutoResume', () => {
  function fakeSessions(): { registry: SessionRegistry; record: Partial<SessionRecord> } {
    const record: Partial<SessionRecord> = { id: 's1', autoResume: null }
    const registry = {
      get: (id: string) => (id === 's1' ? record : undefined),
      all: () => [record],
      update: (_id: string, patch: Partial<SessionRecord>) => Object.assign(record, patch)
    } as unknown as SessionRegistry
    return { registry, record }
  }

  test('a limit while enabled reschedules; any other ending stops it', () => {
    const { registry, record } = fakeSessions()
    const scheduler = new TurnAutoResume(registry, async () => 'started', () => undefined)
    scheduler.enable('s1', null, NOW)
    expect(record.autoResume).toEqual({ fireAt: NOW + 15 * 60_000, resetKnown: false, attempt: 0 })
    scheduler.turnEnded('s1', { reason: 'usage-limit', resetsAt: null }, NOW)
    expect(record.autoResume?.attempt).toBe(1)
    scheduler.turnEnded('s1', null, NOW)
    expect(record.autoResume).toBeNull()
  })

  test('gives up after the attempt cap', () => {
    const { registry, record } = fakeSessions()
    let gaveUp = false
    const scheduler = new TurnAutoResume(registry, async () => 'started', () => (gaveUp = true))
    scheduler.enable('s1', null, NOW)
    for (let i = 0; i < MAX_AUTO_RESUME_ATTEMPTS; i++) scheduler.turnEnded('s1', { reason: 'usage-limit', resetsAt: null }, NOW)
    expect(record.autoResume).toBeNull()
    expect(gaveUp).toBe(true)
  })
})

describe('recoveryPrompt', () => {
  const user = (text: string, messageId = 'm1'): acp.SessionUpdate => ({
    sessionUpdate: 'user_message_chunk',
    messageId,
    content: { type: 'text', text }
  })
  test('an unanswered prompt is sent again', () => {
    const notice: acp.SessionUpdate = { sessionUpdate: 'notice', severity: 'error', title: 'limit' }
    expect(recoveryPrompt([user('old', 'm0'), user('fix the bug'), notice])).toEqual([{ type: 'text', text: 'fix the bug' }])
  })
  test('a partly answered prompt is continued', () => {
    const reply: acp.SessionUpdate = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working on' } }
    expect(recoveryPrompt([user('fix the bug'), reply])).toEqual([{ type: 'text', text: CONTINUE_PROMPT }])
  })
  test('an empty chat has nothing to resume', () => {
    expect(() => recoveryPrompt([])).toThrow()
  })
})
