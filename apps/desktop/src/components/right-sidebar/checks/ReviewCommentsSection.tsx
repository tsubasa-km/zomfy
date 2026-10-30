import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ExternalLink, LoaderCircle, MessageSquare, RefreshCw } from 'lucide-react'
import { HARNESS_METHODS, type HostedReview, type HostedReviewComment } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allWorkspaces, getState } from '@/session-store'
import { SendToAgentMenu } from '@/components/SendToAgentMenu'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { buildReviewCommentsPrompt } from './review-agent-prompts'
import { openExternal, relativeTime } from './review-presentation'
import { openReviewFileDiff } from './ReviewFilesSection'
import { t } from '@/i18n/i18n'

// Orca's checks-panel comments-list.tsx: conversation, review verdicts and line comments, with
// selected comments handed to an agent ("Resolve with AI").

const REVIEW_STATE_LABEL: Record<string, string> = {
  APPROVED: t('approved'),
  CHANGES_REQUESTED: t('requested changes'),
  COMMENTED: t('reviewed'),
  DISMISSED: t('dismissed')
}

export function ReviewCommentsSection({ workspaceId, review }: { workspaceId: string; review: HostedReview }) {
  const [expanded, setExpanded] = useState(true)
  const [comments, setComments] = useState<HostedReviewComment[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    void harnessRequest(HARNESS_METHODS.hostingReviewComments, { workspaceId, number: review.number })
      .then((r) => setComments(r.comments), (e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [workspaceId, review.number])

  useEffect(() => {
    setComments(null)
    setSelected(new Set())
    load()
  }, [load])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function openLine(comment: HostedReviewComment) {
    if (!comment.path) return
    const revisions = await harnessRequest(HARNESS_METHODS.hostingReviewFiles, { workspaceId, number: review.number })
    openReviewFileDiff(workspaceId, review, revisions, comment.path, comment.line ?? undefined)
  }

  const kindLabel = review.provider === 'gitlab' ? 'MR' : 'PR'
  return (
    <div className="border-b border-border" data-review-comments>
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn('size-3 shrink-0 transition-transform', !expanded && '-rotate-90')} />
          <MessageSquare className="size-3.5 shrink-0" />
          <span>{t('Comments')}</span>
          {comments && <span className="tabular-nums">{comments.length}</span>}
        </button>
        <SendToAgentMenu
          workspaceId={workspaceId}
          count={selected.size}
          tooltip={t('Send selected {kind} comments to an agent', { kind: kindLabel })}
          disabledTooltip={t('Select comments to send to an agent')}
          buildPrompt={() => {
            const picked = (comments ?? []).filter((c) => selected.has(c.id))
            if (picked.length === 0) return null
            const path = allWorkspaces(getState()).find((w) => w.id === workspaceId)?.path ?? null
            return buildReviewCommentsPrompt(review, picked, path)
          }}
          onSent={() => setSelected(new Set())}
        />
        <button
          type="button"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          title={t('Refresh comments')}
          aria-label={t('Refresh comments')}
          disabled={loading}
          onClick={load}
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
        </button>
      </div>
      {expanded && (
        <div className="pb-1">
          {loading && !comments && (
            <div className="flex justify-center py-3">
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && <div className="px-3 pb-2 text-[11px] break-words text-destructive">{error}</div>}
          {comments && comments.length === 0 && <div className="px-6 pb-2 text-[11px] text-muted-foreground">{t('No comments yet')}</div>}
          {comments?.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              selected={selected.has(comment.id)}
              onToggle={() => toggle(comment.id)}
              onOpenLine={() => void openLine(comment).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CommentRow({
  comment,
  selected,
  onToggle,
  onOpenLine
}: {
  comment: HostedReviewComment
  selected: boolean
  onToggle: () => void
  onOpenLine: () => void
}) {
  const [full, setFull] = useState(false)
  const verdict = comment.kind === 'review' && comment.reviewState ? REVIEW_STATE_LABEL[comment.reviewState] ?? comment.reviewState.toLowerCase() : null
  return (
    <div className={cn('group flex gap-2 px-3 py-1.5 hover:bg-accent/30', selected && 'bg-accent/25')} data-review-comment={comment.kind}>
      <Checkbox className="mt-0.5" checked={selected} onCheckedChange={onToggle} aria-label={t('Select comment')} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <span className="truncate font-semibold text-foreground">{comment.author ?? t('unknown')}</span>
          {verdict && <span className="shrink-0 text-muted-foreground">{verdict}</span>}
          {comment.resolved && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{t('resolved')}</span>}
          <span className="shrink-0 text-muted-foreground">{relativeTime(comment.createdAt)}</span>
          <span className="flex-1" />
          {comment.url && (
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
              aria-label={t('Open comment')}
              onClick={() => openExternal(comment.url!)}
            >
              <ExternalLink className="size-3" />
            </button>
          )}
        </div>
        {comment.path && (
          <button
            type="button"
            className="block max-w-full truncate font-mono text-[10px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
            onClick={onOpenLine}
          >
            {comment.path}
            {comment.line ? `:${comment.line}` : ''}
          </button>
        )}
        {comment.body.trim() && (
          <button type="button" className="block w-full text-left" onClick={() => setFull((v) => !v)} title={full ? t('Show less') : t('Show more')}>
            <span className={cn('block text-[12px] leading-snug break-words whitespace-pre-wrap text-foreground', !full && 'line-clamp-4')}>
              {comment.body.trim()}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
