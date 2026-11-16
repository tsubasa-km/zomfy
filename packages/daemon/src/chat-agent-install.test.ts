import { describe, expect, test } from 'bun:test'
import { installCommand } from './chat-agent-launch-specs.ts'

describe('installCommand', () => {
  test('installs the Codex CLI with its ACP adapter when neither is there', () => {
    expect(installCommand('codex', 'missing', null)).toBe('npm install -g @openai/codex@latest @agentclientprotocol/codex-acp@latest')
  })

  test('installs only the adapter when the Codex CLI is already there', () => {
    expect(installCommand('codex', 'needs-adapter', null)).toBe('npm install -g @agentclientprotocol/codex-acp@latest')
  })

  test('runs the vendor script for Antigravity', () => {
    const line = installCommand('antigravity', 'missing', null)
    expect(line).toContain(process.platform === 'win32' ? 'install.ps1' : 'install.sh')
  })

  test('updates an npm agent whose release has no ACP mode', () => {
    expect(installCommand('gemini', 'unsupported', null)).toBe('npm install -g @google/gemini-cli@latest')
  })

  test('updates a ready agent with a newer release', () => {
    expect(installCommand('opencode', 'ready', null, true)).toBe('npm install -g opencode-ai@latest')
  })

  test('offers nothing for a ready agent, a custom command, or an agent without an installer', () => {
    expect(installCommand('codex', 'ready', null)).toBeNull()
    expect(installCommand('codex', 'missing', 'my-codex-acp')).toBeNull()
    expect(installCommand('goose', 'missing', null)).toBeNull()
  })
})

describe('compareVersions', () => {
  test('orders releases numerically and prereleases first', async () => {
    const { compareVersions } = await import('./chat-agent-updates.ts')
    expect(compareVersions('0.164.0', '0.165.0')).toBeLessThan(0)
    expect(compareVersions('2.10.0', '2.9.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })
})
