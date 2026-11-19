import { describe, expect, test } from 'bun:test'
import { isGuardedChatAgent } from '@acp-harness/protocol'
import { guardedAgentNotice, refuseUnattended } from './chat-agent-launch-specs.ts'

describe('guarded agents', () => {
  test('Antigravity is guarded, the others are not', () => {
    expect(isGuardedChatAgent('antigravity')).toBe(true)
    for (const agent of ['claude', 'codex', 'gemini', 'opencode', null, undefined]) expect(isGuardedChatAgent(agent)).toBe(false)
  })

  test('never starts unattended, and says why', () => {
    expect(() => refuseUnattended('antigravity', 'automations')).toThrow(/only in threads you start yourself, not in automations/)
    expect(() => refuseUnattended('codex', 'automations')).not.toThrow()
    expect(() => refuseUnattended(undefined, 'workflows')).not.toThrow()
  })

  test('the settings notice names the risk', () => {
    expect(guardedAgentNotice('antigravity')).toContain('suspends accounts')
  })
})

describe('Antigravity in a terminal', () => {
  test('starts on its own, but takes no prompt typed in for it', async () => {
    const { buildAgentLaunchPlan } = await import('./tui-agent-launch.ts')
    expect(buildAgentLaunchPlan('antigravity', undefined, 'powershell')).toEqual({ command: 'agy', followupPrompt: null })
    expect(() => buildAgentLaunchPlan('antigravity', 'fix the bug', 'powershell')).toThrow(/without a prompt/)
    expect(buildAgentLaunchPlan('aider', 'fix the bug', 'powershell').followupPrompt).toBe('fix the bug')
  })
})
