import { expect, test } from 'bun:test'
import type { TurnPhase } from '@zomfy/protocol'
import type { Session } from '../src/session-store.ts'
import { mostPressing, projectGroups, type ChatNode } from '../src/lib/chat-list.ts'

// docs/specs/threads-under-projects.md

const node = (id: string, project: string | null, phase: TurnPhase, at: number, extra: Partial<Session> = {}): ChatNode & { project: string | null } => ({
  chat: { id, title: id, status: 'idle', createdAt: 0, turnStartedAt: null, lastActivityAt: at, hostId: 'local', workspaceId: project ?? 'quick', items: [], loaded: true, ...extra } as Session,
  children: [],
  status: extra.status ?? 'idle',
  phase,
  project
})

const ids = (nodes: ChatNode[]) => nodes.map((n) => n.chat.id)

test('threads sit under their project in the project order, most recent activity first', () => {
  const nodes = [node('a1', 'A', 'quiet', 1), node('b1', 'B', 'needs-answer', 2), node('a2', 'A', 'your-turn', 3), node('a3', 'A', 'needs-answer', 2)]
  const { projects, loose } = projectGroups(nodes, [], (c) => nodes.find((n) => n.chat === c)!.project, ['B', 'A', 'C'])
  expect(projects.map((p) => [p.key, ids(p.nodes)])).toEqual([
    ['B', ['b1']],
    ['A', ['a2', 'a3', 'a1']],
    ['C', []]
  ])
  expect(loose).toEqual([])
})

test('threads of no project, or of a project not listed, form their own group', () => {
  const nodes = [node('q1', null, 'quiet', 1), node('q2', null, 'your-turn', 5), node('x', 'gone', 'quiet', 3)]
  const { loose } = projectGroups(nodes, [], (c) => nodes.find((n) => n.chat === c)!.project, ['A'])
  expect(ids(loose)).toEqual(['q2', 'x', 'q1'])
})

test('pinned and archived threads are left out of the projects', () => {
  const nodes = [node('p', 'A', 'quiet', 1), node('z', 'A', 'quiet', 2, { archived: true }), node('k', 'A', 'quiet', 3)]
  const { projects } = projectGroups(nodes, ['p'], () => 'A', ['A'])
  expect(ids(projects[0]!.nodes)).toEqual(['k'])
})

test("a folded project shows its most pressing thread: an answer, then the person's turn, then work", () => {
  expect(mostPressing([node('w', 'A', 'working', 1), node('y', 'A', 'your-turn', 1), node('n', 'A', 'needs-answer', 1)])?.chat.id).toBe('n')
  expect(mostPressing([node('w', 'A', 'working', 1), node('y', 'A', 'your-turn', 1)])?.chat.id).toBe('y')
  expect(mostPressing([node('b', 'A', 'background', 1), node('w', 'A', 'working', 1)])?.chat.id).toBe('w')
  expect(mostPressing([node('q', 'A', 'quiet', 1)])).toBeNull()
  expect(mostPressing([])).toBeNull()
})
