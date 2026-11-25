import { useEffect } from 'react'
import { HARNESS_METHODS } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, useStore } from '@/session-store'
import { setSizes, setSummaries } from '@/stores/sidebar-store'

// Each workspace costs several git processes, so the timer stays slow; state changes refresh sooner.
const POLL_MS = 30_000
// Sizes are measured in the background on the daemon; asking only reads what it has.
const SIZE_POLL_MS = 10 * 60_000

/** Diff stats and ahead/behind for every connected host, refreshed on a timer and on state changes. */
export function useWorkspaceSummaries(): void {
  // Workspaces added, removed or re-pointed change this key; agent chatter does not.
  const key = useStore((s) =>
    Object.values(s.hosts)
      .filter((h) => h.connection.kind === 'connected')
      .map((h) => `${h.id}:${h.harness?.workspaces.map((w) => w.id).join(',')}`)
      .join('|')
  )
  // A finished turn usually changed files.
  const working = useStore((s) => s.sessions.filter((x) => x.status === 'working').length)

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      if (document.visibilityState === 'hidden') return
      for (const host of Object.values(getState().hosts)) {
        if (host.connection.kind !== 'connected') continue
        const ids = host.harness?.workspaces.map((w) => w.id) ?? []
        try {
          const list = await harnessRequest(HARNESS_METHODS.workspaceSummaries, {}, host.id)
          if (!cancelled) setSummaries(ids, list)
        } catch {
          // An older daemon without summaries, or one going away: the badges just stay empty.
        }
      }
    }
    const debounce = setTimeout(() => void refresh(), 300)
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(debounce)
      clearInterval(timer)
    }
  }, [key, working])

  useEffect(() => {
    async function refresh() {
      if (document.visibilityState === 'hidden') return
      for (const host of Object.values(getState().hosts)) {
        if (host.connection.kind !== 'connected') continue
        // An older daemon has no sizes: the cards just show none.
        await harnessRequest(HARNESS_METHODS.workspaceSizes, {}, host.id).then(setSizes, () => undefined)
      }
    }
    const first = setTimeout(() => void refresh(), 5_000)
    const timer = setInterval(() => void refresh(), SIZE_POLL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [key])
}
