import { expect, test } from 'bun:test'
import type { TurnPhase } from '@zomfy/protocol'
import type { Session } from '../src/session-store.ts'
import { turnPhase } from '@zomfy/protocol'
import { chatTree, mostPressing, projectGroups, rowGlows, type ChatNode } from '../src/lib/chat-list.ts'

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

test('pinned threads sit first in their own card, in pin order; archived ones are left out', () => {
  const nodes = [node('p1', 'A', 'quiet', 1), node('z', 'A', 'quiet', 9, { archived: true }), node('k', 'A', 'needs-answer', 3), node('p2', 'A', 'quiet', 2), node('n', 'A', 'quiet', 5)]
  const { projects } = projectGroups(nodes, ['p2', 'p1'], () => 'A', ['A'])
  expect(ids(projects[0]!.nodes)).toEqual(['p2', 'p1', 'n', 'k'])
})

test('nothing is ordered by state: a thread that needs an answer sorts by its activity like any other', () => {
  const nodes = [node('old-question', 'A', 'needs-answer', 1), node('new-quiet', 'A', 'quiet', 9)]
  const { projects } = projectGroups(nodes, [], () => 'A', ['A'])
  expect(ids(projects[0]!.nodes)).toEqual(['new-quiet', 'old-question'])
})

test('a row glows when its thread needs the person: an ask waits or it is their turn', () => {
  expect(rowGlows('needs-answer', 'needs-you')).toBe(true)
  expect(rowGlows('your-turn', 'idle')).toBe(true)
  // A helper's ask shows in its parent's thread, so it lights the parent's row too.
  expect(rowGlows('working', 'needs-you')).toBe(true)
  expect(rowGlows('needs-answer', 'error')).toBe(false)
  expect(rowGlows('working', 'working')).toBe(false)
  expect(rowGlows('background', 'idle')).toBe(false)
  expect(rowGlows('quiet', 'idle')).toBe(false)
})

test("a folded project shows its most pressing thread: an answer, then the person's turn, then work", () => {
  expect(mostPressing([node('w', 'A', 'working', 1), node('y', 'A', 'your-turn', 1), node('n', 'A', 'needs-answer', 1)])?.chat.id).toBe('n')
  expect(mostPressing([node('w', 'A', 'working', 1), node('y', 'A', 'your-turn', 1)])?.chat.id).toBe('y')
  expect(mostPressing([node('b', 'A', 'background', 1), node('w', 'A', 'working', 1)])?.chat.id).toBe('w')
  expect(mostPressing([node('q', 'A', 'quiet', 1)])).toBeNull()
  expect(mostPressing([])).toBeNull()
})

test('a folded card shows the question over Your turn, also when the waiting thread had a turn end before', () => {
  const now = 1_000_000
  const session = (id: string, extra: Partial<Session>): Session =>
    ({ id, title: id, status: 'idle', createdAt: 0, turnStartedAt: null, hostId: 'local', workspaceId: 'w', items: [], loaded: true, ...extra }) as Session
  // The waiting thread still carries yourTurnSince from its last turn; the other is plainly Your turn.
  const asking = session('asking', { status: 'needs-you', yourTurnSince: now - 5000, lastActivityAt: now - 5000 })
  const yours = session('yours', { yourTurnSince: now - 100, lastActivityAt: now - 100 })
  const failed = session('failed', { status: 'error', yourTurnSince: now - 50, lastActivityAt: now - 50 })
  for (const order of [[asking, yours], [yours, asking]]) {
    const nodes = chatTree(order, (s) => turnPhase(s, now))
    expect(mostPressing(nodes)?.chat.id).toBe('asking')
  }
  expect(mostPressing(chatTree([yours, failed], (s) => turnPhase(s, now)))?.chat.id).toBe('failed')
})
