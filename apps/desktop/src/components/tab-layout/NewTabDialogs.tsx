import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HARNESS_METHODS } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { allProjects, allWorkspaces, useStore, type HostId } from '@/session-store'
import { createExternalStore } from '@/stores/external-store'
import { tabScope } from '@/stores/tab-layout-store'
import { openWorkflows } from '@/stores/workflows-store'
import { upsertWorkflowRun } from '@/stores/workflow-runs-store'
import { sortedHosts } from '@/components/settings/HostsPane'
import { projectLabel, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { WorkflowRunDialog } from '@/components/workflows/WorkflowRunDialog'
import { confirmWorkflowStart } from '@/components/workflows/WorkflowStartConfirm'
import { defaultTerminalWorkspace } from '@/lib/new-tab-pins'
import { newTerminalTab } from './workspace-tab-model'
import { t } from '@/i18n/i18n'

// Dialogs the "+" menu and its pins open (docs/specs/new-tab-menu-and-pins.md). The menu unmounts
// on select, so a request goes through a store; the dialog for the workspace's tab scope shows it.

interface WorkflowRunRequest {
  hostId: HostId
  projectId: string
  projectName: string
  workflowId: string
  name: string
}

type Request =
  | { kind: 'terminal'; workspaceId: string }
  | ({ kind: 'workflow'; workspaceId: string } & WorkflowRunRequest)

const requests = createExternalStore<Request | null>(null)

/** The New terminal dialog, starting from `workspaceId`'s host and folder. */
export function requestNewTerminal(workspaceId: string): void {
  requests.set({ kind: 'terminal', workspaceId })
}

export function requestWorkflowRun(run: WorkflowRunRequest & { workspaceId: string }): void {
  requests.set({ kind: 'workflow', ...run })
}

const close = () => requests.set(null)

/** Mounted once per tab scope (TerminalWorkspaceDialogs). */
export function NewTabDialogs({ workspaceId }: { workspaceId: string }) {
  const request = requests.use((r) => r)
  if (!request) return null
  if (request.kind === 'workflow') {
    if (tabScope(request.workspaceId) !== tabScope(workspaceId)) return null
    return <WorkflowRun request={request} />
  }
  if (tabScope(request.workspaceId) !== tabScope(workspaceId)) return null
  return <NewTerminalDialog key={request.workspaceId} from={request.workspaceId} />
}

function WorkflowRun({ request }: { request: WorkflowRunRequest }) {
  const start = async (task: string): Promise<boolean> => {
    const { hostId, projectId, workflowId, projectName } = request
    try {
      if (!(await confirmWorkflowStart(hostId, projectId, workflowId, task, 'you'))) return false
      const run = await harnessRequest(HARNESS_METHODS.workflowRunStart, { projectId, workflowId, task }, hostId)
      upsertWorkflowRun(hostId, run)
      openWorkflows({ hostId, projectId, projectName, runId: run.id })
      return true
    } catch (error) {
      toast.error(t('The workflow did not start'), { description: error instanceof Error ? error.message : String(error) })
      return false
    }
  }
  return <WorkflowRunDialog name={request.name} unsaved={false} onStart={start} onClose={close} />
}

const DEFAULT_SHELL = 'default'

/** Where a new terminal opens: host, folder and shell, defaulting to the tab it was asked from. */
function NewTerminalDialog({ from }: { from: string }) {
  const hosts = useStore((s) => s.hosts)
  const workspaces = useStore((s) => allWorkspaces(s))
  const connected = useMemo(() => sortedHosts(hosts).filter((h) => h.connection.kind === 'connected'), [hosts])
  const fromHost = workspaces.find((w) => w.id === from)?.hostId ?? connected[0]?.id ?? null
  const [hostId, setHostId] = useState<HostId | null>(fromHost)
  const [folder, setFolder] = useState<string | null>(() => (fromHost ? defaultTerminalWorkspace(workspaces, fromHost, from) : null))
  const [shell, setShell] = useState(DEFAULT_SHELL)
  const [busy, setBusy] = useState(false)
  const shells = (hostId ? hosts[hostId]?.shells : undefined) ?? []

  const folders = useMemo(() => {
    const projects = allProjects(hosts)
    return workspaces
      .filter((w) => w.hostId === hostId)
      .map((w) => {
        const project = projects.find((p) => p.hostId === w.hostId && p.id === w.projectId)
        const label = project ? `${projectLabel(project)} · ${w.branch ?? workspaceLabel(w)}` : workspaceLabel(w)
        return { id: w.id, label, primary: w.isPrimary }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [workspaces, hosts, hostId])

  // A folder of another host does not open here: picking a host picks its default folder.
  useEffect(() => {
    if (folder && folders.some((f) => f.id === folder)) return
    setFolder(hostId ? defaultTerminalWorkspace(workspaces, hostId, from) : null)
  }, [folder, folders, hostId, workspaces, from])

  const open = async () => {
    if (!folder || busy) return
    setBusy(true)
    try {
      await newTerminalTab(folder, shell === DEFAULT_SHELL ? undefined : shell)
      close()
    } catch (error) {
      toast.error(t("Couldn't open a terminal"), { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="sm:max-w-md"
        data-new-terminal-dialog
        onKeyDown={(e) => {
          // Enter opens where it says, unless a picker is open and Enter picks in it.
          if (e.key === 'Enter' && !e.defaultPrevented && !(e.target instanceof HTMLElement && e.target.closest('[role="listbox"]'))) {
            e.preventDefault()
            void open()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('New terminal')}</DialogTitle>
          <DialogDescription>{t('Choose where the terminal runs.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {connected.length > 1 && (
            <div className="space-y-1.5">
              <Label>{t('Host')}</Label>
              <Select value={hostId ?? ''} onValueChange={(value) => { setHostId(value); setShell(DEFAULT_SHELL) }}>
                <SelectTrigger className="w-full" data-new-terminal-host>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {connected.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{t('Folder')}</Label>
            {folders.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-new-terminal-no-folder>
                {t('This host has no project folder yet. Add a project on it first.')}
              </p>
            ) : (
              <Select value={folder ?? ''} onValueChange={setFolder}>
                <SelectTrigger className="w-full" data-new-terminal-folder>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start" className="max-h-72">
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {shells.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t('Shell')}</Label>
              <Select value={shell} onValueChange={setShell}>
                <SelectTrigger className="w-full" data-new-terminal-shell>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value={DEFAULT_SHELL}>{t('Default shell')}</SelectItem>
                  {shells.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {t('Cancel')}
          </Button>
          <Button type="button" autoFocus disabled={!folder || busy} onClick={() => void open()} data-new-terminal-open>
            {busy ? t('Opening…') : t('Open')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
