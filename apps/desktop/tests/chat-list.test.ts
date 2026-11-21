import { describe, expect, test } from 'bun:test'
import type { Session } from '../src/session-store.ts'
import { chatTree, searchTree } from '../src/lib/chat-list.ts'

let clock = 0
const chat = (id: string, extra: Partial<Session> = {}): Session =>
  ({
    id,
    title: id,
    status: 'idle',
    createdAt: ++clock,
    turnStartedAt: null,
    hostId: 'local',
    workspaceId: 'w',
    items: [],
    loaded: true,
    ...extra
  }) as Session

const shape = (nodes: { chat: Session; children: Session[] }[]) => nodes.map((n) => [n.chat.id, n.children.map((c) => c.id)])

describe('chats an agent started', () => {
  test('fold under the chat that started them', () => {
    const lead = chat('lead')
    const helper = chat('helper', { parentId: 'lead' })
    expect(shape(chatTree([lead, helper]))).toEqual([['lead', ['helper']]])
  })

  test('stand on their own when the parent is gone', () => {
    expect(shape(chatTree([chat('helper', { parentId: 'gone' })]))).toEqual([['helper', []]])
  })

  test('stand on their own when the parent is archived and they are not', () => {
    const lead = chat('lead', { archived: true })
    const live = chat('live', { parentId: 'lead' })
    const shelved = chat('shelved', { parentId: 'lead', archived: true })
    expect(shape(chatTree([lead, live, shelved]))).toEqual([
      ['lead', ['shelved']],
      ['live', []]
    ])
  })
})

describe('a search', () => {
  const lead = chat('lead')
  const helper = chat('fix parser', { parentId: 'lead' })
  const other = chat('docs', { parentId: 'lead' })
  const nodes = chatTree([lead, helper, other])
  const finds = (needle: string) => (s: Session) => s.title.includes(needle)

  test('keeps a child it found under its parent, as a hit', () => {
    const [found] = searchTree(nodes, finds('parser'))
    expect(found!.chat.id).toBe('lead')
    expect(found!.hits.map((s) => s.id)).toEqual(['fix parser'])
  })

  test('keeps a parent it found without hits', () => {
    expect(searchTree(nodes, finds('lead')).map((n) => [n.chat.id, n.hits.length])).toEqual([['lead', 0]])
  })

  test('leaves out a tree it found nothing in', () => {
    expect(searchTree(nodes, finds('zzz'))).toEqual([])
  })
})
