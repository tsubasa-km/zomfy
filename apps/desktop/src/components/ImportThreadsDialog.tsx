import { useEffect, useMemo, useState } from 'react'
import { FolderGit2, FolderPlus, GitBranch, Search } from 'lucide-react'
import { CHAT_AGENT_IDS, HARNESS_METHODS, chatAgentLabel, type ChatAgentId } from '@acp-harness/protocol'
import { importThread, showThread } from '@/chat-actions'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, allProjects, allWorkspaces, hostLabel, useStore, type HostId, type HostedWorkspace } from '@/session-store'
import { closeImportThreads, useImportThreadsRequest, type ImportThreadsRequest } from '@/stores/thread-import-store'
import { folderName, listedThreads, threadGroups, type ImportableThread } from '@/lib/thread-import'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'
import { projectLabel } from '@/components/sidebar/workspace-visibility'

type Listing = { status: 'loading' } | { status: 'ready'; threads: ImportableThread[] } | { status: 'failed'; error: string }
type RowState = 'importing' | { sessionId: string } | { error: string }
type Scope = 'workspace' | 'all'

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function relativeTime(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 1) return t('just now')
  if (minutes < 60) return t('{n}m ago', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('{n}h ago', { n: hours })
  return t('{n}d ago', { n: Math.round(hours / 24) })
}

/** The dialog stores/thread-import-store opens: conversations of each agent's own CLI, to import as threads. */
export function ImportThreadsDialog() {
  const request = useImportThreadsRequest()
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && closeImportThreads()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-2xl" data-import-threads>
        {request && <ImportThreads key={request.nonce} request={request} />}
      </DialogContent>
    </Dialog>
  )
}

function ImportThreads({ request }: { request: ImportThreadsRequest }) {
  const hosts = useStore((s) => s.hosts)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const workspaces = useMemo(() => allWorkspaces({ hosts }), [hosts])
  const projects = useMemo(() => allProjects(hosts), [hosts])
  // The folder the dialog starts on: the workspace it was opened for, else the one in front.
  const [start] = useState(() => {
    const workspace = workspaces.find((w) => w.id === (request.workspaceId ?? activeWorkspaceId) && (!request.hostId || w.hostId === request.hostId))
    return { hostId: request.hostId ?? workspace?.hostId ?? LOCAL_HOST, workspaceId: workspace?.id ?? null }
  })
  const [hostId, setHostId] = useState<HostId>(start.hostId)
  const here = workspaces.find((w) => w.id === start.workspaceId && w.hostId === hostId && w.id !== hosts[hostId]?.harness?.floatingWorkspaceId) ?? null
  const [wanted, setWanted] = useState<Scope>('workspace')
  const scope: Scope = here ? wanted : 'all'
  const [listings, setListings] = useState<Partial<Record<ChatAgentId, Listing>>>({})
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [busy, setBusy] = useState(false)
  const folderId = scope === 'workspace' ? (here?.id ?? null) : null

  useEffect(() => {
    let live = true
    setListings(Object.fromEntries(CHAT_AGENT_IDS.map((agent) => [agent, { status: 'loading' }])))
    setChosen(new Set())
    setRows({})
    // One ask per agent: Claude's and Codex's are read from disk at once, others answer as their servers start.
    for (const agent of CHAT_AGENT_IDS) {
      harnessRequest(HARNESS_METHODS.sessionHistory, { ...(folderId ? { workspaceId: folderId } : {}), agents: [agent] }, hostId).then(
        (list) => live && setListings((l) => ({ ...l, [agent]: { status: 'ready', threads: listedThreads(agent, list) } })),
        (error: unknown) => live && setListings((l) => ({ ...l, [agent]: { status: 'failed', error: message(error) } }))
      )
    }
    return () => {
      live = false
    }
  }, [hostId, folderId])

  const threads = CHAT_AGENT_IDS.flatMap((agent) => {
    const listing = listings[agent]
    return listing?.status === 'ready' ? listing.threads : []
  })
  const groups = threadGroups(threads, query)
  const reading = CHAT_AGENT_IDS.filter((agent) => (listings[agent]?.status ?? 'loading') === 'loading')
  const failures = CHAT_AGENT_IDS.flatMap((agent) => {
    const listing = listings[agent]
    return listing?.status === 'failed' ? [{ agent, error: listing.error }] : []
  })
  /** The thread that shows a conversation: one imported just now, else the one the daemon named. */
  const shownBy = (thread: ImportableThread): string | null => {
    const row = rows[thread.key]
    return typeof row === 'object' && 'sessionId' in row ? row.sessionId : thread.openSessionId
  }
  // What was ticked stays ticked while a search hides it.
  const picked = threadGroups(threads, '')
    .flatMap((g) => g.threads)
    .filter((thread) => chosen.has(thread.key) && !shownBy(thread))
  const connected = Object.values(hosts).filter((h) => h.connection.kind === 'connected' || h.id === hostId)

  const place = (workspace: HostedWorkspace): string => {
    const project = projects.find((p) => p.id === workspace.projectId && p.hostId === workspace.hostId)
    const name = workspace.displayName ?? workspace.name
    const projectName = project ? projectLabel(project) : null
    return projectName && !workspace.isPrimary ? `${projectName} · ${name}` : (projectName ?? name)
  }

  const toggle = (keys: string[], on: boolean): void => {
    const next = new Set(chosen)
    for (const key of keys) {
      if (on) next.add(key)
      else next.delete(key)
    }
    setChosen(next)
  }

  /** Imports in the order listed and opens the first; `into` puts them in that workspace whatever their folder. */
  async function runImport(list: ImportableThread[], into?: string): Promise<void> {
    setBusy(true)
    let first: string | null = null
    let failed = false
    for (const thread of list) {
      setRows((r) => ({ ...r, [thread.key]: 'importing' }))
      try {
        const sessionId = await importThread(hostId, thread, into ?? thread.workspaceId ?? undefined)
        first ??= sessionId
        setRows((r) => ({ ...r, [thread.key]: { sessionId } }))
      } catch (error) {
        failed = true
        setRows((r) => ({ ...r, [thread.key]: { error: message(error) } }))
      }
    }
    setBusy(false)
    if (first) showThread(first)
    // What failed stays on screen with its reason.
    if (!failed) closeImportThreads()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('Import threads')}</DialogTitle>
        <DialogDescription>
          {t(
            "Conversations you had in an agent's own app or CLI on this host. An imported thread keeps its transcript, and your next message continues the conversation."
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search conversations')}
            aria-label={t('Search conversations')}
            className="h-8 pl-8"
            data-import-threads-search
          />
        </div>
        {here && (
          <div className="flex shrink-0 rounded-md border border-border p-0.5" role="group" aria-label={t('Folders to list')}>
            {(['workspace', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                disabled={busy}
                data-import-threads-scope={value}
                onClick={() => setWanted(value)}
                className={cn(
                  'max-w-44 truncate rounded-[5px] px-2 py-1 text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  scope === value && 'bg-accent text-accent-foreground'
                )}
              >
                {value === 'workspace' ? place(here) : t('All folders')}
              </button>
            ))}
          </div>
        )}
        {connected.length > 1 && (
          <Select value={hostId} onValueChange={setHostId} disabled={busy}>
            <SelectTrigger size="sm" className="shrink-0" aria-label={t('Host')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {connected.map((host) => (
                <SelectItem key={host.id} value={host.id}>
                  {hostLabel(host.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="scrollbar-sleek -mx-2 min-h-40 flex-1 overflow-y-auto px-2" data-import-threads-list>
        {groups.map((group) => {
          const importable = group.threads.filter((thread) => !shownBy(thread))
          const all = importable.length > 0 && importable.every((thread) => chosen.has(thread.key))
          const some = importable.some((thread) => chosen.has(thread.key))
          const label = chatAgentLabel(group.agent)
          return (
            <section key={group.agent} data-import-threads-agent={group.agent} className="pb-2">
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                <Checkbox
                  aria-label={t('Select all of {label}', { label })}
                  checked={all ? true : some ? 'indeterminate' : false}
                  disabled={busy || importable.length === 0}
                  onCheckedChange={(v) => toggle(importable.map((thread) => thread.key), v === true)}
                />
                <TuiAgentIcon agent={group.agent} size={13} />
                <span>{label}</span>
                <span className="font-normal tabular-nums">{group.threads.length}</span>
              </div>
              <ul>
                {group.threads.map((thread) => {
                  const row = rows[thread.key]
                  const open = shownBy(thread)
                  const workspace = workspaces.find((w) => w.id === thread.workspaceId && w.hostId === hostId)
                  const failure = typeof row === 'object' && 'error' in row ? row.error : null
                  return (
                    <li key={thread.key} data-import-thread={thread.key} data-imported={open ? '' : undefined}>
                      <label className={cn('flex items-start gap-2.5 rounded-md px-2 py-1.5', open ? 'opacity-70' : 'cursor-pointer hover:bg-accent')}>
                        <Checkbox
                          className="mt-0.5"
                          checked={open ? true : chosen.has(thread.key)}
                          disabled={busy || !!open}
                          onCheckedChange={(v) => toggle([thread.key], v === true)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 text-sm">
                            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                              {row === 'importing' ? t('Importing…') : open ? t('Imported') : thread.lastModified ? relativeTime(thread.lastModified) : ''}
                            </span>
                          </div>
                          <div className="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">
                            {scope === 'all' &&
                              (workspace ? (
                                <span className="flex min-w-0 items-center gap-1">
                                  <FolderGit2 className="size-3 shrink-0" aria-hidden />
                                  <span className="truncate">{place(workspace)}</span>
                                </span>
                              ) : thread.cwd ? (
                                <span className="flex min-w-0 items-center gap-1" title={t('{path}: importing adds this folder as a project', { path: thread.cwd })}>
                                  <FolderPlus className="size-3 shrink-0" aria-hidden />
                                  <span className="truncate">{folderName(thread.cwd)}</span>
                                </span>
                              ) : null)}
                            {thread.gitBranch && (
                              <span className="flex min-w-0 items-center gap-1">
                                <GitBranch className="size-3 shrink-0" aria-hidden />
                                <span className="truncate">{thread.gitBranch}</span>
                              </span>
                            )}
                          </div>
                          {failure && <div className="text-xs break-words text-destructive">{failure}</div>}
                        </div>
                        {open ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="shrink-0"
                            onClick={(e) => {
                              e.preventDefault()
                              showThread(open)
                              closeImportThreads()
                            }}
                          >
                            {t('Open')}
                          </Button>
                        ) : failure && here && thread.workspaceId !== here.id ? (
                          <Button
                            size="xs"
                            variant="outline"
                            className="max-w-48 shrink-0"
                            disabled={busy}
                            onClick={(e) => {
                              e.preventDefault()
                              void runImport([thread], here.id)
                            }}
                          >
                            <span className="truncate">{t('Import into {name}', { name: place(here) })}</span>
                          </Button>
                        ) : null}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
        {groups.length === 0 && reading.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground" data-import-threads-empty>
            {threads.length > 0 ? t('No conversations match the search.') : t('No conversations found here.')}
          </p>
        )}
        {reading.length > 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground" data-import-threads-reading>
            {t('Reading {agents}…', { agents: reading.map(chatAgentLabel).join(', ') })}
          </p>
        )}
        {failures.map(({ agent, error }) => (
          <p key={agent} className="px-2 py-1 text-xs break-words text-destructive">
            {t("Couldn't read {label}'s conversations: {error}", { label: chatAgentLabel(agent), error })}
          </p>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={closeImportThreads}>
          {t('Cancel')}
        </Button>
        <Button disabled={busy || picked.length === 0} onClick={() => void runImport(picked)} data-import-threads-run>
          {busy ? t('Importing…') : t('Import {n}', { n: picked.length })}
        </Button>
      </DialogFooter>
    </>
  )
}
