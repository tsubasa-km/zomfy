import { describe, expect, test } from 'bun:test'
import { hostedProjects as allProjects, hostedWorkspaces } from '../src/lib/host-lists.ts'

const allWorkspaces = ({ hosts }: { hosts: Record<string, never> }) => hostedWorkspaces(hosts, 'local')

const host = (id: string, workspaces: { id: string; projectId: string }[]) =>
  ({
    id,
    label: id,
    connection: { kind: 'connected' },
    harness: {
      projects: [{ id: `p-${id}`, name: 'app', path: '/app', kind: 'git' }],
      workspaces: workspaces.map((w) => ({ ...w, name: w.id, path: `/${w.id}`, isPrimary: true })),
      floatingWorkspaceId: null
    }
  }) as never

describe('store lists', () => {
  // A store selector returning one of these must see the same object until the hosts change, or
  // React re-renders forever (error #185): the blank window a fresh WSL workspace caused.
  test('the same hosts give the same lists and items', () => {
    const hosts = { local: host('local', [{ id: 'w1', projectId: 'p-local' }]), 'wsl:Ubuntu': host('wsl:Ubuntu', [{ id: 'w2', projectId: 'p-wsl:Ubuntu' }]) }
    expect(allWorkspaces({ hosts })).toBe(allWorkspaces({ hosts }))
    expect(allWorkspaces({ hosts }).find((w) => w.id === 'w2')).toBe(allWorkspaces({ hosts }).find((w) => w.id === 'w2'))
    expect(allProjects(hosts)).toBe(allProjects(hosts))
    expect(allWorkspaces({ hosts }).map((w) => w.hostId)).toEqual(['local', 'wsl:Ubuntu'])
  })

  test('changed hosts give new lists', () => {
    const hosts = { local: host('local', [{ id: 'w1', projectId: 'p-local' }]) }
    const next = { ...hosts, local: host('local', [{ id: 'w1', projectId: 'p-local' }, { id: 'w3', projectId: 'p-local' }]) }
    expect(allWorkspaces({ hosts: next })).not.toBe(allWorkspaces({ hosts }))
    expect(allWorkspaces({ hosts: next })).toHaveLength(2)
  })

  test('a host whose state lacks a list reads as empty', () => {
    const hosts = { 'wsl:Old': { id: 'wsl:Old', label: 'Old', connection: { kind: 'connected' }, harness: {} } as never }
    expect(allWorkspaces({ hosts })).toEqual([])
    expect(allProjects(hosts)).toEqual([])
  })
})
