import { describe, expect, test } from 'bun:test'
import { hostedProjects as allProjects, hostedWorkspaces, workspaceHost } from '../src/lib/host-lists.ts'

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

describe('workspaceHost', () => {
  const connecting = (id: string) => ({ id, label: id, connection: { kind: 'connecting' }, harness: null }) as never
  const offline = (id: string) => ({ id, label: id, connection: { kind: 'offline', reason: 'x' }, harness: null }) as never

  test('names the host that lists the workspace', () => {
    expect(workspaceHost({ local: host('local', []), 'ssh:box': host('ssh:box', [{ id: 'w1', projectId: 'p' }]) }, 'w1', 'local')).toBe('ssh:box')
  })

  test('waits on a host still connecting rather than falling back to this computer', () => {
    expect(workspaceHost({ local: host('local', []), 'ssh:box': connecting('ssh:box') }, 'w1', 'local')).toBe('pending')
  })

  test('no host once every host has listed or is offline', () => {
    expect(workspaceHost({ local: host('local', []), 'ssh:box': offline('ssh:box') }, 'w1', 'local')).toBeNull()
  })
})
