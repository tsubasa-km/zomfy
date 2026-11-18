import { useState } from 'react'
import { ChevronRight, CircleX, Info, TriangleAlert } from 'lucide-react'
import { openEditorTab } from '@/session-store'
import { countProblems, sortProblems, useWorkspaceProblems, type Problem, type ProblemSeverity } from '@/lib/lsp/problems-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The problems in a workspace's open files, grouped by file; a row opens the file at the problem.
// It lists what the editor has marked, from any source (lib/lsp/problems-feed).

export function SeverityIcon({ severity, className }: { severity: ProblemSeverity; className?: string }) {
  if (severity === 'error') return <CircleX className={cn('text-destructive', className)} />
  if (severity === 'warning') return <TriangleAlert className={cn('text-status-warning', className)} />
  return <Info className={cn('text-muted-foreground', className)} />
}

function ProblemRow({ workspaceId, path, problem }: { workspaceId: string; path: string; problem: Problem }) {
  const detail = [problem.source, problem.code].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      data-problem={problem.severity}
      onClick={() => openEditorTab({ workspaceId, kind: 'file', path, staged: false, line: problem.line })}
      className="flex w-full items-start gap-1.5 py-0.5 pr-2 pl-7 text-left text-xs hover:bg-accent/60"
    >
      <SeverityIcon severity={problem.severity} className="mt-0.5 size-3 shrink-0" />
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap text-foreground">
        {problem.message}
        {detail ? <span className="ml-1.5 text-muted-foreground">{detail}</span> : null}
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {problem.line}:{problem.column}
      </span>
    </button>
  )
}

export function ProblemsPanel({ workspaceId }: { workspaceId: string }) {
  const files = useWorkspaceProblems(workspaceId)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const counts = countProblems(files)
  if (files.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-problems-panel>
        <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">{t('No problems in the open files')}</div>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-problems-panel>
      <div className="border-b border-border px-2 py-1 text-[10px] text-muted-foreground" data-problems-summary>
        {t('{errors} errors, {warnings} warnings in {files} open files', { errors: counts.errors, warnings: counts.warnings, files: files.length })}
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto pb-2">
        {files.map((file) => {
          const slash = file.path.lastIndexOf('/')
          const closed = collapsed[file.path] === true
          return (
            <div key={file.path} data-problem-file={file.path}>
              <button
                type="button"
                aria-expanded={!closed}
                onClick={() => setCollapsed((all) => ({ ...all, [file.path]: !closed }))}
                className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs hover:bg-accent/60"
              >
                <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', !closed && 'rotate-90')} />
                <span className="shrink-0 font-medium text-foreground">{file.path.slice(slash + 1)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{slash === -1 ? '' : file.path.slice(0, slash)}</span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground tabular-nums">{file.problems.length}</span>
              </button>
              {closed ? null : sortProblems(file.problems).map((problem, index) => <ProblemRow key={index} workspaceId={workspaceId} path={file.path} problem={problem} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
