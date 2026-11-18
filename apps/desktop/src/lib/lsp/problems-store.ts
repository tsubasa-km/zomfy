import { useMemo } from 'react'
import { useStore } from '@/session-store'
import { createExternalStore } from '@/stores/external-store'

// The problems the editor knows about in workspace files: errors, warnings and notes from whatever
// marked them (a language server, Monaco's own services, a linter for one kind of file). This store
// holds no editor code, so the status bar can read it without loading the editor; problems-feed
// fills it once an editor exists.

export type ProblemSeverity = 'error' | 'warning' | 'info'

export interface Problem {
  severity: ProblemSeverity
  message: string
  /** Who reported it ("rust-analyzer", "ts"), when it says. */
  source: string | null
  code: string | null
  line: number
  column: number
}

export interface ProblemFile {
  workspaceId: string
  /** Workspace-relative, '/'-separated. */
  path: string
  problems: Problem[]
}

const store = createExternalStore<ProblemFile[]>([])

export function setProblemFiles(files: ProblemFile[]): void {
  store.set(files)
}

const SEVERITY_ORDER: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 }

/** Worst first, then top to bottom. */
export function sortProblems(problems: Problem[]): Problem[] {
  return [...problems].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line || a.column - b.column)
}

export function countProblems(files: ProblemFile[]): { errors: number; warnings: number; infos: number } {
  const counts = { errors: 0, warnings: 0, infos: 0 }
  for (const file of files) {
    for (const problem of file.problems) {
      if (problem.severity === 'error') counts.errors++
      else if (problem.severity === 'warning') counts.warnings++
      else counts.infos++
    }
  }
  return counts
}

/** The problems in a workspace's open files, by file. A file whose tab closed drops out even if its marks linger. */
export function useWorkspaceProblems(workspaceId: string | null): ProblemFile[] {
  const files = store.use((all) => all)
  const tabs = useStore((s) => s.editorTabs)
  return useMemo(() => {
    if (!workspaceId) return []
    const open = new Set(tabs.filter((tab) => tab.kind === 'file' && tab.workspaceId === workspaceId).map((tab) => tab.path))
    return files.filter((file) => file.workspaceId === workspaceId && open.has(file.path)).sort((a, b) => a.path.localeCompare(b.path))
  }, [files, tabs, workspaceId])
}
