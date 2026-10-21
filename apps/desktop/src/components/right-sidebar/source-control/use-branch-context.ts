import { useCallback, useEffect, useRef, useState } from 'react'
import { HARNESS_METHODS, type GitBranchCompareResult, type GitStatusResult } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { GitHistoryState } from './GitHistoryPanel'

const baseRefKey = (workspaceId: string) => `acp-harness:source-control-base-ref:${workspaceId}`

function readStoredBaseRef(workspaceId: string): string | null {
  try {
    return localStorage.getItem(baseRefKey(workspaceId))
  } catch {
    return null
  }
}

/**
 * Compare-with-base and the commit graph for one workspace. Both reload when HEAD, the upstream
 * or the base ref move (Orca refreshes them off the same status signals).
 */
export function useBranchContext(workspaceId: string, status: GitStatusResult | null) {
  const [baseRef, setBaseRefState] = useState<string | null>(() => readStoredBaseRef(workspaceId))
  const [compare, setCompare] = useState<{ loading: boolean; result: GitBranchCompareResult | null }>({ loading: true, result: null })
  const [history, setHistory] = useState<GitHistoryState>({ status: 'loading' })
  const requestSeq = useRef(0)

  const setBaseRef = useCallback(
    (ref: string | null) => {
      try {
        if (ref) localStorage.setItem(baseRefKey(workspaceId), ref)
        else localStorage.removeItem(baseRefKey(workspaceId))
      } catch {
        // Storage can be unavailable; the choice then lasts for this session only.
      }
      setBaseRefState(ref)
    },
    [workspaceId]
  )

  const refresh = useCallback(() => {
    const seq = ++requestSeq.current
    setCompare((prev) => ({ loading: true, result: prev.result }))
    setHistory((prev) => ({ status: 'loading', result: prev.result }))
    void harnessRequest(HARNESS_METHODS.gitBranchCompare, { workspaceId, baseRef })
      .then((result) => {
        if (seq !== requestSeq.current) return
        setCompare({ loading: false, result })
        return harnessRequest(HARNESS_METHODS.gitHistory, { workspaceId, baseRef: result.summary.baseRef })
      })
      .then(
        (result) => {
          if (seq === requestSeq.current && result) setHistory({ status: 'ready', result })
        },
        (error: unknown) => {
          if (seq !== requestSeq.current) return
          const message = error instanceof Error ? error.message : String(error)
          setCompare((prev) => ({ loading: false, result: prev.result }))
          setHistory((prev) => ({ status: 'error', result: prev.result, error: message }))
        }
      )
  }, [workspaceId, baseRef])

  const isRepo = status?.isRepo ?? false
  const signal = `${status?.head ?? ''}|${status?.branch ?? ''}|${status?.upstream?.upstreamName ?? ''}|${status?.upstream?.ahead ?? ''}|${status?.upstream?.behind ?? ''}`
  useEffect(() => {
    if (isRepo) refresh()
  }, [isRepo, signal, refresh])

  return { baseRef, setBaseRef, compare, history, refresh }
}
