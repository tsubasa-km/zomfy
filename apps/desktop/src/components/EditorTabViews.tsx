import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { HARNESS_METHODS, type FileDiff } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { EditorTab } from '@/session-store'
import { NativeChatDiffView } from '@/components/native-chat/NativeChatDiffView'
import { diffFromText } from '@/shared/native-chat-diff'
import '@/components/native-chat/native-chat-appearance.css'

// The diff tab reuses the chat's diff renderer so changes look the same everywhere.

const MAX_DIFF_LINES = 5000

function useLoad<T>(load: () => Promise<T>): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    setError(null)
    void load()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [load])
  useEffect(reload, [reload])
  return { data, error, reload }
}

function Header({ path, detail, onReload }: { path: string; detail?: string; onReload: () => void }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
      <span className="truncate font-mono text-foreground">{path}</span>
      {detail && <span className="shrink-0 text-muted-foreground">{detail}</span>}
      <button
        type="button"
        aria-label="Reload"
        onClick={onReload}
        className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <RefreshCw className="size-3.5" />
      </button>
    </div>
  )
}

export function DiffTabView({ tab }: { tab: EditorTab }) {
  const load = useCallback(
    () =>
      harnessRequest(HARNESS_METHODS.gitDiff, {
        workspaceId: tab.workspaceId,
        path: tab.path,
        staged: tab.staged,
        ...(tab.compare ? { compare: { base: tab.compare.base, head: tab.compare.head } } : {})
      }),
    [tab.workspaceId, tab.path, tab.staged, tab.compare?.base, tab.compare?.head]
  )
  const { data, error, reload } = useLoad<FileDiff>(load)
  const lines = data && !data.binary ? diffFromText(data.patch, MAX_DIFF_LINES) : null

  return (
    <div className="native-chat-appearance flex min-h-0 min-w-0 flex-1 flex-col bg-chat-canvas" data-editor-tab={tab.id}>
      <Header path={tab.path} detail={tab.compare?.label ?? (tab.staged ? 'staged' : 'working tree')} onReload={reload} />
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-3">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {data?.binary && <p className="text-xs text-muted-foreground">Binary file changed.</p>}
        {data && !data.binary && !lines && <p className="text-xs text-muted-foreground">No changes.</p>}
        {lines && <NativeChatDiffView lines={lines} />}
      </div>
    </div>
  )
}
