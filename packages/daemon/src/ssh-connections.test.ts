import { describe, expect, test } from 'bun:test'
import { cleanConnection, sshArgs } from './ssh-connections.ts'

const base = { name: '', host: 'db-1', port: null, user: null, identityFile: null, proxyJump: null, group: null, tag: null }

describe('ssh connections', () => {
  test('ssh gets options first and the destination after --', () => {
    const connection = { ...cleanConnection({ ...base, port: 2222, user: 'ops', identityFile: 'C:\keys\id', proxyJump: 'bastion', tag: 'production' }), id: 'x', createdAt: 0 }
    expect(sshArgs(connection)).toEqual(['-p', '2222', '-l', 'ops', '-i', 'C:\keys\id', '-J', 'bastion', '--', 'db-1'])
    expect(connection.name).toBe('db-1')
    expect(connection.tag).toBe('production')
  })

  test('refuses what ssh would read as an option or a shell would split', () => {
    for (const bad of [{ host: '-oProxyCommand=x' }, { host: 'a b' }, { host: '' }, { user: '-x' }, { port: 70000 }, { proxyJump: 'a;b' }, { identityFile: '-i' }]) {
      expect(() => cleanConnection({ ...base, ...bad })).toThrow()
    }
  })

  test('drops an unknown tag', () => {
    expect(cleanConnection({ ...base, tag: 'prod' as never }).tag).toBeNull()
  })
})
