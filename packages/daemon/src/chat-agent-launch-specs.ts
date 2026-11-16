import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  CHAT_AGENT_IDS,
  chatAgentLabel,
  tuiAgentSpec,
  type ChatAgentId,
  type ChatAgentInfo,
  type ChatAgentInstallResult
} from '@acp-harness/protocol'
import { chatAgentLaunch } from './chat-agent-launch-settings.ts'
import { detectInstalledAgents, hostPath } from './tui-agent-detection.ts'
import { resolveClaudeExecutable } from './claude-executable.ts'
import { log } from './log.ts'
import { agentUpdate, checkAgentUpdates, type NpmPackage } from './chat-agent-updates.ts'

// How each external agent serves ACP, as data (Orca's acp-launch-specs.ts). An argument list with
// a probe is only used when the installed CLI's help names it: ACP flags were renamed between
// releases (`--experimental-acp` → `--acp`), so the daemon asks the CLI instead of assuming.

interface AcpLaunch {
  args: string[]
  probe?: { args: string[]; pattern: RegExp }
}

/** How a missing agent gets installed: global npm packages, or the vendor's install script. */
interface AgentInstall {
  npm?: NpmPackage[]
  /** A PowerShell line on Windows, a shell line elsewhere. */
  script?: { windows: string; unix: string }
}

interface AcpLaunchSpec {
  agent: Exclude<ChatAgentId, 'claude'>
  command: string
  /** A CLI whose ACP server ships separately: installed without `command`, the adapter is missing. */
  adapter?: { cli: string; hint: string; npm: NpmPackage[] }
  install?: AgentInstall
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
    adapter: {
      cli: 'codex',
      hint: 'Codex is installed, but its chats need the ACP adapter (`codex-acp`)',
      npm: [{ name: '@agentclientprotocol/codex-acp', bin: 'codex-acp' }]
    },
    install: {
      npm: [
        { name: '@openai/codex', bin: 'codex' },
        { name: '@agentclientprotocol/codex-acp', bin: 'codex-acp' }
      ]
    },
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
    install: { npm: [{ name: 'opencode-ai', bin: 'opencode' }] },
    accountVariable: null
  },
  { agent: 'gemini', command: 'gemini', install: { npm: [{ name: '@google/gemini-cli', bin: 'gemini' }] }, launches: ACP_FLAG_LAUNCHES, env: {}, accountVariable: null },
  // Orca's verified Grok launch.
  { agent: 'grok', command: 'grok', launches: [{ args: ['agent', 'stdio'] }], env: {}, accountVariable: 'GROK_HOME' },
  { agent: 'copilot', command: 'copilot', install: { npm: [{ name: '@github/copilot', bin: 'copilot' }] }, launches: [ACP_FLAG_LAUNCHES[0]!], env: {}, accountVariable: null },
  { agent: 'qwen-code', command: 'qwen', install: { npm: [{ name: '@qwen-code/qwen-code', bin: 'qwen' }] }, launches: ACP_FLAG_LAUNCHES, env: {}, accountVariable: null },
  { agent: 'goose', command: 'goose', launches: [ACP_SUBCOMMAND_LAUNCH], env: {}, accountVariable: null },
  { agent: 'kimi', command: 'kimi', launches: [ACP_SUBCOMMAND_LAUNCH, ACP_FLAG_LAUNCHES[0]!], env: {}, accountVariable: null },
  // Google's Antigravity CLI; `agy acp` since 1.5.0, signed in once by running `agy`.
  {
    agent: 'antigravity',
    command: 'agy',
    install: {
      script: {
        windows: 'irm https://antigravity.google/cli/install.ps1 | iex',
        unix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
      }
    },
    launches: [ACP_SUBCOMMAND_LAUNCH],
    env: {},
    accountVariable: null
  }
]

// Claude Code's native installer, for hosts where chats would fall back to the SDK's logged-out copy.
const CLAUDE_INSTALL: AgentInstall = {
  script: { windows: 'irm https://claude.ai/install.ps1 | iex', unix: 'curl -fsSL https://claude.ai/install.sh | bash' }
}
const INSTALL_TIMEOUT_MS = 10 * 60_000

const PROBE_TIMEOUT_MS = 8_000
const helpCache = new Map<string, Promise<string>>()

export type ResolvedChatAgent =
  | { status: 'ready'; argv: string[]; env: Record<string, string>; display: string }
  | { status: Exclude<ChatAgentInfo['status'], 'ready'>; detail: string }

/** How this host starts the agent's ACP server right now (custom command, PATH, probes). */
export async function resolveChatAgent(agent: ChatAgentId): Promise<ResolvedChatAgent> {
  const launch = await chatAgentLaunch(agent)
  if (agent === 'claude') {
    const cli = await resolveClaudeExecutable()
    // Without the CLI the SDK's bundled copy runs, which has no login unless an API key is set.
    if (!cli && !process.env.ANTHROPIC_API_KEY && !launch.env.ANTHROPIC_API_KEY) {
      return { status: 'missing', detail: '`claude` (Claude Code) is not on this host’s PATH: install it and run `claude` once to sign in' }
    }
    return { status: 'ready', argv: [], env: launch.env, display: cli ?? 'Claude Agent SDK' }
  }
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
    await checkUpdates(true)
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
        envNames: Object.keys(launch.env).sort(),
        installCommand: installCommand(id, resolved.status, launch.command, agentUpdate(id) !== null),
        installUrl: tuiAgentSpec(id)?.homepageUrl ?? null,
        update: launch.command ? null : agentUpdate(id)
      }
    })
  )
}

/**
 * What installs the agent, the part of it this host lacks, or its newer release; null when it runs
 * up to date or a custom command is set.
 */
export function installCommand(
  agent: ChatAgentId,
  status: ChatAgentInfo['status'],
  custom: string | null,
  outdated = false
): string | null {
  if (custom || (status === 'ready' && !outdated)) return null
  const spec = SPECS.find((s) => s.agent === agent)
  const install = agent === 'claude' ? CLAUDE_INSTALL : spec?.install
  if (status === 'needs-adapter' && spec?.adapter) return npmLine(spec.adapter.npm)
  if (!install) return null
  if (install.npm) return npmLine(install.npm)
  if (install.script) return process.platform === 'win32' ? install.script.windows : install.script.unix
  return null
}

function npmLine(packages: NpmPackage[]): string {
  return `npm install -g ${packages.map((p) => `${p.name}@latest`).join(' ')}`
}

/** The npm packages each agent runs from, for the update check. */
function npmAgents(): { id: ChatAgentId; packages: NpmPackage[] }[] {
  return SPECS.map((spec) => ({ id: spec.agent, packages: spec.install?.npm ?? spec.adapter?.npm ?? [] })).filter(
    (agent) => agent.packages.length > 0
  )
}

/** Compares installed agent packages with npm; true when an agent's update changed. */
export async function checkUpdates(network: boolean): Promise<boolean> {
  const PATH = await hostPath()
  return checkAgentUpdates(npmAgents(), async (bin) => Bun.which(bin, { PATH }), { network })
}

const installing = new Map<ChatAgentId, Promise<ChatAgentInstallResult>>()

/** Runs the agent's install command in the host's shell, then lists the agents with a fresh PATH. */
export function installChatAgent(agent: ChatAgentId): Promise<ChatAgentInstallResult> {
  let pending = installing.get(agent)
  if (!pending) {
    pending = runInstall(agent).finally(() => installing.delete(agent))
    installing.set(agent, pending)
  }
  return pending
}

async function runInstall(agent: ChatAgentId): Promise<ChatAgentInstallResult> {
  const current = (await listChatAgents(true)).find((a) => a.id === agent)
  const line = current?.installCommand
  if (!line) return { ok: false, output: `Nothing to install for ${chatAgentLabel(agent)} on this host.`, agents: await listChatAgents(false) }
  const argv =
    process.platform === 'win32'
      ? ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', line]
      : [process.env.SHELL || '/bin/sh', '-lc', line]
  log(`installing ${agent}: ${line}`)
  let code = 1
  let output = ''
  try {
    const proc = Bun.spawn(argv, {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PATH: await hostPath() },
      windowsHide: true
    })
    const timer = setTimeout(() => proc.kill(), INSTALL_TIMEOUT_MS)
    const [out, err, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]).finally(
      () => clearTimeout(timer)
    )
    code = exit
    output = `${out}${err}`.trim()
  } catch (error) {
    output = error instanceof Error ? error.message : String(error)
  }
  log(`install of ${agent} exited with ${code}`)
  // Installers add to PATH (npm's prefix, ~/.local/bin); terminals' agent detection reads it too.
  helpCache.clear()
  await hostPath(true)
  await checkUpdates(false)
  const agents = await listChatAgents(false)
  void detectInstalledAgents(true)
  const after = agents.find((a) => a.id === agent)
  return { ok: code === 0 && after?.status === 'ready' && !after.update, output, agents }
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
