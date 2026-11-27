import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// harness-agent-external.scenario.ts builds a whole harness agent, whose stores live in ZOMFY_HOME:
// it runs in a process of its own with a temporary home, never the person's ~/.zomfy, ~/.codex or
// ~/.claude, and with fake agents instead of real ones.
test('Codex and ACP chats follow the permission mode, instructions, titles and moves', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-external-'))
  try {
    const child = Bun.spawn([process.execPath, 'test', './src/harness-agent-external.scenario.ts'], {
      cwd: join(import.meta.dir, '..'),
      env: {
        ...process.env,
        ZOMFY_HOME: home,
        ZOMFY_SCENARIO: '1',
        CODEX_HOME: join(home, 'codex'),
        CLAUDE_CONFIG_DIR: join(home, 'claude')
      },
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true
    })
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    if (exit !== 0) console.error(out + err)
    expect(exit).toBe(0)
    expect(err).toMatch(/\b\d+ pass\b/)
    expect(err).toMatch(/\b0 fail\b/)
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
}, 180_000)
