import { useEffect, useState } from 'react'
import { FolderInput, Loader2 } from 'lucide-react'
import { CHAT_AGENT_IDS, HARNESS_METHODS, chatAgentLabel, type ChatAgentId, type OrcaProject } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, findWorkspace, getState, hostLabel, useStore, type HostId } from '@/session-store'
import { closeImport, useImportRequest, type ImportRequest } from '@/stores/import-store'
import { foundSources, readingSources, shownSource, type ImportSourceId, type SourceProbe } from '@/lib/import-sources'
import { listedThreads, type ImportableThread } from '@/lib/thread-import'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { AgentThreadsPanel } from '@/components/import/AgentThreadsPanel'
import { OrcaProjectsPanel } from '@/components/import/OrcaProjectsPanel'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// One Import dialog (docs/specs/import-dialog.md): a source picker that lists only what the chosen
// host has (Orca's projects, each agent CLI's recorded conversations), then that source's list.

type Answer<T> = { status: 'loading' } | { status: 'ready'; items: T } | { status: 'failed' }

/** Orca is a desktop app on this computer; its WSL projects are routed from here. */
const ORCA_HOST: HostId = LOCAL_HOST

export function ImportDialog() {
  const request = useImportRequest()
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && closeImport()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] min-w-0 flex-col sm:max-w-2xl [&>*]:min-w-0" data-import-dialog>
        {request && <ImportBody key={request.nonce} request={request} />}
      </DialogContent>
    </Dialog>
  )
}

function SourceIcon({ id }: { id: ImportSourceId }) {
  // Orca has no icon in the app; its source brings projects.
  if (id === 'orca') return <FolderInput className="size-3.5" />
  return <TuiAgentIcon agent={id} size={14} />
}

const sourceLabel = (id: ImportSourceId): string => (id === 'orca' ? 'Orca' : chatAgentLabel(id))

function ImportBody({ request }: { request: ImportRequest }) {
  const hosts = useStore((s) => s.hosts)
  const [start] = useState(() => {
    const workspace = findWorkspace(request.workspaceId ?? getState().activeWorkspaceId ?? '')
    const hostId = request.hostId ?? workspace?.hostId ?? LOCAL_HOST
    return { hostId, workspaceId: workspace && workspace.hostId === hostId ? workspace.id : null }
  })
  const [hostId, setHostId] = useState<HostId>(start.hostId)
  const [orca, setOrca] = useState<Answer<OrcaProject[]> | null>(null)
  const [threads, setThreads] = useState<Partial<Record<ChatAgentId, Answer<ImportableThread[]>>>>({})
  const [clicked, setClicked] = useState<ImportSourceId | null>(null)

  useEffect(() => {
    let live = true
    setThreads(Object.fromEntries(CHAT_AGENT_IDS.map((agent) => [agent, { status: 'loading' }])))
    setOrca(hostId === ORCA_HOST ? { status: 'loading' } : null)
    if (hostId === ORCA_HOST) {
      // Fails when Orca was never installed here: the source is then left out.
      harnessRequest(HARNESS_METHODS.orcaProjects, {}, ORCA_HOST).then(
        (items) => live && setOrca({ status: 'ready', items }),
        () => live && setOrca({ status: 'failed' })
      )
    }
    // One ask per agent, across every folder: Claude's and Codex's are read from disk at once, others answer as their servers start.
    for (const agent of CHAT_AGENT_IDS) {
      harnessRequest(HARNESS_METHODS.sessionHistory, { agents: [agent] }, hostId).then(
        (list) => live && setThreads((all) => ({ ...all, [agent]: { status: 'ready', items: listedThreads(agent, list) } })),
        () => live && setThreads((all) => ({ ...all, [agent]: { status: 'failed' } }))
      )
    }
    return () => {
      live = false
    }
  }, [hostId])

  const probe = (answer: Answer<unknown[]> | null | undefined): SourceProbe =>
    !answer ? { status: 'skipped' } : answer.status === 'ready' ? { status: 'ready', count: answer.items.length } : { status: answer.status }
  const probes: Partial<Record<ImportSourceId, SourceProbe>> = {
    orca: probe(orca),
    ...Object.fromEntries(CHAT_AGENT_IDS.map((agent) => [agent, probe(threads[agent])]))
  }
  const found = foundSources(probes)
  const reading = readingSources(probes)
  const source = shownSource(probes, clicked ?? request.source ?? null)
  const connected = Object.values(hosts).filter((h) => h.connection.kind === 'connected' || h.id === hostId)
  const host = hostLabel(hostId)

  const orcaAnswer = orca?.status === 'ready' ? orca.items : null
  const agentAnswer = source && source !== 'orca' ? threads[source] : undefined

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('Import')}</DialogTitle>
      </DialogHeader>
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="radiogroup" aria-labelledby="import-sources-label" data-import-sources>
          <span id="import-sources-label" className="mr-1 text-xs font-medium text-muted-foreground">
            {t('Import from')}
          </span>
          {found.map(({ id, count }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={source === id}
              data-import-source={id}
              onClick={() => setClicked(id)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                source === id ? 'border-primary/60 bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <SourceIcon id={id} />
              <span>{sourceLabel(id)}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
            </button>
          ))}
          {reading.length > 0 && (
            <span className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground" data-import-reading>
              <Loader2 className="size-3 animate-spin" />
              {t('Looking for {sources}…', { sources: reading.map(sourceLabel).join(', ') })}
            </span>
          )}
        </div>
        {connected.length > 1 && (
          <Select
            value={hostId}
            onValueChange={(id) => {
              setHostId(id)
              setClicked(null)
            }}
          >
            <SelectTrigger size="sm" className="shrink-0" aria-label={t('Host')} data-import-host>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {connected.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {hostLabel(h.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {source === 'orca' && orcaAnswer ? (
        <OrcaProjectsPanel key={`${hostId}:orca`} projects={orcaAnswer} />
      ) : source && agentAnswer?.status === 'ready' ? (
        <AgentThreadsPanel
          key={`${hostId}:${source}`}
          hostId={hostId}
          agent={source as ChatAgentId}
          allFolders={agentAnswer.items}
          startWorkspaceId={hostId === start.hostId ? start.workspaceId : null}
        />
      ) : (
        <>
          <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center" data-import-empty>
            {reading.length > 0 ? (
              <p className="text-sm text-muted-foreground">{t('Looking for things to import on {host}…', { host })}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t('Nothing to import on {host}.', { host })}</p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeImport}>
              {t('Cancel')}
            </Button>
          </DialogFooter>
        </>
      )}
    </>
  )
}
