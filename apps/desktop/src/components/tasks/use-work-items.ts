import { useCallback, useEffect, useRef, useState } from 'react'
import { HARNESS_METHODS, type HostedWorkItem, type HostingAvailability, type WorkItemKind, type WorkItemPreset } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'

export interface WorkItemsQuery {
  projectId: string | null
  hostId: HostId | null
  kind: WorkItemKind
  preset: WorkItemPreset
  search: string
  limit: number
}

/** A project's issues or reviews from its remote; the daemon caches briefly, so re-asking is cheap. */
export function useWorkItems(query: WorkItemsQuery) {
  const [items, setItems] = useState<HostedWorkItem[] | null>(null)
  const [availability, setAvailability] = useState<HostingAvailability | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const { projectId, hostId, kind, preset, search, limit } = query

  const load = useCallback(() => {
    if (!projectId || !hostId) return
    const id = ++seq.current
    setLoading(true)
    setError(null)
    void harnessRequest(HARNESS_METHODS.hostingWorkItems, { projectId, kind, preset, search, limit }, hostId)
      .then(
        (r) => {
          if (id !== seq.current) return
          setItems(r.items)
          setAvailability(r.availability)
        },
        (e) => id === seq.current && setError(e instanceof Error ? e.message : String(e))
      )
      .finally(() => id === seq.current && setLoading(false))
  }, [projectId, hostId, kind, preset, search, limit])

  useEffect(() => {
    setItems(null)
    load()
  }, [load])

  return { items, availability, loading, error, reload: load }
}
