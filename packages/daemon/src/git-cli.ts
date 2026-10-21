import { log } from './log.ts'

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string
  ) {
    super(message)
  }
}

export interface GitRunOptions {
  /** For probes whose failure is an answer, not an error. */
  quiet?: boolean
  /** Kills git after this long; a stalled network operation must not hang the panel. */
  timeoutMs?: number
}

/** Runs the host's git. stdout is returned trimmed of the trailing newline. */
export async function git(cwd: string, args: string[], options: GitRunOptions = {}): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
    // A credential or editor prompt would hang a daemon nobody is watching.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }
  })
  let timedOut = false
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true
        proc.kill()
      }, options.timeoutMs)
    : null
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]).finally(() => timer && clearTimeout(timer))
  if (timedOut) throw new GitError(`git ${args[0]} timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s`, stderr)
  if (code !== 0) {
    if (!options.quiet) log(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`)
    throw new GitError(stderr.trim() || `git ${args[0]} exited with ${code}`, stderr)
  }
  return stdout.replace(/\n$/, '')
}

export async function isGitRepository(path: string): Promise<boolean> {
  try {
    return (await git(path, ['rev-parse', '--is-inside-work-tree'], { quiet: true })) === 'true'
  } catch {
    return false
  }
}

export async function currentBranch(path: string): Promise<string | null> {
  try {
    const name = await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { quiet: true })
    return name || null
  } catch {
    return null
  }
}

export async function localBranches(path: string): Promise<string[]> {
  const out = await git(path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  return out ? out.split('\n') : []
}

export async function branchExists(path: string, branch: string): Promise<boolean> {
  try {
    await git(path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { quiet: true })
    return true
  } catch {
    return false
  }
}
