import { useCallback, useEffect, useState } from 'react'
import { HARNESS_METHODS, type GitStatusResult } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'

const POLL_MS = 3000

/** Git status of a workspace, refreshed on an interval and whenever the window regains focus. */
export function useGitStatus(workspaceId: string | null): {
  status: GitStatusResult | null
  refresh: () => void
} {
  const [status, setStatus] = useState<GitStatusResult | null>(null)

  const refresh = useCallback(() => {
    if (!workspaceId) return
    void harnessRequest(HARNESS_METHODS.gitStatus, { workspaceId })
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [workspaceId])

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
