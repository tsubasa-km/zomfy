import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { open as openFolderPicker } from '@tauri-apps/plugin-dialog'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS, type ProjectCreationDefaults } from '@acp-harness/protocol'
import { harnessRequest, hostForPath, isSshHost } from '@/daemon-connection'
import { LOCAL_HOST, findWorkspace, getState, useStore, type HostId } from '@/session-store'
import { closeAddProjectDialog, setOrcaImportOpen, useAddProjectRequest } from '@/lib/project-dialogs'
import { addPickedProject, completeProjectAdd } from '@/lib/project-add-completion'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AddRepoHostSelector } from '@/components/sidebar/AddRepoHostSelector'
import { AddRepoStartStep } from '@/components/sidebar/AddRepoStartStep'
import { AddRepoCloneStep, AddRepoCreateStep, AddRepoPathStep } from '@/components/sidebar/AddRepoLocationSteps'
import { SshConnectDialog } from '@/components/sidebar/SshConnectDialog'

// Orca's AddRepoDialog: one "Add a project" dialog whose start step picks the host and the way in
// (Browse, Clone, Create); each way is a step with Back. SSH hosts have no picker, so Browse there
// is a typed host path.

type Step = 'start' | 'clone' | 'create' | 'path'
/** null: the host's daemon predates creation defaults (or the probe failed); fields start empty. */
type HostDefaults = ProjectCreationDefaults | null

function initialHost(requested: HostId | undefined): HostId {
  if (requested) return requested
  const { hosts, activeWorkspaceId } = getState()
  const active = findWorkspace(activeWorkspaceId ?? '')?.hostId
  return active && hosts[active]?.connection.kind === 'connected' ? active : LOCAL_HOST
}

const canPickOn = (hostId: HostId) => isTauri() && !isSshHost(hostId)

/** Opens the picker inside the distro's filesystem for a WSL host, at `near` when given. */
function pickerStart(hostId: HostId, near: string): string | undefined {
  if (!hostId.startsWith('wsl:') || !near.startsWith('/')) return undefined
  return `\\\\wsl.localhost\\${hostId.slice(4)}${near.replaceAll('/', '\\')}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function AddRepoDialog() {
  const request = useAddProjectRequest()
  const hosts = useStore((s) => s.hosts)
  const projectCount = useStore((s) => Object.values(s.hosts).reduce((n, h) => n + (h.harness?.projects.length ?? 0), 0))
  const [step, setStep] = useState<Step>('start')
  const [hostId, setHostId] = useState<HostId>(LOCAL_HOST)
  const [defaults, setDefaults] = useState<Record<HostId, HostDefaults>>({})
  // Typed or picked parents win over the host's defaults, per host and step.
  const [cloneParents, setCloneParents] = useState<Record<HostId, string>>({})
  const [createParents, setCreateParents] = useState<Record<HostId, string>>({})
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sshOpen, setSshOpen] = useState(false)

  useEffect(() => {
    if (!request) return
    setStep(request.step)
    setHostId(initialHost(request.hostId))
    setCloneParents({})
    setCreateParents({})
    setUrl('')
    setName('')
    setPath('')
    setError(null)
  }, [request])

  const connected = hosts[hostId]?.connection.kind === 'connected'
  const hostDefaults = defaults[hostId]
  useEffect(() => {
    if (!request || !connected || hostDefaults !== undefined) return
    void harnessRequest(HARNESS_METHODS.projectCreationDefaults, {}, hostId).then(
      (d) => setDefaults((all) => ({ ...all, [hostId]: d })),
      () => setDefaults((all) => ({ ...all, [hostId]: null }))
    )
  }, [request, connected, hostId, hostDefaults])

  const hostLabel = hosts[hostId]?.label ?? hostId
  const cloneParent = cloneParents[hostId] ?? hostDefaults?.cloneParent ?? ''
  const createParent = createParents[hostId] ?? hostDefaults?.createParent ?? ''
  const gitAvailable = hostDefaults?.gitAvailable ?? null

  function close() {
    if (!busy) closeAddProjectDialog()
  }

  function goTo(next: Step) {
    setError(null)
    setStep(next)
  }

  async function run(work: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await work()
      closeAddProjectDialog()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  async function pickFolder(title: string, near: string): Promise<{ hostId: HostId; path: string } | null> {
    const folder = await openFolderPicker({ directory: true, title, defaultPath: pickerStart(hostId, near) })
    return typeof folder === 'string' ? hostForPath(folder) : null
  }

  async function browse() {
    if (!canPickOn(hostId)) return goTo('path')
    const home = hostDefaults ? hostDefaults.cloneParent.replace(/[\\/][^\\/]+$/, '') : ''
    const picked = await pickFolder('Add a project folder or git repository', home)
    if (!picked) return
    setBusy(true)
    try {
      // A non-git folder hands off to the Open as Folder confirmation, so this dialog closes either way.
      await addPickedProject(picked.hostId, picked.path)
      closeAddProjectDialog()
    } catch (e) {
      toast.error('Failed to add project', { description: message(e) })
    } finally {
      setBusy(false)
    }
  }

  async function pickParent(setParents: typeof setCloneParents, current: string) {
    const picked = await pickFolder('Choose the parent folder', current)
    if (!picked) return
    setHostId(picked.hostId)
    setParents((all) => ({ ...all, [picked.hostId]: picked.path }))
    setError(null)
  }

  const clone = () =>
    run(() =>
      completeProjectAdd(hostId, () =>
        harnessRequest(HARNESS_METHODS.projectClone, { url: url.trim(), parentPath: cloneParent.trim() }, hostId)
      )
    )
  const create = () =>
    run(() =>
      completeProjectAdd(hostId, () =>
        harnessRequest(HARNESS_METHODS.projectCreateRepo, { parentPath: createParent.trim(), name: name.trim() }, hostId)
      )
    )
  const addPath = () =>
    run(async () => {
      await addPickedProject(hostId, path.trim())
    })

  const picker = canPickOn(hostId)
  return (
    <>
      <Dialog open={request !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent
          className="min-w-0 overflow-hidden sm:max-w-lg [&>*]:min-w-0"
          // An interrupted clone or create would leave a half-made folder; close explicitly instead.
          onInteractOutside={(event) => busy && event.preventDefault()}
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
          data-add-repo-dialog={step}
        >
          {step !== 'start' ? (
            <div className="-mt-1 flex min-h-5 items-center">
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-40"
                disabled={busy}
                onClick={() => goTo('start')}
                data-add-repo-back
              >
                <ArrowLeft className="size-3" />
                Back
              </button>
            </div>
          ) : null}
          {step === 'start' ? (
            <AddRepoStartStep
              firstProject={projectCount === 0}
              hostSelector={
                <AddRepoHostSelector
                  hostId={hostId}
                  onSelect={(id) => {
                    setHostId(id)
                    setError(null)
                  }}
                  onConnectSsh={() => setSshOpen(true)}
                />
              }
              typedPath={!picker}
              busy={busy}
              disabled={!connected}
              onBrowse={() => void browse()}
              onClone={() => goTo('clone')}
              onCreate={() => goTo('create')}
              onImportOrca={() => {
                closeAddProjectDialog()
                setOrcaImportOpen(true)
              }}
            />
          ) : step === 'clone' ? (
            <AddRepoCloneStep
              hostLabel={hostLabel}
              url={url}
              parent={cloneParent}
              busy={busy}
              error={error}
              gitAvailable={gitAvailable}
              onUrlChange={(v) => {
                setUrl(v)
                setError(null)
              }}
              onParentChange={(v) => {
                setCloneParents((all) => ({ ...all, [hostId]: v }))
                setError(null)
              }}
              onPickParent={picker ? () => void pickParent(setCloneParents, cloneParent) : undefined}
              onClone={() => void clone()}
            />
          ) : step === 'create' ? (
            <AddRepoCreateStep
              name={name}
              parent={createParent}
              busy={busy}
              error={error}
              gitAvailable={gitAvailable}
              defaultsPending={connected && hostDefaults === undefined}
              typedParent={!picker}
              onNameChange={(v) => {
                setName(v)
                setError(null)
              }}
              onParentChange={(v) => {
                setCreateParents((all) => ({ ...all, [hostId]: v }))
                setError(null)
              }}
              onPickParent={picker ? () => void pickParent(setCreateParents, createParent) : undefined}
              onCreate={() => void create()}
            />
          ) : (
            <AddRepoPathStep
              hostLabel={hostLabel}
              path={path}
              busy={busy}
              error={error}
              onPathChange={(v) => {
                setPath(v)
                setError(null)
              }}
              onAdd={() => void addPath()}
            />
          )}
        </DialogContent>
      </Dialog>
      <SshConnectDialog open={sshOpen} onClose={() => setSshOpen(false)} onConnecting={setHostId} />
    </>
  )
}
