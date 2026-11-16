import { describe, expect, test } from 'bun:test'
import { installCommand } from './chat-agent-launch-specs.ts'

describe('installCommand', () => {
  test('installs the Codex CLI with its ACP adapter when neither is there', () => {
    expect(installCommand('codex', 'missing', null)).toBe('npm install -g @openai/codex @agentclientprotocol/codex-acp')
  })

  test('installs only the adapter when the Codex CLI is already there', () => {
    expect(installCommand('codex', 'needs-adapter', null)).toBe('npm install -g @agentclientprotocol/codex-acp')
  })

  test('runs the vendor script for Antigravity', () => {
    const line = installCommand('antigravity', 'missing', null)
    expect(line).toContain(process.platform === 'win32' ? 'install.ps1' : 'install.sh')
  })

  test('updates an npm agent whose release has no ACP mode', () => {
    expect(installCommand('gemini', 'unsupported', null)).toBe('npm install -g @google/gemini-cli')
  })

  test('offers nothing for a ready agent, a custom command, or an agent without an installer', () => {
    expect(installCommand('codex', 'ready', null)).toBeNull()
    expect(installCommand('codex', 'missing', 'my-codex-acp')).toBeNull()
    expect(installCommand('goose', 'missing', null)).toBeNull()
  })
})
