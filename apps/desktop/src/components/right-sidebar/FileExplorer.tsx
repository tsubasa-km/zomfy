import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ellipsis, FilePlus, FolderPlus, ListCollapse, Loader2, RefreshCw, X } from 'lucide-react'
import { HARNESS_METHODS, type FileEntry, type GitChange } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allWorkspaces, closeEditorTab, getState, moveEditorTabs, openEditorTab, setRightSidebar, useStore } from '@/session-store'
import { GIT_STATUS_COLOR, GIT_STATUS_LETTER, useGitStatus } from '@/hooks/use-git-status'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openWorkspaceIn } from '@/components/sidebar/WorkspaceMenu'
import { FileExplorerRow, type FileExplorerRowActions } from './FileExplorerRow'
import { InlineInputRow, type InlineInput } from './file-explorer-inline-input'
import { PermanentDeleteDialog } from './file-explorer-delete-dialog'
import { absolutePath, ancestorsOf, baseName, copyText, isWithin, joinPath, parentDir, revealInFileManager } from './explorer-paths'
import { useExplorerKeys } from './use-explorer-keys'
import { requestFindInFolder } from './search-requests'

// Orca's FileExplorer (toolbar, rows, inline input, keys, drag-drop move, auto-reveal), rendered
// as one flat list of visible rows so keyboard navigation walks the same order the eye does.

type DirState = FileEntry[] | 'loading' | { error: string }
type Row =
  | { kind: 'entry'; entry: FileEntry; depth: number }
  | { kind: 'input'; input: InlineInput }
  | { kind: 'error'; message: string }

const DRAG_MIME = 'application/x-acp-harness-paths'
const DRAG_EXPAND_MS = 600
const isMac = navigator.userAgent.includes('Mac')

export function FileExplorer({ workspaceId, rootName }: { workspaceId: string; rootName: string }) {
  const [children, setChildren] = useState<Record<string, DirState>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [inline, setInline] = useState<InlineInput | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ paths: string[]; reason: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const { status, refresh: refreshGit } = useGitStatus(workspaceId)
  const treeRef = useRef<HTMLDivElement>(null)
  const revealRef = useRef<string | null>(null)
  const dragExpand = useRef<{ dir: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const workspacePath = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.path ?? '')
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? null)
  const activeFile = useStore((s) => {
    const tab = s.editorTabs.find((t) => t.id === s.activeSessionByWorkspace[workspaceId])
    return tab?.workspaceId === workspaceId && tab.kind === 'file' ? tab.path : null
  })

  const load = useCallback(
    (dir: string) =>
      harnessRequest(HARNESS_METHODS.fsList, { workspaceId, dir })
        .then((list) => setChildren((c) => ({ ...c, [dir]: list })))
        .catch((e: unknown) => setChildren((c) => ({ ...c, [dir]: { error: message(e) } }))),
    [workspaceId]
  )

  /** Reloads every open folder; listings are small and this keeps moves and renames simple. */
  const reloadOpen = useCallback(
    async (open: Set<string> = expanded) => {
      await Promise.all([...open].map(load))
      refreshGit()
    },
    [expanded, load, refreshGit]
  )

  function expand(dirs: string[]) {
    if (dirs.length === 0) return
    setExpanded((current) => (dirs.every((d) => current.has(d)) ? current : new Set([...current, ...dirs])))
  }

  // Open folders load their listing the first time they are shown.
  useEffect(() => {
    const missing = [...expanded].filter((dir) => children[dir] === undefined)
    if (missing.length === 0) return
    setChildren((c) => ({ ...c, ...Object.fromEntries(missing.map((dir) => [dir, 'loading' as const])) }))
    for (const dir of missing) void load(dir)
  }, [expanded, children, load])

  function toggle(dir: string) {
    if (!expanded.has(dir)) return expand([dir])
    setExpanded((current) => {
      const next = new Set(current)
      next.delete(dir)
      return next
    })
  }

  // Orca's useFileExplorerAutoReveal: the active editor's file is expanded to and selected.
  useEffect(() => {
    if (!activeFile) return
    expand(ancestorsOf(activeFile))
    setSelected(new Set([activeFile]))
    setAnchor(activeFile)
    revealRef.current = activeFile
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reveal only when the active file changes
  }, [activeFile])

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: string, depth: number) => {
      if (inline && inline.type !== 'rename' && inline.parentDir === dir) out.push({ kind: 'input', input: { ...inline, depth } })
      const state = children[dir]
      if (!Array.isArray(state)) {
        if (depth === 0 && state && state !== 'loading') out.push({ kind: 'error', message: state.error })
        return
      }
      for (const entry of state) {
        if (inline?.type === 'rename' && inline.path === entry.path) out.push({ kind: 'input', input: { ...inline, depth } })
        else out.push({ kind: 'entry', entry, depth })
        if (entry.kind === 'dir' && expanded.has(entry.path)) walk(entry.path, depth + 1)
      }
    }
    walk('', 0)
    return out
  }, [children, expanded, inline])
  const entries = useMemo(() => rows.flatMap((r) => (r.kind === 'entry' ? [r.entry] : [])), [rows])

  useEffect(() => {
    const path = revealRef.current
    const row = path && treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
    if (!row) return
    revealRef.current = null
    row.scrollIntoView({ block: 'nearest' })
  }, [rows])

  const changes = useMemo(() => {
    const map = new Map<string, GitChange>()
    for (const change of [...(status?.staged ?? []), ...(status?.unstaged ?? [])]) map.set(change.path, change)
    return map
  }, [status])

  // No watcher yet: a changed git status or a refocused window is the cue that files moved on disk.
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const changeKey = useMemo(() => [...changes.keys()].sort().join('\0'), [changes])
  useEffect(() => {
    const reload = () => void Promise.all([...expandedRef.current].map(load))
    reload()
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [changeKey, load])

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(message(e))
    }
  }, [])

  function selectionFor(entry: FileEntry): string[] {
    return selected.has(entry.path) && selected.size > 1 ? [...selected] : [entry.path]
  }

  function select(path: string) {
    setSelected(new Set([path]))
    setAnchor(path)
  }

  function selectRange(to: string) {
    const paths = entries.map((e) => e.path)
    const [a, b] = [paths.indexOf(anchor ?? to), paths.indexOf(to)].sort((x, y) => x - y)
    setSelected(new Set(paths.slice(Math.max(0, a!), b! + 1)))
  }

  function activate(entry: FileEntry) {
    if (entry.kind === 'dir') toggle(entry.path)
    else openEditorTab({ workspaceId, kind: 'file', path: entry.path, staged: false })
  }

  function onRowClick(entry: FileEntry, event: React.MouseEvent) {
    if (event.shiftKey && anchor) return selectRange(entry.path)
    if (isMac ? event.metaKey : event.ctrlKey) {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
      setAnchor(entry.path)
      return
    }
    select(entry.path)
    activate(entry)
  }

  function startNew(type: 'file' | 'folder', dir: string) {
    expand([...ancestorsOf(joinPath(dir, 'x'))])
    setInline({ type, parentDir: dir, depth: 0 })
  }

  async function submitInline(value: string) {
    const input = inline
    setInline(null)
    const name = value.trim()
    if (!input || !name) return
    if (input.type === 'rename') {
      if (name === input.name) return
      const to = joinPath(parentDir(input.path), name)
      await run(async () => {
        await harnessRequest(HARNESS_METHODS.fsRename, { workspaceId, from: input.path, to })
        await afterMove([[input.path, to]])
      })
      return
    }
    const path = joinPath(input.parentDir, name)
    await run(async () => {
      await harnessRequest(HARNESS_METHODS.fsCreate, { workspaceId, path, kind: input.type === 'folder' ? 'dir' : 'file' })
      await reloadOpen()
      select(path)
      revealRef.current = path
      if (input.type === 'file') openEditorTab({ workspaceId, kind: 'file', path, staged: false })
    })
  }

  /** Keeps expanded folders and the selection on entries that moved. */
  async function afterMove(moves: [from: string, to: string][]) {
    const remap = (p: string) => {
      const move = moves.find(([from]) => isWithin(p, from))
      return move ? move[1] + p.slice(move[0].length) : p
    }
    const open = new Set([...expanded].map(remap))
    for (const [from, to] of moves) {
      if (parentDir(to)) open.add(parentDir(to))
      moveEditorTabs(workspaceId, from, to)
    }
    setExpanded(open)
    setChildren((c) => Object.fromEntries(Object.entries(c).filter(([dir]) => !moves.some(([from]) => isWithin(dir, from)))))
    await reloadOpen(open)
    setSelected(new Set(moves.map(([, to]) => to)))
    setAnchor(moves[0]?.[1] ?? null)
    revealRef.current = moves[0]?.[1] ?? null
  }

  async function remove(paths: string[], permanent: boolean) {
    await run(async () => {
      const result = await harnessRequest(HARNESS_METHODS.fsDelete, { workspaceId, paths, permanent })
      if (result.status === 'trash-unavailable') {
        setPendingDelete({ paths, reason: result.reason })
        return
      }
      // Clean editor tabs of deleted files close; unsaved ones stay so no edit is lost.
      for (const tab of getState().editorTabs) {
        if (tab.workspaceId === workspaceId && tab.kind === 'file' && !tab.dirty && paths.some((p) => isWithin(tab.path, p))) {
          closeEditorTab(tab.id)
        }
      }
      setSelected(new Set())
      await reloadOpen()
    })
  }

  function copyPaths(paths: string[], kind: 'absolute' | 'relative') {
    copyText(paths.map((p) => (kind === 'absolute' ? absolutePath(workspacePath, p) : p)).join('\n'))
  }

  function startRename(entry: FileEntry) {
    setInline({ type: 'rename', path: entry.path, name: entry.name, isDir: entry.kind === 'dir', depth: 0 })
  }

  function actionsFor(entry: FileEntry): FileExplorerRowActions {
    return {
      onStartNew: startNew,
      onStartRename: startRename,
      onDuplicate: (e) =>
        void run(async () => {
          const copy = await harnessRequest(HARNESS_METHODS.fsDuplicate, { workspaceId, path: e.path })
          await reloadOpen()
          select(copy.path)
          revealRef.current = copy.path
        }),
      onCopyPaths: (kind) => copyPaths(selectionFor(entry), kind),
      onReveal: (e) => hostId && revealInFileManager(hostId, workspacePath, e.path, e.kind === 'dir'),
      onFindInFolder: (e) => {
        requestFindInFolder(workspaceId, `${e.path}/**`)
        setRightSidebar({ open: true, tab: 'search' })
      },
      onDelete: () => void remove(selectionFor(entry), false)
    }
  }

  const onTreeKeyDown = useExplorerKeys({
    entries,
    expanded,
    disabled: inline !== null,
    treeRef,
    select,
    selectRange,
    clearSelection: () => setSelected(new Set()),
    expand: (dir) => expand([dir]),
    collapse: toggle,
    activate,
    rename: startRename,
    remove: (entry) => void remove(selectionFor(entry), false),
    copyPaths: (entry, kind) => copyPaths(selectionFor(entry), kind)
  })

  // ── Drag and drop move (Orca's useFileExplorerRowDrag / useFileExplorerMoveDrop) ──

  function clearDragExpand() {
    if (dragExpand.current) clearTimeout(dragExpand.current.timer)
    dragExpand.current = null
  }

  function dragOver(event: React.DragEvent, dir: string, hoverDir: string | null) {
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (dropDir !== dir) setDropDir(dir)
    if (hoverDir === dragExpand.current?.dir) return
    clearDragExpand()
    if (hoverDir && !expanded.has(hoverDir)) {
      dragExpand.current = { dir: hoverDir, timer: setTimeout(() => expand([hoverDir]), DRAG_EXPAND_MS) }
    }
  }

  function drop(event: React.DragEvent, dir: string) {
    const raw = event.dataTransfer.getData(DRAG_MIME)
    setDropDir(null)
    clearDragExpand()
    if (!raw) return
    event.preventDefault()
    event.stopPropagation()
    const parsed: unknown = JSON.parse(raw)
    const paths = (Array.isArray(parsed) ? parsed : []).filter(
      (p): p is string => typeof p === 'string' && parentDir(p) !== dir && !isWithin(dir, p)
    )
    if (paths.length === 0) return
    void run(async () => {
      const moves: [string, string][] = []
      try {
        for (const from of paths) {
          const to = joinPath(dir, baseName(from))
          await harnessRequest(HARNESS_METHODS.fsRename, { workspaceId, from, to })
          moves.push([from, to])
        }
      } finally {
        if (moves.length > 0) await afterMove(moves)
      }
    })
  }

  function rowDrag(entry: FileEntry) {
    const dir = entry.kind === 'dir' ? entry.path : parentDir(entry.path)
    return {
      onDragStart: (event: React.DragEvent) => {
        const paths = selectionFor(entry)
        if (!selected.has(entry.path)) select(entry.path)
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify(paths))
        event.dataTransfer.setData('text/plain', paths.join('\n'))
        event.dataTransfer.effectAllowed = 'copyMove'
      },
      onDragEnd: () => {
        setDropDir(null)
        clearDragExpand()
      },
      onDragOver: (event: React.DragEvent) => dragOver(event, dir, entry.kind === 'dir' ? entry.path : null),
      onDrop: (event: React.DragEvent) => drop(event, dir)
    }
  }

  function statusFor(entry: FileEntry): { letter: string | null; color: string | null; dot: boolean } {
    const own = changes.get(entry.path)
    if (own) return { letter: GIT_STATUS_LETTER[own.status] ?? null, color: GIT_STATUS_COLOR[own.status] ?? null, dot: false }
    if (entry.kind !== 'dir') return { letter: null, color: null, dot: false }
    const prefix = `${entry.path}/`
    for (const [path, change] of changes) {
      // A folder takes the colour of the first change beneath it, as editors decorate collapsed trees.
      if (path.startsWith(prefix)) return { letter: null, color: GIT_STATUS_COLOR[change.status] ?? null, dot: true }
    }
    return { letter: null, color: null, dot: false }
  }

  const rootState = children['']
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 min-h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={rootName}>
          {rootName}
        </span>
        <ToolbarButton label="Collapse All" disabled={expanded.size <= 1} onClick={() => setExpanded(new Set(['']))}>
          <ListCollapse className="size-3" />
        </ToolbarButton>
        <ToolbarButton
          label="Refresh Explorer"
          onClick={() => {
            setRefreshing(true)
            void reloadOpen().finally(() => setRefreshing(false))
          }}
        >
          {refreshing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
        </ToolbarButton>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="More Explorer Actions"
                >
                  <Ellipsis className="size-3" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              More Explorer Actions
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-[12rem]" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onSelect={() => startNew('file', '')}>
              <FilePlus />
              New File
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startNew('folder', '')}>
              <FolderPlus />
              New Folder
            </DropdownMenuItem>
            {hostId && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => openWorkspaceIn('vscode', hostId, workspacePath)}>Open in VS Code</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openWorkspaceIn('explorer', hostId, workspacePath)}>Open in File Manager</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openWorkspaceIn('terminal', hostId, workspacePath)}>Open in Terminal</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && (
        <div role="alert" className="flex items-start gap-1 border-b border-border px-3 py-1.5 text-xs break-words text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setError(null)}>
            <X className="size-3" />
          </button>
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={treeRef}
            role="tree"
            aria-multiselectable
            data-file-explorer-tree=""
            className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-1 pt-1 pb-2"
            onKeyDown={onTreeKeyDown}
            onDragOver={(event) => dragOver(event, '', null)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropDir(null)
                clearDragExpand()
              }
            }}
            onDrop={(event) => drop(event, '')}
          >
            {rootState === 'loading' || rootState === undefined ? (
              <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Loading…
              </div>
            ) : null}
            {rows.map((row) => {
              if (row.kind === 'input') {
                return <InlineInputRow key="inline-input" input={row.input} onSubmit={(v) => void submitInline(v)} onCancel={() => setInline(null)} />
              }
              if (row.kind === 'error') {
                return (
                  <div key="root-error" className="px-3 py-1 text-xs text-destructive">
                    {row.message}
                  </div>
                )
              }
              const { entry, depth } = row
              const dirState = children[entry.path]
              const status = statusFor(entry)
              const loadError = expanded.has(entry.path) && dirState && typeof dirState === 'object' && 'error' in dirState ? dirState.error : null
              return (
                <FileExplorerRow
                  key={entry.path}
                  entry={entry}
                  depth={depth}
                  isExpanded={expanded.has(entry.path)}
                  isLoading={dirState === 'loading'}
                  loadError={loadError}
                  isSelected={selected.has(entry.path)}
                  isDropTarget={dropDir !== null && dropDir !== '' && isWithin(entry.path, dropDir)}
                  statusLetter={status.letter}
                  statusColor={status.color}
                  dotOnly={status.dot}
                  selectionSize={selected.has(entry.path) ? selected.size : 1}
                  actions={actionsFor(entry)}
                  onClick={(event) => onRowClick(entry, event)}
                  onContextMenu={() => !selected.has(entry.path) && select(entry.path)}
                  drag={rowDrag(entry)}
                />
              )
            })}
            {Array.isArray(rootState) && rootState.length === 0 && !inline && (
              <div className="px-3 py-2 text-xs text-muted-foreground">This folder is empty</div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={() => startNew('file', '')}>
            <FilePlus />
            New File
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => startNew('folder', '')}>
            <FolderPlus />
            New Folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PermanentDeleteDialog
        pending={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const paths = pendingDelete?.paths ?? []
          setPendingDelete(null)
          void remove(paths, true)
        }}
      />
    </div>
  )
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          aria-label={label}
          aria-disabled={disabled}
          // Native disabled buttons suppress Radix tooltips in Chromium.
          onClick={(event) => (disabled ? event.preventDefault() : onClick())}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
