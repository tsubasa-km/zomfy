import { useEffect } from 'react'
import {
  HARNESS_METHODS,
  type HostedCheck,
  type HostedChecksStatus,
  type HostedReview,
  type HostingAvailability
} from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, useStore } from '@/session-store'
import { createExternalStore } from './external-store'

// The workspace branch's PR/MR and its CI checks, shared by the Checks panel, the source-control
// header and the sidebar cards. The daemon caches too; these intervals keep gh/glab traffic low.

/** Orca refreshes a visible review on a slow cadence; checks only while something is still running. */
const REVIEW_STALE_MS = 60_000
const REVIEW_POLL_MS = 120_000
const CHECKS_POLL_MS = 30_000
const CARD_POLL_MS = 180_000

export interface WorkspaceReviewEntry {
  availability: HostingAvailability | null
  branch: string | null
  review: HostedReview | null
  loading: boolean
  error: string | null
  fetchedAt: number
  checks: HostedCheck[] | null
  checksStatus: HostedChecksStatus | null
  checksLoading: boolean
  checksError: string | null
}

interface HostingState {
  byWorkspace: Record<string, WorkspaceReviewEntry>
  /** From the batched sidebar lookup; a panel lookup for the same workspace wins. */
  cards: Record<string, HostedReview>
}

const EMPTY_ENTRY: WorkspaceReviewEntry = {
  availability: null,
  branch: null,
  review: null,
  loading: false,
  error: null,
  fetchedAt: 0,
  checks: null,
  checksStatus: null,
  checksLoading: false,
  checksError: null
}

const store = createExternalStore<HostingState>({ byWorkspace: {}, cards: {} })

function patch(workspaceId: string, change: Partial<WorkspaceReviewEntry>): void {
  store.update((s) => ({
    ...s,
    byWorkspace: { ...s.byWorkspace, [workspaceId]: { ...(s.byWorkspace[workspaceId] ?? EMPTY_ENTRY), ...change } }
  }))
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function useWorkspaceReview(workspaceId: string): WorkspaceReviewEntry {
  return store.use((s) => s.byWorkspace[workspaceId] ?? EMPTY_ENTRY)
}

/** The review a sidebar card shows: the panel's fresher answer, else the batched one. */
export function useCardReview(workspaceId: string): HostedReview | null {
  return store.use((s) => {
    const entry = s.byWorkspace[workspaceId]
    return entry && entry.fetchedAt > 0 ? entry.review : (s.cards[workspaceId] ?? null)
  })
}

export async function loadReview(workspaceId: string, force = false): Promise<void> {
  const current = store.get().byWorkspace[workspaceId]
  if (current?.loading) return
  patch(workspaceId, { loading: true, error: null })
  try {
    const result = await harnessRequest(HARNESS_METHODS.hostingReview, { workspaceId, force })
    const sameReview = current?.review?.number === result.review?.number
    patch(workspaceId, {
      ...result,
      loading: false,
      fetchedAt: Date.now(),
      // A different (or no) review makes the old checks meaningless.
      ...(sameReview ? {} : { checks: null, checksStatus: null, checksError: null })
    })
  } catch (e) {
    patch(workspaceId, { loading: false, error: message(e), fetchedAt: Date.now() })
  }
}

const checksInFlight = new Map<string, number>()

export async function loadChecks(workspaceId: string, force = false): Promise<void> {
  const entry = store.get().byWorkspace[workspaceId]
  const number = entry?.review?.number
  if (!number || (entry.checksLoading && checksInFlight.get(workspaceId) === number)) return
  checksInFlight.set(workspaceId, number)
  patch(workspaceId, { checksLoading: true, checksError: null })
  // A reply for a review the workspace has since moved off must not land on the new one.
  const current = () => checksInFlight.get(workspaceId) === number && store.get().byWorkspace[workspaceId]?.review?.number === number
  try {
    const result = await harnessRequest(HARNESS_METHODS.hostingChecks, { workspaceId, number, force })
    if (current()) patch(workspaceId, { checks: result.checks, checksStatus: result.status, checksLoading: false })
  } catch (e) {
    if (current()) patch(workspaceId, { checksLoading: false, checksError: message(e) })
  } finally {
    if (checksInFlight.get(workspaceId) === number) checksInFlight.delete(workspaceId)
  }
}

export function setReviewAfterCreate(workspaceId: string, review: HostedReview | null): void {
  patch(workspaceId, { review, fetchedAt: Date.now(), checks: null, checksStatus: null })
}

/** Keeps a visible workspace's review fresh and polls checks only while some are pending. */
export function useReviewPolling(workspaceId: string, active: boolean): void {
  const pending = store.use((s) => {
    const entry = s.byWorkspace[workspaceId]
    return (entry?.checksStatus ?? entry?.review?.checksStatus) === 'pending'
  })
  const number = store.use((s) => s.byWorkspace[workspaceId]?.review?.number ?? null)

  useEffect(() => {
    if (!active) return
    const entry = store.get().byWorkspace[workspaceId]
    if (!entry || Date.now() - entry.fetchedAt > REVIEW_STALE_MS) void loadReview(workspaceId)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadReview(workspaceId)
    }, REVIEW_POLL_MS)
    return () => clearInterval(timer)
  }, [workspaceId, active])

  useEffect(() => {
    if (!active || number === null) return
    void loadChecks(workspaceId)
    if (!pending) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadChecks(workspaceId, true)
    }, CHECKS_POLL_MS)
    return () => clearInterval(timer)
  }, [workspaceId, active, number, pending])
}

/** One batched review lookup per project for the sidebar cards, refreshed slowly. */
export function useCardReviewSummaries(): void {
  const key = useStore((s) =>
    Object.values(s.hosts)
      .filter((h) => h.connection.kind === 'connected')
      .map((h) => `${h.id}:${h.harness?.workspaces.map((w) => `${w.id}=${w.branch}`).join(',')}`)
      .join('|')
  )
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      if (document.visibilityState === 'hidden') return
      const cards: Record<string, HostedReview> = {}
      for (const host of Object.values(getState().hosts)) {
        if (host.connection.kind !== 'connected') continue
        try {
          for (const { workspaceId, review } of await harnessRequest(HARNESS_METHODS.hostingReviewSummaries, {}, host.id)) {
            cards[workspaceId] = review
          }
        } catch {
          // An older daemon or a host without gh/glab: cards just show no review.
        }
      }
      if (!cancelled) store.update((s) => ({ ...s, cards }))
    }
    const debounce = setTimeout(() => void refresh(), 1500)
    const timer = setInterval(() => void refresh(), CARD_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(debounce)
      clearInterval(timer)
    }
  }, [key])
}
