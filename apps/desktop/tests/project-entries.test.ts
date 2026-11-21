import { describe, expect, test } from 'bun:test'
import type { Project } from '@zomfy/protocol'
import { projectEntries } from '../src/components/sidebar/project-entries.ts'

const project = (hostId: string, id: string): Project & { hostId: string } => ({ hostId, id, name: id, path: `/${id}`, kind: 'git' })

describe('projects across hosts', () => {
  const a = project('local', 'a')
  const b = project('local', 'b')
  const w = project('wsl:Ubuntu', 'w')

  test('with an empty catalog every host project stands alone', () => {
    expect(projectEntries([a, b, w], [])).toEqual([
      { primary: a, copies: [] },
      { primary: b, copies: [] },
      { primary: w, copies: [] }
    ])
  })

  test('a catalog project folds into the place of its first location listed, main first', () => {
    const catalog = [{ id: 'x', locations: [{ hostId: 'wsl:Ubuntu', projectId: 'w' }, { hostId: 'local', projectId: 'b' }] }]
    expect(projectEntries([a, b, w], catalog)).toEqual([
      { primary: a, copies: [] },
      { primary: w, copies: [b] }
    ])
  })

  test('a catalog project with one location, or whose other host is not listed, is a plain row', () => {
    const catalog = [
      { id: 'x', locations: [{ hostId: 'local', projectId: 'a' }], name: 'Zomfy' },
      { id: 'y', locations: [{ hostId: 'ssh:box', projectId: 's' }, { hostId: 'local', projectId: 'b' }] }
    ]
    expect(projectEntries([a, b], catalog)).toEqual([
      { primary: a, copies: [] },
      { primary: b, copies: [] }
    ])
  })
})
