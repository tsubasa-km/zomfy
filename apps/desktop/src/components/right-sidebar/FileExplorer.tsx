import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen, Link, Loader2, RefreshCw } from 'lucide-react'
import { HARNESS_METHODS, type FileEntry, type GitChange } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { openEditorTab } from '@/session-store'
import { GIT_STATUS_COLOR, GIT_STATUS_LETTER, useGitStatus } from '@/hooks/use-git-status'
import { cn } from '@/lib/utils'

// Rows follow Orca's FileExplorerRow (right-sidebar/FileExplorerRow.tsx): 16px indent per level,
// chevron + folder glyph, git decoration color and letter on the right.

export function FileExplorer({ workspaceId, rootName }: { workspaceId: string; rootName: string }) {
  const [children, setChildren] = useState<Record<string, FileEntry[] | 'loading' | { error: string }>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const [selected, setSelected] = useState<string | null>(null)
  const { status, refresh: refreshGit } = useGitStatus(workspaceId)

  const load = useCallback(
    (dir: string) => {
      setChildren((c) => ({ ...c, [dir]: c[dir] && c[dir] !== 'loading' ? c[dir] : 'loading' }))
      void harnessRequest(HARNESS_METHODS.fsList, { workspaceId, dir })
        .then((entries) => setChildren((c) => ({ ...c, [dir]: entries })))
        .catch((e: unknown) =>
          setChildren((c) => ({ ...c, [dir]: { error: e instanceof Error ? e.message : String(e) } }))
        )
    },
    [workspaceId]
  )

  useEffect(() => {
    setChildren({})
    setExpanded(new Set(['']))
    load('')
  }, [load])

  function refreshAll() {
    for (const dir of expanded) load(dir)
    refreshGit()
  }

  function toggle(dir: string) {
    const next = new Set(expanded)
    if (next.has(dir)) next.delete(dir)
    else {
      next.add(dir)
      load(dir)
    }
    setExpanded(next)
  }

  const changes = new Map<string, GitChange>()
  for (const change of [...(status?.staged ?? []), ...(status?.unstaged ?? [])]) changes.set(change.path, change)

  function renderDir(dir: string, depth: number): React.ReactNode {
    const entries = children[dir]
    if (entries === undefined || entries === 'loading') {
      return depth === 0 ? (
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading…
        </div>
      ) : null
    }
    if ('error' in entries) {
      return <div className="px-3 py-1 text-xs text-destructive" style={{ paddingLeft: depth * 16 + 8 }}>{entries.error}</div>
    }
    return entries.map((entry) => {
      const isDir = entry.kind === 'dir'
      const isOpen = expanded.has(entry.path)
      const change = changes.get(entry.path) ?? (isDir ? dirChange(entry.path, changes) : undefined)
      const color = change ? GIT_STATUS_COLOR[change.status] : undefined
      return (
        <div key={entry.path}>
          <button
            type="button"
            data-file-explorer-row=""
            data-path={entry.path}
            data-selected={selected === entry.path ? 'true' : undefined}
            className={cn(
              'flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-xs transition-colors',
              selected === entry.path ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-foreground'
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => {
              setSelected(entry.path)
              if (isDir) toggle(entry.path)
              else openEditorTab({ workspaceId, kind: 'file', path: entry.path, staged: false })
            }}
          >
            {isDir ? (
              <>
                <ChevronRight
                  className={cn('size-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')}
                />
                {children[entry.path] === 'loading' ? (
                  <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                ) : isOpen ? (
                  <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="size-3 shrink-0 text-muted-foreground" />
                )}
              </>
            ) : (
              <>
                <span className="size-3 shrink-0" />
                {entry.kind === 'symlink' ? (
                  <Link className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <File className="size-3 shrink-0 text-muted-foreground" />
                )}
              </>
            )}
            <span className="truncate" style={color ? { color } : undefined}>
              {entry.name}
            </span>
            {change && !isDir ? (
              <span className="mr-2 ml-auto shrink-0 text-[10px] font-semibold tracking-wide" style={{ color }}>
                {GIT_STATUS_LETTER[change.status]}
              </span>
            ) : change ? (
              <span className="mr-2 ml-auto size-1.5 shrink-0 rounded-full" style={{ background: color }} />
            ) : null}
          </button>
          {isDir && isOpen && renderDir(entry.path, depth + 1)}
        </div>
      )
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between px-3">
        <span className="truncate text-[11px] font-semibold tracking-wider text-foreground/70 uppercase">
          {rootName}
        </span>
        <button
          type="button"
          aria-label="Refresh explorer"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={refreshAll}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-1 pb-2">{renderDir('', 0)}</div>
    </div>
  )
}

/** A folder takes the color of the first change beneath it, as editors decorate collapsed trees. */
function dirChange(dir: string, changes: Map<string, GitChange>): GitChange | undefined {
  const prefix = `${dir}/`
  for (const [path, change] of changes) if (path.startsWith(prefix)) return change
  return undefined
}
