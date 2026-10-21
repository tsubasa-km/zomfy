import { useCallback, useEffect, useRef, useState } from 'react'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { DropdownActionKind, PrimaryActionKind, RemoteOpKind } from './source-control-actions'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const OP_FAILURE: Record<RemoteOpKind, string> = {
  push: 'Push failed',
  force_push: 'Force push failed',
  pull: 'Pull failed',
  fast_forward: 'Fast-forward failed',
  sync: 'Sync failed',
  fetch: 'Fetch failed',
  publish: 'Publish failed'
}

/**
 * Everything that writes to the branch: commit (plain, amend, then push or sync), the remote
 * operations, and AI message generation. One operation at a time, like Orca's commit area.
 */
export function useCommitFlows({
  workspaceId,
  message,
  setMessage,
  stagedCount,
  stageAll,
  onSettled
}: {
  workspaceId: string
  message: string
  setMessage: (message: string) => void
  stagedCount: number
  stageAll: () => Promise<void>
  onSettled: () => void
}) {
  const [isCommitting, setIsCommitting] = useState(false)
  const [remoteOp, setRemoteOp] = useState<RemoteOpKind | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const generationSeq = useRef(0)

  const runRemote = useCallback(
    async (op: RemoteOpKind): Promise<boolean> => {
      setRemoteOp(op)
      setRemoteError(null)
      try {
        if (op === 'push' || op === 'publish') await harnessRequest(HARNESS_METHODS.gitPush, { workspaceId })
        else if (op === 'force_push') await harnessRequest(HARNESS_METHODS.gitPush, { workspaceId, forceWithLease: true })
        else if (op === 'pull') await harnessRequest(HARNESS_METHODS.gitPull, { workspaceId })
        else if (op === 'fast_forward') await harnessRequest(HARNESS_METHODS.gitPull, { workspaceId, ffOnly: true })
        else if (op === 'sync') await harnessRequest(HARNESS_METHODS.gitSync, { workspaceId })
        else await harnessRequest(HARNESS_METHODS.gitFetch, { workspaceId })
        return true
      } catch (e) {
        setRemoteError(`${OP_FAILURE[op]}: ${errorText(e)}`)
        return false
      } finally {
        setRemoteOp(null)
        onSettled()
      }
    },
    [workspaceId, onSettled]
  )

  const cancelGenerate = useCallback(() => {
    if (!generating) return
    generationSeq.current++
    setGenerating(false)
    void harnessRequest(HARNESS_METHODS.gitCancelCommitMessage, { workspaceId }).catch(() => {})
  }, [generating, workspaceId])

  const commit = useCallback(
    async (options: { amend?: boolean } = {}): Promise<boolean> => {
      // Committing the box's own message makes a running generation moot.
      cancelGenerate()
      setIsCommitting(true)
      setCommitError(null)
      try {
        await harnessRequest(HARNESS_METHODS.gitCommit, { workspaceId, message, amend: options.amend })
        setMessage('')
        return true
      } catch (e) {
        setCommitError(errorText(e))
        return false
      } finally {
        setIsCommitting(false)
        onSettled()
      }
    },
    [cancelGenerate, workspaceId, message, setMessage, onSettled]
  )

  const runPrimary = useCallback(
    async (kind: PrimaryActionKind) => {
      if (kind === 'commit') await commit()
      else if (kind === 'stage') await stageAll()
      else await runRemote(kind)
    },
    [commit, stageAll, runRemote]
  )

  const runDropdown = useCallback(
    async (kind: DropdownActionKind) => {
      if (kind === 'commit') await commit()
      else if (kind === 'amend') await commit({ amend: true })
      else if (kind === 'commit_push') {
        if (await commit()) await runRemote('push')
      } else if (kind === 'commit_sync') {
        if (await commit()) await runRemote('sync')
      } else await runRemote(kind)
    },
    [commit, runRemote]
  )

  const generate = useCallback(async () => {
    const seq = ++generationSeq.current
    setGenerating(true)
    setGenerateError(null)
    try {
      const { message: generated } = await harnessRequest(HARNESS_METHODS.gitGenerateCommitMessage, { workspaceId })
      if (seq === generationSeq.current) setMessage(generated)
    } catch (e) {
      if (seq === generationSeq.current) setGenerateError(`Couldn't generate a commit message: ${errorText(e)}`)
    } finally {
      if (seq === generationSeq.current) setGenerating(false)
    }
  }, [workspaceId, setMessage])

  // Unstaging everything leaves nothing to commit, so an old commit error no longer applies.
  useEffect(() => {
    if (stagedCount === 0) setCommitError(null)
  }, [stagedCount])

  return {
    isCommitting,
    remoteOp,
    commitError,
    remoteError,
    generating,
    generateError,
    runPrimary,
    runDropdown,
    commit,
    generate,
    cancelGenerate
  }
}
