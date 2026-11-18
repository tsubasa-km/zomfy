import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { FileIcon, FolderIcon } from '@/components/FileIcon'
import { Box, Braces, ChevronRight, Hash, SquareFunction, Variable } from 'lucide-react'
import { HARNESS_METHODS, type FileEntry } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { findWorkspace, openEditorTab } from '@/session-store'
import type { monaco } from '@/lib/monaco-setup'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { t } from '@/i18n/i18n'

// VS Code's breadcrumbs: the folders down to the file, then the symbols the cursor is inside. A
// folder or the file opens a menu of what is beside it, to move to a neighbouring file from here.

/** What a folder holds, folders first; each folder opens the same list one level down. */
function FolderEntries({ workspaceId, dir, current }: { workspaceId: string; dir: string; current: string }) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let gone = false
    harnessRequest(HARNESS_METHODS.fsList, { workspaceId, dir })
      .then((list) => {
        if (gone) return
        const rank = (entry: FileEntry): number => (entry.kind === 'dir' ? 0 : 1)
        setEntries([...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)))
      })
      .catch(() => !gone && setFailed(true))
    return () => {
      gone = true
    }
  }, [workspaceId, dir])

  if (failed) return <DropdownMenuItem disabled>{t('Could not list this folder')}</DropdownMenuItem>
  if (!entries) return <DropdownMenuItem disabled>{t('Loading…')}</DropdownMenuItem>
  if (entries.length === 0) return <DropdownMenuItem disabled>{t('Empty folder')}</DropdownMenuItem>
  return (
    <>
      {entries.map((entry) =>
        entry.kind === 'dir' ? (
          <DropdownMenuSub key={entry.path}>
            <DropdownMenuSubTrigger data-breadcrumb-entry={entry.path}>
              <FolderIcon name={entry.path} className="size-3.5" />
              <span className="truncate">{entry.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-[60vh] max-w-80 overflow-y-auto">
              <FolderEntries workspaceId={workspaceId} dir={entry.path} current={current} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem
            key={entry.path}
            data-breadcrumb-entry={entry.path}
            className={entry.path === current ? 'bg-accent/60' : undefined}
            onSelect={() => openEditorTab({ workspaceId, kind: 'file', path: entry.path, staged: false })}
          >
            <FileIcon name={entry.path} className="size-3.5" />
            <span className="truncate">{entry.name}</span>
          </DropdownMenuItem>
        )
      )}
    </>
  )
}

function Crumb({ workspaceId, dir, current, label, last }: { workspaceId: string; dir: string; current: string; label: ReactNode; last?: boolean }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={`editor-crumb${last ? ' is-file' : ''}`} data-breadcrumb={dir || '.'}>
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="max-h-[60vh] max-w-80 min-w-48 overflow-y-auto">
        <FolderEntries workspaceId={workspaceId} dir={dir} current={current} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SymbolIcon({ kind }: { kind: monaco.languages.SymbolKind }) {
  // Monaco's SymbolKind: 4 Class, 5 Method, 8 Constructor, 10 Interface, 11 Function, 12 Variable, 13 Constant, 22 Struct…
  const Icon = [4, 9, 10, 22].includes(kind) ? Box : [5, 8, 11].includes(kind) ? SquareFunction : [6, 7, 12, 13, 21].includes(kind) ? Variable : [1, 2, 3, 18].includes(kind) ? Braces : Hash
  return <Icon className="size-3 shrink-0 opacity-70" />
}

const separator = <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/50" />

export function EditorBreadcrumbs({
  workspaceId,
  path,
  symbols,
  onSymbol
}: {
  workspaceId: string
  /** Workspace-relative, '/'-separated. */
  path: string
  /** The symbols around the cursor, outermost first. */
  symbols?: readonly monaco.languages.DocumentSymbol[]
  onSymbol?: (symbol: monaco.languages.DocumentSymbol) => void
}) {
  const parts = path.split('/')
  const fileName = parts[parts.length - 1]!
  const folders = parts.slice(0, -1)
  const root = findWorkspace(workspaceId)?.path.split(/[\\/]/).filter(Boolean).pop()
  return (
    <nav className="editor-breadcrumbs" aria-label={t('Breadcrumbs')} data-editor-breadcrumbs>
      {root && (
        <>
          <Crumb workspaceId={workspaceId} dir="" current={path} label={root} />
          {separator}
        </>
      )}
      {folders.map((name, i) => (
        <Fragment key={i}>
          <Crumb workspaceId={workspaceId} dir={folders.slice(0, i + 1).join('/')} current={path} label={name} />
          {separator}
        </Fragment>
      ))}
      <Crumb workspaceId={workspaceId} dir={folders.join('/')} current={path} label={<><FileIcon name={path} className="size-3.5" /><span className="truncate">{fileName}</span></>} last />
      {symbols?.map((symbol, i) => (
        <Fragment key={`${i}:${symbol.name}`}>
          {separator}
          <button type="button" className="editor-crumb" data-breadcrumb-symbol={symbol.name} onClick={() => onSymbol?.(symbol)}>
            <SymbolIcon kind={symbol.kind} />
            <span className="truncate">{symbol.name}</span>
          </button>
        </Fragment>
      ))}
    </nav>
  )
}
