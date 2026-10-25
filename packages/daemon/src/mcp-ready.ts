import type * as acp from '@agentclientprotocol/sdk'
import { log } from './log.ts'

// An agent like Codex starts the MCP servers it is given while its first turn begins, and leaves out
// any not answering yet; npx-started servers (Playwright) take seconds. Starting the same server here
// and waiting for its answer tells when the agent's own copy, started at about the same moment, is up.

const LIMIT_MS = 45_000
const MARGIN_MS = 1_500

function answered(server: Extract<acp.McpServer, { command: string }>): Promise<boolean> {
  const proc = Bun.spawn([server.command, ...server.args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    env: { ...process.env, ...Object.fromEntries(server.env.map((e) => [e.name, e.value])) },
    windowsHide: true
  })
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acp-harness', version: '0' } } }
  proc.stdin.write(`${JSON.stringify(init)}\n`)
  void proc.stdin.flush()
  const reply = (async () => {
    const decoder = new TextDecoder()
    let text = ''
    for await (const chunk of proc.stdout) {
      text += decoder.decode(chunk, { stream: true })
      if (text.includes('"result"')) return true
    }
    return false
  })()
  const timeout = Bun.sleep(LIMIT_MS).then(() => false)
  return Promise.race([reply, timeout]).finally(() => proc.kill())
}

/** Resolves once each stdio server answers (or after the limit), plus a margin for the agent's copy. */
export async function mcpServersReady(servers: acp.McpServer[]): Promise<void> {
  const stdio = servers.filter((s): s is Extract<acp.McpServer, { command: string }> => 'command' in s)
  if (stdio.length === 0) return
  const results = await Promise.all(stdio.map((s) => answered(s).catch(() => false)))
  stdio.forEach((s, i) => {
    if (!results[i]) log(`MCP server ${s.name} did not answer within ${LIMIT_MS / 1000}s`)
  })
  await Bun.sleep(MARGIN_MS)
}
