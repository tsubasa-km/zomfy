import { useEffect, useMemo, useState } from 'react'
import { Folder, FolderGit2, FolderPlus, FolderSymlink, FolderX, GitBranch, Search } from 'lucide-react'
import { HARNESS_METHODS, chatAgentLabel, type ChatAgentId } from '@zomfy/protocol'
import { importThread, showThread } from '@/chat-actions'
import { harnessRequest } from '@/daemon-connection'
import { allProjects, allWorkspaces, useStore, type HostId, type HostedWorkspace } from '@/session-store'
import { closeImport } from '@/stores/import-store'
import { folderName, listedThreads, threadGroups, threadPlace, type ImportableThread } from '@/lib/thread-import'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { chatFolderBelow } from '@/lib/link-targets'
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

/**
 * The Import dialog's source for one chat agent: the conversations its own CLI recorded on the host,
 * to import as threads. `allFolders` is the dialog's listing across every folder.
 */
export function AgentThreadsPanel({
  hostId,
  agent,
  allFolders,
  startWorkspaceId
}: {
  hostId: HostId
  agent: ChatAgentId
  allFolders: ImportableThread[]
  /** The workspace whose folder to start on, if any. */
  startWorkspaceId: string | null
}) {
  const hosts = useStore((s) => s.hosts)
  const workspaces = useMemo(() => allWorkspaces({ hosts }), [hosts])
  const projects = useMemo(() => allProjects(hosts), [hosts])
  const here =
    workspaces.find((w) => w.id === startWorkspaceId && w.hostId === hostId && w.id !== hosts[hostId]?.harness?.floatingWorkspaceId) ?? null
  const [wanted, setWanted] = useState<Scope>('workspace')
  const scope: Scope = here ? wanted : 'all'
  const [folderListing, setFolderListing] = useState<Listing>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [busy, setBusy] = useState(false)
  const folderId = scope === 'workspace' ? (here?.id ?? null) : null

  // The dialog already holds every folder's conversations; one workspace's are asked for on their own.
  useEffect(() => {
    if (!folderId) return
    let live = true
    setFolderListing({ status: 'loading' })
    harnessRequest(HARNESS_METHODS.sessionHistory, { workspaceId: folderId, agents: [agent] }, hostId).then(
      (list) => live && setFolderListing({ status: 'ready', threads: listedThreads(agent, list) }),
      (error: unknown) => live && setFolderListing({ status: 'failed', error: message(error) })
    )
    return () => {
      live = false
    }
  }, [hostId, agent, folderId])

  const listing: Listing = folderId ? folderListing : { status: 'ready', threads: allFolders }
  const threads = listing.status === 'ready' ? listing.threads : []
  const groups = threadGroups(threads, query)
  const reading = listing.status === 'loading'
  /** The thread that shows a conversation: one imported just now, else the one the daemon named. */
  const shownBy = (thread: ImportableThread): string | null => {
    const row = rows[thread.key]
    return typeof row === 'object' && 'sessionId' in row ? row.sessionId : thread.openSessionId
  }
  // What was ticked stays ticked while a search hides it.
  const picked = threadGroups(threads, '')
    .flatMap((g) => g.threads)
    .filter((thread) => chosen.has(thread.key) && !shownBy(thread))

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

  /**
   * Imports in the order listed and opens the first. Each goes to the workspace of its own folder;
   * `into` (the person's Import into) puts them in that workspace instead.
   */
  async function runImport(list: ImportableThread[], into?: string): Promise<void> {
    setBusy(true)
    let first: string | null = null
    let failed = false
    for (const thread of list) {
      setRows((r) => ({ ...r, [thread.key]: 'importing' }))
      try {
        const sessionId = await importThread(hostId, thread, into)
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
    if (!failed) closeImport()
  }

  return (
    <>
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
                <span>{t('Select all')}</span>
                <span className="font-normal tabular-nums">{group.threads.length}</span>
              </div>
              <ul>
                {group.threads.map((thread) => {
                  const row = rows[thread.key]
                  const open = shownBy(thread)
                  const workspace = workspaces.find((w) => w.id === thread.workspaceId && w.hostId === hostId)
                  const failure = typeof row === 'object' && 'error' in row ? row.error : null
                  // Seen from this workspace: where the import would run when that is not its own folder.
                  const where = scope === 'workspace' && here ? threadPlace(thread, here) : null
                  const below = workspace ? chatFolderBelow(thread.cwd, workspace.path) : null
                  // Placing it here is the person's choice, offered where its own folder is not this one.
                  const offerHere = !!here && thread.workspaceId !== here.id && (!!failure || (where !== null && where.kind !== 'here' && where.kind !== 'below'))
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
                            {where && where.kind === 'below' && (
                              <span className="flex min-w-0 items-center gap-1" title={thread.cwd ?? undefined} data-import-thread-place="below">
                                <Folder className="size-3 shrink-0" aria-label={t('Subfolder')} />
                                <span className="truncate">{where.path}</span>
                              </span>
                            )}
                            {where && where.kind === 'elsewhere' && (
                              <span
                                className="flex min-w-0 items-center gap-1 text-amber-600 dark:text-amber-400"
                                title={thread.cwd ?? undefined}
                                data-import-thread-place="elsewhere"
                              >
                                <FolderSymlink className="size-3 shrink-0" aria-label={t('Different folder')} />
                                <span className="truncate">{workspace ? place(workspace) : thread.cwd ? folderName(thread.cwd) : ''}</span>
                              </span>
                            )}
                            {thread.folderMissing && (
                              <span className="flex min-w-0 items-center gap-1 text-destructive/70" title={thread.cwd ?? undefined} data-import-thread-place="gone">
                                <FolderX className="size-3 shrink-0" aria-label={t('Folder is gone')} />
                                <span className="truncate line-through">{thread.cwd ? folderName(thread.cwd) : ''}</span>
                              </span>
                            )}
                            {scope === 'all' &&
                              !thread.folderMissing &&
                              (workspace ? (
                                <span className="flex min-w-0 items-center gap-1" title={thread.cwd ?? undefined}>
                                  <FolderGit2 className="size-3 shrink-0" aria-hidden />
                                  <span className="truncate">{below ? `${place(workspace)} / ${below}` : place(workspace)}</span>
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
                              closeImport()
                            }}
                          >
                            {t('Open')}
                          </Button>
                        ) : offerHere && here ? (
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
        {groups.length === 0 && !reading && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground" data-import-threads-empty>
            {threads.length > 0 ? t('No conversations match the search.') : t('No conversations found here.')}
          </p>
        )}
        {reading && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground" data-import-threads-reading>
            {t('Reading {agents}…', { agents: chatAgentLabel(agent) })}
          </p>
        )}
        {listing.status === 'failed' && (
          <p className="px-2 py-1 text-xs break-words text-destructive">
            {t("Couldn't read {label}'s conversations: {error}", { label: chatAgentLabel(agent), error: listing.error })}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={closeImport}>
          {t('Cancel')}
        </Button>
        <Button disabled={busy || picked.length === 0} onClick={() => void runImport(picked)} data-import-threads-run>
          {busy ? t('Importing…') : t('Import {n}', { n: picked.length })}
        </Button>
      </DialogFooter>
    </>
  )
}
