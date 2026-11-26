import { expect, test } from 'bun:test'
import { DEFAULT_NEW_TAB_PINS, defaultTerminalWorkspace, parsePin, togglePin, unpin } from '../src/lib/new-tab-pins.ts'
import { DEFAULT_SETTINGS } from '../src/stores/settings-store.ts'

test('a window starts with the Terminal pin, so the old Terminal button stays', () => {
  expect(DEFAULT_NEW_TAB_PINS).toEqual(['terminal'])
  expect(DEFAULT_SETTINGS.newTabPins).toEqual(['terminal'])
})

test('pinning adds at the end, in pin order; pinning again unpins', () => {
  let pins = togglePin(['terminal'], 'chat:codex')
  pins = togglePin(pins, 'workflow:w1')
  expect(pins).toEqual(['terminal', 'chat:codex', 'workflow:w1'])
  expect(togglePin(pins, 'chat:codex')).toEqual(['terminal', 'workflow:w1'])
  expect(unpin(pins, 'terminal')).toEqual(['chat:codex', 'workflow:w1'])
  expect(unpin(pins, 'missing')).toEqual(pins)
})

test('a pin id names its kind and key; panel ids stay whole', () => {
  expect(parsePin('terminal')).toEqual({ kind: 'terminal', key: '' })
  expect(parsePin('browser')).toEqual({ kind: 'browser', key: '' })
  expect(parsePin('chat:codex')).toEqual({ kind: 'chat', key: 'codex' })
  expect(parsePin('agent:claude')).toEqual({ kind: 'agent', key: 'claude' })
  expect(parsePin('command:a:b')).toEqual({ kind: 'command', key: 'a:b' })
  expect(parsePin('workflow:w1')).toEqual({ kind: 'workflow', key: 'w1' })
  expect(parsePin('ssh:s1')).toEqual({ kind: 'ssh', key: 's1' })
  expect(parsePin('panel:explorer')).toEqual({ kind: 'panel', key: 'panel:explorer' })
  expect(parsePin('plugin:x')).toEqual({ kind: 'panel', key: 'plugin:x' })
})

test('a new terminal defaults to the current workspace, else the host’s first project checkout', () => {
  const workspaces = [
    { id: 'scratch', hostId: 'local', projectId: null, isPrimary: false, scratch: true },
    { id: 'wt', hostId: 'local', projectId: 'p', isPrimary: false },
    { id: 'main', hostId: 'local', projectId: 'p', isPrimary: true },
    { id: 'remote-wt', hostId: 'wsl', projectId: 'q', isPrimary: false }
  ]
  expect(defaultTerminalWorkspace(workspaces, 'local', 'wt')).toBe('wt')
  expect(defaultTerminalWorkspace(workspaces, 'local', 'remote-wt')).toBe('main')
  expect(defaultTerminalWorkspace(workspaces, 'wsl', 'wt')).toBe('remote-wt')
  expect(defaultTerminalWorkspace(workspaces, 'ssh', 'wt')).toBeNull()
})
