import { useCallback, useEffect, useState } from 'react'
import { HARNESS_METHODS, type GitRepository, type GitStatusResult } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'

const POLL_MS = 3000

/**
 * Git status of a workspace (or of `repo`, a repository below it), refreshed on an interval and
 * whenever the window regains focus.
 */
export function useGitStatus(
  workspaceId: string | null,
  repo = ''
): {
  status: GitStatusResult | null
  refresh: () => void
} {
  const [status, setStatus] = useState<GitStatusResult | null>(null)

  const refresh = useCallback(() => {
    if (!workspaceId) return
    void harnessRequest(HARNESS_METHODS.gitStatus, { workspaceId, repo })
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [workspaceId, repo])

  useEffect(() => {
    setStatus(null)
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  return { status, refresh }
}

/** The workspace's repository and those in folders below it; null until read. Read again on focus. */
export function useGitRepositories(workspaceId: string): GitRepository[] | null {
  const [repositories, setRepositories] = useState<GitRepository[] | null>(null)
  useEffect(() => {
    let live = true
    const read = () =>
      void harnessRequest(HARNESS_METHODS.gitRepositories, { workspaceId })
        .then((r) => live && setRepositories(r.repositories))
        .catch(() => live && setRepositories([]))
    read()
    window.addEventListener('focus', read)
    return () => {
      live = false
      window.removeEventListener('focus', read)
    }
  }, [workspaceId])
  return repositories
}

/** Orca's git decoration letters and colors (FileExplorerRow STATUS_LABELS). */
export const GIT_STATUS_LETTER: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: '!'
}

export const GIT_STATUS_COLOR: Record<string, string> = {
  modified: 'var(--git-decoration-modified)',
  added: 'var(--git-decoration-added)',
  deleted: 'var(--git-decoration-deleted)',
  renamed: 'var(--git-decoration-renamed)',
  untracked: 'var(--git-decoration-untracked)',
  conflicted: 'var(--destructive)'
}
