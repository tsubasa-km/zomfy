import type { HostingAvailability, HostingProviderId } from '@acp-harness/protocol'
import { git, isGitRepository } from './git-cli.ts'
import { TtlCache } from './hosting-cache.ts'
import { runHostingCli } from './hosting-cli.ts'

export interface HostingRemote {
  provider: HostingProviderId
  host: string
  /** `owner/repo` or the GitLab group/project path. */
  path: string
  /** Git remote name the URL came from (usually origin). */
  remote: string
}

/** Host and repository path from an https, ssh or scp-style remote URL. */
export function parseRemoteUrl(url: string): { host: string; path: string } | null {
  const trimmed = url.trim()
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(trimmed)
  let host: string
  let path: string
  if (/^[a-z+]+:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      host = parsed.hostname
      path = decodeURIComponent(parsed.pathname)
    } catch {
      return null
    }
  } else if (scp) {
    host = scp[1]!
    path = scp[2]!
  } else {
    return null
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
  return host && path.includes('/') ? { host: host.toLowerCase(), path } : null
}

const hostProbes = new TtlCache<HostingProviderId | null>(10 * 60_000)

/** github.com/gitlab.com by name; a self-hosted name is whichever CLI has a login for it. */
async function providerForHost(host: string, cwd: string): Promise<HostingProviderId | null> {
  if (host === 'github.com' || host.endsWith('.github.com') || host.includes('github')) return 'github'
  if (host === 'gitlab.com' || host.includes('gitlab')) return 'gitlab'
  return hostProbes.get(host, async () => {
    const signedIn = (tool: 'gh' | 'glab') =>
      runHostingCli(tool, cwd, ['auth', 'status', '--hostname', host], { timeoutMs: 10_000 }).then(
        () => true,
        () => false
      )
    if (await signedIn('glab')) return 'gitlab'
    if (await signedIn('gh')) return 'github'
    return null
  })
}

const remotes = new TtlCache<{ availability: HostingAvailability; remote: HostingRemote | null }>(5 * 60_000)

/** Which provider hosts this checkout, from its `origin` (or first) remote. */
export function resolveHostingRemote(
  cwd: string,
  force = false
): Promise<{ availability: HostingAvailability; remote: HostingRemote | null }> {
  return remotes.get(
    cwd,
    async () => {
      const none = (state: HostingAvailability['state'], message?: string) => ({
        availability: { state, provider: null, repo: null, host: null, message },
        remote: null
      })
      if (!(await isGitRepository(cwd))) return none('not-git', 'Not a git repository.')
      const names = (await git(cwd, ['remote'], { quiet: true }).catch(() => '')).split('\n').filter(Boolean)
      const remote = names.includes('origin') ? 'origin' : names[0]
      if (!remote) return none('no-remote', 'This repository has no remote. Publish it to GitHub or GitLab first.')
      const url = await git(cwd, ['remote', 'get-url', remote], { quiet: true }).catch(() => '')
      const parsed = parseRemoteUrl(url)
      const provider = parsed ? await providerForHost(parsed.host, cwd) : null
      if (!parsed || !provider) {
        return {
          availability: {
            state: 'unsupported-remote' as const,
            provider: null,
            repo: parsed?.path ?? null,
            host: parsed?.host ?? null,
            message: `${remote} (${url || 'no URL'}) is not a GitHub or GitLab repository this host's gh/glab knows.`
          },
          remote: null
        }
      }
      return {
        availability: { state: 'ready' as const, provider, repo: parsed.path, host: parsed.host },
        remote: { provider, host: parsed.host, path: parsed.path, remote }
      }
    },
    force
  )
}
