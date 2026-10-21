import { useEffect, useRef } from 'react'
import { HARNESS_METHODS, type FileStat } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'

const POLL_MS = 2000

/** Polls the open file's stat (the daemon has no watcher) and reports each change once. */
export function useFileDiskWatch({
  workspaceId,
  path,
  knownMtimeMs,
  enabled,
  onChange
}: {
  workspaceId: string
  path: string
  /** The disk version the tab holds; updated by the caller after loads and saves. */
  knownMtimeMs: React.RefObject<number | undefined>
  enabled: boolean
  onChange: (stat: FileStat) => void
}): void {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!enabled) return
    let reported: number | undefined
    let busy = false
    const check = (): void => {
      if (busy || document.visibilityState !== 'visible' || knownMtimeMs.current === undefined) return
      busy = true
      void harnessRequest(HARNESS_METHODS.fsStat, { workspaceId, path })
        .then((stat) => {
          const known = knownMtimeMs.current
          if (known === undefined) return
          const mtime = stat.exists ? stat.mtimeMs : -1
          if (Math.abs(mtime - known) <= 1 || mtime === reported) return
          reported = mtime
          onChangeRef.current(stat)
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false
        })
    }
    const timer = window.setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [workspaceId, path, knownMtimeMs, enabled])
}
