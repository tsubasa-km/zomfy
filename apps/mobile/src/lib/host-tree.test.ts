import { describe, expect, test } from 'bun:test'
import type { HarnessState, SessionInfo, Workspace } from '@zomfy/protocol'
import { hostTree, needsYouCount } from './host-tree'

const ws = (id: string, projectId: string | null, isPrimary = false): Workspace => ({
  id,
  projectId,
  name: id,
  path: `/${id}`,
  branch: null,
  isPrimary,
  createdAt: 0
})
const chat = (id: string, workspaceId: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  workspaceId,
  cwd: '/',
  title: id,
  status: 'idle',
  createdAt: 0,
  turnStartedAt: null,
  ...extra
})

const state: HarnessState = {
  host: { id: 'local', label: 'Desk', platform: 'win32' },
  projects: [{ id: 'p1', name: 'zomfy', path: '/zomfy', kind: 'git' }],
  workspaces: [ws('main', 'p1', true), ws('wt-empty', 'p1'), ws('wt', 'p1'), ws('float', null)],
  floatingWorkspaceId: 'float'
}

describe('host tree', () => {
  test('groups chats under workspaces, newest first, leaving out archived and workflow chats', () => {
    const tree = hostTree(state, [
      chat('old', 'main', { lastActivityAt: 1 }),
      chat('new', 'main', { lastActivityAt: 5 }),
      chat('archived', 'main', { archived: true }),
      chat('step', 'wt', { origin: 'workflow' }),
      chat('wt-chat', 'wt'),
      chat('quick', 'float')
    ])
    expect(tree.map((n) => n.project?.id ?? null)).toEqual(['p1', null])
    expect(tree[0]!.workspaces.map((w) => [w.workspace.id, w.chats.map((c) => c.id)])).toEqual([
      ['main', ['new', 'old']],
      ['wt', ['wt-chat']]
    ])
    expect(tree[1]!.workspaces[0]!.chats.map((c) => c.id)).toEqual(['quick'])
  })

  test('counts asks plus waiting chats without an ask', () => {
    const sessions = [chat('a', 'main', { status: 'needs-you' }), chat('b', 'main', { status: 'needs-you' }), chat('c', 'main')]
    expect(needsYouCount([{ sessionId: 'a' }], sessions)).toBe(2)
    expect(needsYouCount([], [])).toBe(0)
  })
})
