import { useEffect, useState } from 'react'
import { ChevronDown, FileDiff, LoaderCircle } from 'lucide-react'
import { HARNESS_METHODS, type HostedReview, type HostedReviewFile } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { openEditorTab } from '@/session-store'
import { cn } from '@/lib/utils'
import { reviewNumberLabel, reviewShortLabel } from './review-presentation'
import { t } from '@/i18n/i18n'

// Orca's PullRequestPage "Files changed": each file opens in the editor's diff tab, comparing the
// review's merge base with its head.

const STATUS_LETTER: Record<HostedReviewFile['status'], { letter: string; color: string }> = {
  added: { letter: 'A', color: 'var(--git-decoration-added)' },
  modified: { letter: 'M', color: 'var(--git-decoration-modified)' },
  deleted: { letter: 'D', color: 'var(--git-decoration-deleted)' },
  renamed: { letter: 'R', color: 'var(--git-decoration-renamed)' }
}

interface Loaded {
  files: HostedReviewFile[]
  base: string
  head: string
}

export function openReviewFileDiff(workspaceId: string, review: HostedReview, revisions: { base: string; head: string }, path: string, line?: number): void {
  openEditorTab({
    workspaceId,
    kind: 'diff',
    path,
    staged: false,
    ...(line ? { line } : {}),
    compare: { base: revisions.base, head: revisions.head, label: `${reviewShortLabel(review.provider)} ${reviewNumberLabel(review)}` }
  })
}

/** Loads a review's changed files with the revisions to diff them (fetching the head when missing). */
export function useReviewFiles(workspaceId: string, review: HostedReview, enabled: boolean) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setError(null)
    void harnessRequest(HARNESS_METHODS.hostingReviewFiles, { workspaceId, number: review.number }).then(
      (r) => !cancelled && setLoaded(r),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e))
    )
    return () => {
      cancelled = true
    }
  }, [workspaceId, review.number, review.headSha, enabled])
  return { loaded, error }
}

export function ReviewFilesSection({ workspaceId, review }: { workspaceId: string; review: HostedReview }) {
  const [expanded, setExpanded] = useState(false)
  const { loaded, error } = useReviewFiles(workspaceId, review, expanded)
  return (
    <div className="border-b border-border" data-review-files>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', !expanded && '-rotate-90')} />
        <FileDiff className="size-3.5 shrink-0" />
        <span>{t('Files changed')}</span>
        {loaded && <span className="tabular-nums">{loaded.files.length}</span>}
        <span className="flex-1" />
        {expanded && !loaded && !error && <LoaderCircle className="size-3 animate-spin" />}
      </button>
      {expanded && error && <div className="px-3 pb-2 text-[11px] break-words text-destructive">{error}</div>}
      {expanded && loaded && (
        <ul className="pb-1">
          {loaded.files.length === 0 && <li className="px-6 py-1 text-[11px] text-muted-foreground">{t('No changed files')}</li>}
          {loaded.files.map((file) => {
            const slash = file.path.lastIndexOf('/')
            const status = STATUS_LETTER[file.status]
            return (
              <li key={file.path}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-1.5 px-3 py-0.5 pl-6 text-left text-[12px] hover:bg-accent/40"
                  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                  onClick={() => openReviewFileDiff(workspaceId, review, loaded, file.path)}
                  data-review-file={file.path}
                >
                  <span className="truncate text-foreground">{file.path.slice(slash + 1)}</span>
                  {slash > 0 && <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{file.path.slice(0, slash)}</span>}
                  {slash <= 0 && <span className="flex-1" />}
                  {(file.additions !== null || file.deletions !== null) && (
                    <span className="shrink-0 font-mono text-[10px] tabular-nums">
                      <span style={{ color: 'var(--git-decoration-added)' }}>+{file.additions ?? 0}</span>{' '}
                      <span style={{ color: 'var(--git-decoration-deleted)' }}>-{file.deletions ?? 0}</span>
                    </span>
                  )}
                  <span className="w-3 shrink-0 text-center font-mono text-[10px] font-semibold" style={{ color: status.color }}>
                    {status.letter}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
