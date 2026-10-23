import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CHAT_AGENT_IDS, chatAgentLabel, type ChatAgentId, type ChatAgentInfo } from '@acp-harness/protocol'
import { chatAgentLaunch } from './chat-agent-launch-settings.ts'
import { hostPath } from './tui-agent-detection.ts'
import { log } from './log.ts'

// How each external agent serves ACP, as data (Orca's acp-launch-specs.ts). An argument list with
// a probe is only used when the installed CLI's help names it: ACP flags were renamed between
// releases (`--experimental-acp` → `--acp`), so the daemon asks the CLI instead of assuming.

interface AcpLaunch {
  args: string[]
  probe?: { args: string[]; pattern: RegExp }
}

interface AcpLaunchSpec {
  agent: Exclude<ChatAgentId, 'claude'>
  command: string
  /** A CLI whose ACP server ships separately: installed without `command`, the adapter is missing. */
  adapter?: { cli: string; hint: string }
  launches: AcpLaunch[]
  /** Laid over the agent's environment before the user's own variables. */
  env: Record<string, string>
  accountVariable: string | null
}

const ACP_FLAG_LAUNCHES: AcpLaunch[] = [
  { args: ['--acp'], probe: { args: ['--help'], pattern: /--acp\b/ } },
  { args: ['--experimental-acp'], probe: { args: ['--help'], pattern: /--experimental-acp\b/ } }
]
const ACP_SUBCOMMAND_LAUNCH: AcpLaunch = { args: ['acp'], probe: { args: ['--help'], pattern: /^\s+acp\b/m } }

const SPECS: AcpLaunchSpec[] = [
  {
    agent: 'codex',
    command: 'codex-acp',
    adapter: { cli: 'codex', hint: 'Codex chats need the ACP adapter: npm install -g @agentclientprotocol/codex-acp' },
    launches: [{ args: [] }],
    env: {},
    accountVariable: 'CODEX_HOME'
  },
  {
    agent: 'opencode',
    command: 'opencode',
    // `opencode acp` on both the 1.x and 2.x lines (Orca's recorded launches).
    launches: [{ args: ['acp'] }],
    // Orca's: ACP sessions report this client, and no question tool, which the chat has no form for.
    env: { OPENCODE_CLIENT: 'acp', OPENCODE_ENABLE_QUESTION_TOOL: 'false' },
    accountVariable: null
  },
  { agent: 'gemini', command: 'gemini', launches: ACP_FLAG_LAUNCHES, env: {}, accountVariable: null },
  // Orca's verified Grok launch.
  { agent: 'grok', command: 'grok', launches: [{ args: ['agent', 'stdio'] }], env: {}, accountVariable: 'GROK_HOME' },
  { agent: 'copilot', command: 'copilot', launches: [ACP_FLAG_LAUNCHES[0]!], env: {}, accountVariable: null },
  { agent: 'qwen-code', command: 'qwen', launches: ACP_FLAG_LAUNCHES, env: {}, accountVariable: null },
  { agent: 'goose', command: 'goose', launches: [ACP_SUBCOMMAND_LAUNCH], env: {}, accountVariable: null },
  { agent: 'kimi', command: 'kimi', launches: [ACP_SUBCOMMAND_LAUNCH, ACP_FLAG_LAUNCHES[0]!], env: {}, accountVariable: null }
]

const PROBE_TIMEOUT_MS = 8_000
const helpCache = new Map<string, Promise<string>>()

export type ResolvedChatAgent =
  | { status: 'ready'; argv: string[]; env: Record<string, string>; display: string }
  | { status: Exclude<ChatAgentInfo['status'], 'ready'>; detail: string }

/** How this host starts the agent's ACP server right now (custom command, PATH, probes). */
export async function resolveChatAgent(agent: ChatAgentId): Promise<ResolvedChatAgent> {
  const launch = await chatAgentLaunch(agent)
  if (agent === 'claude') return { status: 'ready', argv: [], env: launch.env, display: 'Claude Agent SDK' }
  const spec = SPECS.find((s) => s.agent === agent)
  if (!spec) return { status: 'unsupported', detail: `${chatAgentLabel(agent)} has no chat mode yet` }
  const PATH = await hostPath()
  const env = { ...spec.env, ...launch.env }
  if (launch.command) {
    const [program = '', ...args] = splitCommand(launch.command)
    const found = Bun.which(program, { PATH })
    if (!found) return { status: 'missing', detail: `\`${program}\` (the custom command) is not on this host’s PATH` }
    return { status: 'ready', argv: [...(await resolveShim(found)), ...args], env, display: launch.command }
  }
  const found = Bun.which(spec.command, { PATH })
  if (!found) {
    if (spec.adapter && Bun.which(spec.adapter.cli, { PATH })) return { status: 'needs-adapter', detail: spec.adapter.hint }
    return { status: 'missing', detail: `\`${spec.command}\` is not on this host’s PATH` }
  }
  const base = await resolveShim(found)
  for (const candidate of spec.launches) {
    if (!candidate.probe || candidate.probe.pattern.test(await helpText(base, candidate.probe.args))) {
      return { status: 'ready', argv: [...base, ...candidate.args], env, display: [spec.command, ...candidate.args].join(' ') }
    }
  }
  return { status: 'unsupported', detail: `This ${chatAgentLabel(agent)} release has no ACP mode (checked \`${spec.command} --help\`)` }
}

export async function listChatAgents(refresh: boolean): Promise<ChatAgentInfo[]> {
  if (refresh) {
    helpCache.clear()
    await hostPath(true)
  }
  return Promise.all(
    CHAT_AGENT_IDS.map(async (id): Promise<ChatAgentInfo> => {
      const [resolved, launch] = await Promise.all([resolveChatAgent(id), chatAgentLaunch(id)])
      return {
        id,
        label: chatAgentLabel(id),
        status: resolved.status,
        detail: resolved.status === 'ready' ? resolved.display : resolved.detail,
        accountVariable: id === 'claude' ? 'CLAUDE_CONFIG_DIR' : (SPECS.find((s) => s.agent === id)?.accountVariable ?? null),
        command: launch.command,
        envNames: Object.keys(launch.env).sort()
      }
    })
  )
}

function helpText(base: string[], args: string[]): Promise<string> {
  const key = [...base, ...args].join('\0')
  let pending = helpCache.get(key)
  if (!pending) {
    pending = (async () => {
      const proc = Bun.spawn([...base, ...args], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, PATH: await hostPath() },
        windowsHide: true
      })
      const timer = setTimeout(() => proc.kill(), PROBE_TIMEOUT_MS)
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      clearTimeout(timer)
      return `${out}\n${err}`
    })().catch((error: unknown) => {
      log(`help probe failed for ${base.join(' ')}: ${String(error)}`)
      return ''
    })
    helpCache.set(key, pending)
  }
  return pending
}

/**
 * npm's Windows `.cmd` shims run their target through cmd.exe, which a kill leaves running; start
 * the target itself (Orca's process-host resolves the same shims).
 */
async function resolveShim(path: string): Promise<string[]> {
  if (process.platform !== 'win32' || !/\.cmd$/i.test(path)) return [path]
  try {
    const text = await readFile(path, 'utf8')
    const targets = [...text.matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => m[1]!)
    const target = targets.at(-1)
    if (!target) return [path]
    const full = join(dirname(path), target)
    if (/\.exe$/i.test(full)) return [full]
    if (/\.[cm]?js$/i.test(full)) return [Bun.which('node', { PATH: await hostPath() }) ?? 'node', full]
  } catch (error) {
    log(`reading shim ${path} failed: ${String(error)}`)
  }
  return [path]
}

/** A settings command line: whitespace-separated, with double quotes around parts that hold spaces. */
function splitCommand(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
}
