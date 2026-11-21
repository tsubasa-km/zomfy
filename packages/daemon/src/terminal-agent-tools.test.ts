import { describe, expect, test } from 'bun:test'
import type { TerminalInfo } from '@zomfy/protocol'
import { createTerminalTools } from './terminal-agent-tools.ts'
import { isPersonInput } from './terminal-manager.ts'
import { asksForSecret, TerminalScreens } from './terminal-screen.ts'

function setup(output: string, extra: Partial<TerminalInfo> = {}) {
  const info: TerminalInfo = {
    id: 't1',
    workspaceId: 'w1',
    title: 'db',
    shell: 'ssh',
    cwd: '/',
    createdAt: 0,
    exitCode: null,
    connection: { id: 'c1', name: 'db', tag: 'production' },
    ...extra
  }
  const writes: string[] = []
  const personListeners = new Set<(id: string) => void>()
  const screens = new TerminalScreens({ replay: () => output, size: () => ({ cols: 80, rows: 10 }) })
  const terminals = {
    list: () => [info, { ...info, id: 't2', workspaceId: 'other' }],
    get: () => info,
    agentWrite: (_id: string, data: string) => {
      if (info.agentControl?.state === 'held') throw new Error('The person took this terminal back.')
      writes.push(data)
    },
    onPersonInput: (listener: (id: string) => void) => {
      personListeners.add(listener)
      return () => personListeners.delete(listener)
    }
  }
  const tools = createTerminalTools({ terminals, screens, chat: (id) => (id === 'chat' ? { workspaceId: 'w1', title: 'Fix it' } : null) })
  return { tools, writes, info, screens, typed: () => personListeners.forEach((l) => l('t1')) }
}

describe('terminal tools', () => {
  test('lists and reads only the chat workspace terminals, saying a production server is one', async () => {
    const { tools } = setup('Welcome\r\nops@db:~$ ')
    expect(tools.list('chat').result).toContain('production server')
    expect(tools.list('chat').result).not.toContain('t2')
    const read = await tools.read('chat', { terminalId: 't1' })
    expect(read.result).toContain('ops@db:~$')
    expect(read.result).toContain('production server')
    expect((await tools.read('chat', { terminalId: 't2' })).isError).toBe(true)
  })

  test('types text with Enter, or a key', async () => {
    const { tools, writes } = setup('$ ')
    await tools.send('chat', { terminalId: 't1', text: 'uptime' })
    await tools.send('chat', { terminalId: 't1', text: 'y', enter: false })
    await tools.send('chat', { terminalId: 't1', key: 'ctrl-c' })
    expect(writes).toEqual(['uptime\r', 'y', '\x03'])
  })

  test('withholds a password prompt and refuses to type into it', async () => {
    const { tools, writes } = setup('$ sudo ls\r\n[sudo] password for ops: ')
    expect((await tools.read('chat', { terminalId: 't1' })).result).toContain('withheld')
    const sent = await tools.send('chat', { terminalId: 't1', text: 'hunter2' })
    expect(sent.isError).toBe(true)
    expect(writes).toEqual([])
  })

  test('refuses once the person took the terminal back', async () => {
    const { tools } = setup('$ ', { agentControl: { state: 'held', sessionId: 'chat', chatTitle: 'Fix it', since: 0 } })
    const sent = await tools.send('chat', { terminalId: 't1', text: 'ls' })
    expect(sent.isError).toBe(true)
    expect(sent.result).toContain('took this terminal back')
  })

  test('a wait ends early when the person types', async () => {
    const { tools, typed } = setup('$ ')
    const waiting = tools.wait('chat', { terminalId: 't1', text: 'never shown', timeoutSeconds: 10 })
    setTimeout(typed, 300)
    expect((await waiting).result).toContain('The person typed')
  })

  test('a wait ends when the text shows', async () => {
    const { tools, screens } = setup('$ ')
    await tools.read('chat', { terminalId: 't1' })
    const waiting = tools.wait('chat', { terminalId: 't1', text: 'done', timeoutSeconds: 10 })
    setTimeout(() => screens.feed('t1', 'build done\r\n$ '), 300)
    expect((await waiting).result).toContain('build done')
  })
})

describe('what counts as the person typing', () => {
  test('keys do; the terminal answering its own queries does not', () => {
    for (const data of ['l', '\r', '\x03', '\x1b[A']) expect(isPersonInput(data)).toBe(true)
    for (const data of ['\x1b[?1;2c', '\x1b[12;40R', '\x1b[I', '\x1b[O', '\x1b]11;rgb:0000/0000/0000\x1b\\', '\x1b]10;rgb:ffff/ffff/ffff\x07']) {
      expect(isPersonInput(data)).toBe(false)
    }
  })

  test('secret prompts', () => {
    for (const line of ['Password: ', '[sudo] password for ops: ', "Enter passphrase for key '/home/a/.ssh/id':", 'ops@db\'s password:', 'Verification code: ']) {
      expect(asksForSecret(line)).toBe(true)
    }
    for (const line of ['ops@db:~$ ', 'grep password config.yml', '$ echo pin']) expect(asksForSecret(line)).toBe(false)
  })
})
