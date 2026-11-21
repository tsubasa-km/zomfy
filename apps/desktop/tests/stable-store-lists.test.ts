import { describe, expect, test } from 'bun:test'
import type { TerminalInfo } from '@zomfy/protocol'
import { sameTerminal } from '../src/lib/same-terminal.ts'
import { keepUnchangedTabs } from '../src/components/tab-layout/keep-unchanged-tabs.ts'
import type { WorkspaceTab } from '../src/components/tab-layout/workspace-tab-model.ts'

// A host resends its whole terminal list when one title changes, and the tab lists are rebuilt on
// every store change: what did not change keeps its object, so memoised views leave it alone.

const info = (id: string, title = 'pwsh'): TerminalInfo =>
  ({
    id,
    workspaceId: 'w',
    title,
    shell: 'pwsh',
    shellId: 'pwsh',
    shellKind: 'powershell',
    cwd: '/x',
    createdAt: 1,
    startedAt: 1,
    exitCode: null,
    agent: null,
    customTitle: null,
    inline: null,
    agentControl: { state: 'driving', sessionId: 's', chatTitle: 'c', since: 1 }
  }) as TerminalInfo

describe('sameTerminal', () => {
  test('matches a resent copy, nested values included', () => {
    expect(sameTerminal({ ...info('a'), hostId: 'local' }, info('a'))).toBe(true)
  })

  test('tells a new title or a field that came or went', () => {
    expect(sameTerminal({ ...info('a'), hostId: 'local' }, info('a', 'spin |'))).toBe(false)
    const { agentControl: _, ...without } = info('a')
    expect(sameTerminal({ ...info('a'), hostId: 'local' }, without as TerminalInfo)).toBe(false)
    expect(sameTerminal({ ...(without as TerminalInfo), hostId: 'local' }, info('a'))).toBe(false)
  })
})

describe('keepUnchangedTabs', () => {
  const tab = (terminal: TerminalInfo): WorkspaceTab => ({ kind: 'terminal', id: terminal.id, createdAt: terminal.createdAt, terminal })
  const a = info('a')
  const b = info('b')

  test('hands back the last list when no tab changed', () => {
    const previous = [tab(a), tab(b)]
    expect(keepUnchangedTabs(previous, [tab(a), tab(b)])).toBe(previous)
  })

  test('replaces only the tab whose terminal changed', () => {
    const previous = [tab(a), tab(b)]
    const b2 = info('b', 'spin /')
    const next = keepUnchangedTabs(previous, [tab(a), tab(b2)])
    expect(next).not.toBe(previous)
    expect(next[0]).toBe(previous[0])
    expect(next[1]).not.toBe(previous[1])
    expect(next[1]!.kind === 'terminal' && next[1]!.terminal).toBe(b2)
  })

  test('follows a new order and a closed tab', () => {
    const previous = [tab(a), tab(b)]
    const reordered = keepUnchangedTabs(previous, [tab(b), tab(a)])
    expect(reordered).toEqual([previous[1], previous[0]])
    expect(reordered[0]).toBe(previous[1])
    expect(keepUnchangedTabs(previous, [tab(a)])).toEqual([previous[0]])
  })
})
