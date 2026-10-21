import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { File } from 'lucide-react'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { findWorkspace, floatingWorkspaceId, openEditorTab, setFloating, useStore } from '@/session-store'
import { setQuickOpen, useAppOverlays, closeSettings } from '@/stores/app-overlay-store'
import { CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { indexPaths, rankPaths, type IndexedPath } from '@/lib/quick-open-ranking'

// Orca's QuickOpen (components/QuickOpen.tsx): Ctrl/Cmd+P lists the active workspace's files from
// its host's daemon (ripgrep `--files`), ranked as you type; Enter opens it in an editor tab.

type Listing = { workspaceId: string; files: IndexedPath[]; truncated: boolean }

function splitPath(path: string): { directory: string; filename: string } {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? { directory: '', filename: path } : { directory: path.slice(0, slash), filename: path.slice(slash + 1) }
}

function FooterKey({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border/60 bg-muted/35 px-2 py-0.5 text-[10px] font-medium text-foreground/85">{children}</span>
}

export function QuickOpen() {
  const open = useAppOverlays((s) => s.quickOpen.open)
  const workspaceId = useAppOverlays((s) => s.quickOpen.workspaceId)
  useStore((s) => s.hosts)
  const workspace = workspaceId ? findWorkspace(workspaceId) : null
  const workspaceName = workspace ? (workspace.displayName ?? workspace.name) : null
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    if (!open) return
    const target = workspaceId
    setQuery('')
    setError(null)
    if (!target) return
    let cancelled = false
    // Re-list on every open so new files show up; the previous list stays visible meanwhile.
    harnessRequest(HARNESS_METHODS.quickOpenFiles, { workspaceId: target })
      .then((result) => {
        if (!cancelled) setListing({ workspaceId: target, files: indexPaths(result.files), truncated: result.truncated })
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [open, workspaceId])

  const files = listing && listing.workspaceId === workspaceId ? listing.files : null
  const results = useMemo(() => (files ? rankPaths(deferredQuery, files) : []), [files, deferredQuery])

  const select = (path: string) => {
    if (!workspaceId) return
    openEditorTab({ workspaceId, kind: 'file', path, staged: false })
    if (workspaceId === floatingWorkspaceId()) setFloating({ open: true })
    closeSettings()
    setQuickOpen(null)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuickOpen(null)
      }}
      shouldFilter={false}
      title="Go to file"
      description="Search for a file to open"
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <CommandInput
        placeholder={workspaceName ? `Go to file in ${workspaceName}...` : 'Go to file...'}
        value={query}
        onValueChange={setQuery}
        className="!h-9 !py-2"
      />
      <CommandList className="p-2" data-quick-open-list>
        {!workspaceId ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Select a workspace to search its files.</div>
        ) : error ? (
          <div className="px-4 py-6 text-center text-sm whitespace-pre-wrap text-muted-foreground">{error}</div>
        ) : !files ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading files...</div>
        ) : results.length === 0 ? (
          <CommandEmpty>No matching files.</CommandEmpty>
        ) : (
          results.map((item) => {
            const { directory, filename } = splitPath(item.path)
            return (
              <CommandItem key={item.path} value={item.path} onSelect={() => select(item.path)} className="min-w-0 !p-0" title={item.path}>
                <div className="flex w-full min-w-0 items-center gap-2 px-3 py-1">
                  <File className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-full min-w-0 shrink-0 truncate text-foreground">{filename}</span>
                  {directory ? <span className="min-w-0 truncate text-muted-foreground">{directory}</span> : null}
                </div>
              </CommandItem>
            )
          })
        )}
        {listing?.truncated && files ? (
          <div className="px-3 py-2 text-center text-xs text-muted-foreground">
            More matches may be available. Refine your search to narrow the results.
          </div>
        ) : null}
      </CommandList>
      <div className="flex items-center justify-end border-t border-border/60 px-3.5 py-2.5 text-[11px] text-muted-foreground/80">
        <div className="flex items-center gap-2">
          <FooterKey>Enter</FooterKey>
          <span>Open</span>
          <FooterKey>Esc</FooterKey>
          <span>Close</span>
          <FooterKey>↑↓</FooterKey>
          <span>Move</span>
        </div>
      </div>
    </CommandDialog>
  )
}
