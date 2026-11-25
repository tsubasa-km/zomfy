import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Codex uses ACP for legacy settings and saves the host selection alongside launch overrides', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codex-launch-settings-'))
  const file = join(home, 'chat-agents.json')
  try {
    await writeFile(file, JSON.stringify({ codex: { command: 'custom-codex-acp', env: {} } }))
    // Load the settings in a fresh process so the test never reads the developer's agent settings.
    const script = `
      import { chatAgentLaunch, updateChatAgentLaunch } from './src/chat-agent-launch-settings.ts'
      const before = await chatAgentLaunch('codex')
      await Promise.all([
        updateChatAgentLaunch('codex', { codexConnection: 'app-server' }),
        updateChatAgentLaunch('codex', { env: { name: 'CODEX_HOME', value: 'test-profile' } })
      ])
      console.log(JSON.stringify({ before, after: await chatAgentLaunch('codex') }))
    `
    const child = Bun.spawn([process.execPath, '--eval', script], {
      cwd: join(import.meta.dir, '..'),
      env: { ...process.env, ZOMFY_HOME: home },
      stdout: 'pipe',
      stderr: 'inherit',
      windowsHide: true
    })
    const [exit, output] = await Promise.all([child.exited, new Response(child.stdout).json()])
    expect(exit).toBe(0)
    const after = { command: 'custom-codex-acp', env: { CODEX_HOME: 'test-profile' }, codexConnection: 'app-server' }
    expect(output).toEqual({
      before: { command: 'custom-codex-acp', env: {}, codexConnection: 'acp' },
      after
    })
    expect((await Bun.file(file).json()).codex).toEqual(after)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}, 15_000)
