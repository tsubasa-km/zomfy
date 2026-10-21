// Registers the verification repository with the running daemon (creating the repo if missing)
// and prints its primary workspace id: `bun scripts/ensure-playground.ts [path]`.
import * as acp from '@agentclientprotocol/sdk'
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HarnessState, Project } from '@acp-harness/protocol'
import { DAEMON_INFO_PATH } from '../src/websocket-server.ts'
import { git } from '../src/git-cli.ts'

const path = process.argv[2] ?? (process.platform === 'win32' ? 'C:\\dev\\harness-playground' : `${process.env.HOME}/harness-playground`)

if (!existsSync(join(path, '.git'))) {
  await mkdir(join(path, 'src'), { recursive: true })
  await writeFile(join(path, 'README.md'), '# harness-playground\n\nScratch repository for testing acp-harness end to end.\n')
  await writeFile(join(path, 'src', 'greet.ts'), 'export function greet(name: string): string {\n  return `Hello, ${name}!`\n}\n')
  await git(path, ['init', '-q', '-b', 'main'])
  await git(path, ['add', '-A'])
  await git(path, ['-c', 'user.name=acp-harness', '-c', 'user.email=acp-harness@localhost', 'commit', '-qm', 'Initial playground'])
}

const info = await Bun.file(DAEMON_INFO_PATH).json()
const stream = createWebSocketStream(info.url, { protocols: [info.protocolPrefix + info.token] })
await acp.client({ name: 'ensure-playground' }).connectWith(stream, async (ctx) => {
  await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
  const project = await ctx.request<Project>('_harness/projects/add', { path })
  const state = await ctx.request<HarnessState>('_harness/state/get', {})
  const primary = state.workspaces.find((w) => w.projectId === project.id && w.isPrimary)
  console.log(JSON.stringify({ projectId: project.id, workspaceId: primary?.id, path: project.path }))
})
process.exit(0)
