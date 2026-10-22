import { log } from './log.ts'

export type HostingTool = 'gh' | 'glab'

export type HostingCliErrorKind = 'missing' | 'auth' | 'rate-limit' | 'failed'

export class HostingCliError extends Error {
  constructor(
    message: string,
    readonly kind: HostingCliErrorKind,
    readonly tool: HostingTool
  ) {
    super(message)
  }
}

export interface HostingRunOptions {
  /** Killed after this long (default 30s): a hung network call must not freeze the panel. */
  timeoutMs?: number
}

/** Runs gh/glab; swappable so tests can check the exact argv without touching a real host. */
export type HostingRunner = (tool: HostingTool, cwd: string, args: string[], options?: HostingRunOptions) => Promise<string>

const AUTH_PATTERN = /auth login|not logged in|authentication|401 unauthorized|bad credentials|no token|has not been authenticated/i
const RATE_PATTERN = /rate limit|secondary rate|abuse detection|429/i

export function installHint(tool: HostingTool): string {
  return tool === 'gh'
    ? 'GitHub CLI (`gh`) is not installed on this host. Install it, then run `gh auth login`.'
    : 'GitLab CLI (`glab`) is not installed on this host. Install it, then run `glab auth login`.'
}

export function loginHint(tool: HostingTool, host: string | null): string {
  const flag = host && host !== 'github.com' && host !== 'gitlab.com' ? ` --hostname ${host}` : ''
  return `Run \`${tool} auth login${flag}\` on this host to sign in.`
}

function spawnTool(tool: HostingTool, cwd: string, args: string[]) {
  try {
    return Bun.spawn([tool, ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
      windowsHide: true,
      // Prompts and pagers would hang a daemon nobody is watching.
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: '1',
        GH_NO_UPDATE_NOTIFIER: '1',
        GLAB_NO_PROMPT: '1',
        GLAB_CHECK_UPDATE: 'false',
        NO_COLOR: '1',
        PAGER: 'cat',
        GH_PAGER: 'cat',
        GIT_TERMINAL_PROMPT: '0'
      }
    })
  } catch {
    throw new HostingCliError(installHint(tool), 'missing', tool)
  }
}

export const runHostingCli: HostingRunner = async (tool, cwd, args, options = {}) => {
  const proc = spawnTool(tool, cwd, args)
  const timeoutMs = options.timeoutMs ?? 30_000
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]).finally(() => clearTimeout(timer))
  if (timedOut) throw new HostingCliError(`${tool} ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`, 'failed', tool)
  if (code !== 0) {
    const message = stderr.trim() || stdout.trim() || `${tool} ${args[0]} exited with ${code}`
    log(`${tool} ${args.slice(0, 3).join(' ')} failed in ${cwd}: ${message.slice(0, 300)}`)
    const kind = AUTH_PATTERN.test(message) ? 'auth' : RATE_PATTERN.test(message) ? 'rate-limit' : 'failed'
    throw new HostingCliError(message, kind, tool)
  }
  return stdout
}

export function parseJson<T>(text: string): T {
  return JSON.parse(text.trim() || 'null') as T
}
