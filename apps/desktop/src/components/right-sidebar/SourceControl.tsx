import { useState } from 'react'
import { ChevronDown, File, GitBranch, Minus, Plus, RefreshCw } from 'lucide-react'
import { HARNESS_METHODS, type GitChange } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { openEditorTab } from '@/session-store'
import { GIT_STATUS_COLOR, GIT_STATUS_LETTER, useGitStatus } from '@/hooks/use-git-status'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Layout follows Orca's source control panel (source-control/listing/section-header.tsx,
// uncommitted-entry-row.tsx, diff-line-counts.tsx, commit/commit-message-composer.tsx).

export function SourceControl({ workspaceId }: { workspaceId: string }) {
  const { status, refresh } = useGitStatus(workspaceId)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  if (status && !status.isRepo) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">This workspace is not a git repository.</p>
  }

  const staged = status?.staged ?? []
  const unstaged = status?.unstaged ?? []
  const stage = (paths: string[]) => run(() => harnessRequest(HARNESS_METHODS.gitStage, { workspaceId, paths }))
  const unstage = (paths: string[]) => run(() => harnessRequest(HARNESS_METHODS.gitUnstage, { workspaceId, paths }))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3">
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <GitBranch className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{status?.branch ?? '…'}</span>
        </span>
        <button
          type="button"
          aria-label="Refresh source control"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={refresh}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <textarea
          aria-label="Commit message"
          placeholder="Message (Ctrl+Enter to commit)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && staged.length > 0) {
              e.preventDefault()
              void run(async () => {
                await harnessRequest(HARNESS_METHODS.gitCommit, { workspaceId, message })
                setMessage('')
              })
            }
          }}
          className="mt-0.5 min-h-14 w-full resize-none appearance-none rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground shadow-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30"
        />
        <Button
          size="sm"
          className="mt-1.5 w-full"
          disabled={busy || staged.length === 0 || !message.trim()}
          onClick={() =>
            void run(async () => {
              await harnessRequest(HARNESS_METHODS.gitCommit, { workspaceId, message })
              setMessage('')
            })
          }
        >
          Commit{staged.length > 0 ? ` (${staged.length})` : ''}
        </Button>
        {error && <p className="mt-1.5 text-xs break-words text-destructive">{error}</p>}
      </div>

      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto pb-2">
        {status === null && <p className="px-3 text-xs text-muted-foreground">Loading…</p>}
        <ChangeSection
          label="Staged Changes"
          changes={staged}
          workspaceId={workspaceId}
          staged
          actionLabel="Unstage"
          onAction={unstage}
        />
        <ChangeSection
          label="Changes"
          changes={unstaged}
          workspaceId={workspaceId}
          staged={false}
          actionLabel="Stage"
          onAction={stage}
        />
        {status && staged.length + unstaged.length === 0 && (
          <p className="px-3 pt-3 text-xs text-muted-foreground">No changes.</p>
        )}
      </div>
    </div>
  )
}

function ChangeSection({
  label,
  changes,
  workspaceId,
  staged,
  actionLabel,
  onAction
}: {
  label: string
  changes: GitChange[]
  workspaceId: string
  staged: boolean
  actionLabel: 'Stage' | 'Unstage'
  onAction: (paths: string[]) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  if (changes.length === 0) return null
  const ActionIcon = actionLabel === 'Stage' ? Plus : Minus

  return (
    <section>
      <div className="pt-3 pr-3 pb-1 pl-1">
        <div className="group/section flex items-center gap-x-1 rounded-md pr-1 hover:bg-accent hover:text-accent-foreground">
          <button
            type="button"
            className="flex min-h-6 min-w-0 flex-1 items-center gap-x-1 py-0.5 text-left text-xs font-semibold tracking-wider text-foreground/70 uppercase group-hover/section:text-accent-foreground"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', collapsed && '-rotate-90')} />
            <span className="min-w-0 truncate">{label}</span>
            <span className="shrink-0 text-[11px] font-medium tabular-nums">{changes.length}</span>
          </button>
          <button
            type="button"
            aria-label={`${actionLabel} all`}
            className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/section:opacity-100 hover:text-foreground"
            onClick={() => onAction(changes.map((c) => c.path))}
          >
            <ActionIcon className="size-3.5" />
          </button>
        </div>
      </div>
      {!collapsed &&
        changes.map((change) => {
          const slash = change.path.lastIndexOf('/')
          const fileName = change.path.slice(slash + 1)
          const dirPath = slash >= 0 ? change.path.slice(0, slash) : ''
          return (
            <div
              key={`${staged}:${change.path}`}
              role="button"
              tabIndex={0}
              data-change-path={change.path}
              data-change-staged={staged}
              className="group/row relative flex cursor-pointer items-center gap-1.5 py-1 pr-3 pl-6 hover:bg-accent"
              onClick={() => openEditorTab({ workspaceId, kind: 'diff', path: change.path, staged })}
            >
              <File className="size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 text-xs">
                <span className="block min-w-0 truncate">
                  <span className="text-foreground">{fileName}</span>
                  {dirPath && <span className="ml-1.5 text-[11px] text-muted-foreground">{dirPath}</span>}
                </span>
              </div>
              {change.additions !== null && (
                <span className="shrink-0 text-[10px] tabular-nums">
                  <span style={{ color: 'var(--git-decoration-added)' }}>+{change.additions}</span>{' '}
                  <span style={{ color: 'var(--git-decoration-deleted)' }}>-{change.deletions}</span>
                </span>
              )}
              <button
                type="button"
                aria-label={`${actionLabel} ${change.path}`}
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-background hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  onAction([change.path])
                }}
              >
                <ActionIcon className="size-3.5" />
              </button>
              <span
                className="w-4 shrink-0 text-center text-[10px] font-bold"
                style={{ color: GIT_STATUS_COLOR[change.status] }}
              >
                {GIT_STATUS_LETTER[change.status]}
              </span>
            </div>
          )
        })}
    </section>
  )
}
