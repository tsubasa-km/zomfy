import { useEffect, useMemo, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open as openFolderPicker } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Globe, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  HARNESS_METHODS,
  type FolderInspection,
  type HostingAccountRef,
  type HostingRemoteInfo,
  type ProjectCreationDefaults
} from '@zomfy/protocol'
import { harnessRequest, hostForPath } from '@/daemon-connection'
import { findWorkspace, getState, useStore, type HostId } from '@/session-store'
import { defaultHostId } from '@/lib/default-host'
import { closeAddProjectDialog, setOrcaImportOpen, useAddProjectRequest } from '@/lib/project-dialogs'
import { addFolderProject, addPickedProject, completeProjectAdd } from '@/lib/project-add-completion'
import { folderStatus, hostPills, publishAccounts as githubAccounts, showHostRow, tabForStep, type AddTab } from '@/lib/add-project-form'
import { guessProvider } from '@/lib/hosting-account-choice'
import { useHostAccounts } from '@/lib/hosting-accounts'
import { joinHostPath, projectFolderName, repoFolderName } from '@/lib/project-target-path'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AddRepoHostRow } from '@/components/sidebar/AddRepoHostRow'
import { ClonePanel, CreatePanel, OpenFolderPanel, fieldLabel, type PublishDraft } from '@/components/sidebar/AddRepoPanels'
import { HostingAccountField } from '@/components/sidebar/HostingAccountField'
import { SshConnectDialog } from '@/components/sidebar/SshConnectDialog'
import { t } from '@/i18n/i18n'

// One "Add a project" dialog (docs/specs/add-project-dialog.md): the host as a row of pills shown
// only with more than one host, three tabs for the way in, and the project's GitHub or GitLab
// account (docs/specs/project-hosting-accounts.md) asked only when there is a choice.

/** null: the host's daemon predates creation defaults (or the probe failed); fields start empty. */
type HostDefaults = ProjectCreationDefaults | null

function initialHost(requested: HostId | undefined): HostId {
  if (requested) return requested
  const { hosts, activeWorkspaceId } = getState()
  const active = findWorkspace(activeWorkspaceId ?? '')?.hostId
  return active && hosts[active]?.connection.kind === 'connected' ? active : defaultHostId()
}

/** The native picker reaches this computer and its WSL distros only; other hosts take a typed path. */
const canPickOn = (hostId: HostId) => isTauri() && (hostId === 'local' || hostId.startsWith('wsl:'))

/** Opens the picker inside the distro's filesystem for a WSL host, at `near` when given. */
function pickerStart(hostId: HostId, near: string): string | undefined {
  if (!hostId.startsWith('wsl:') || !near.startsWith('/')) return undefined
  return `\\\\wsl.localhost\\${hostId.slice(4)}${near.replaceAll('/', '\\')}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Runs `ask` 300 ms after `key` stops changing; `undefined` while waiting, null when it failed. */
function useDebounced<T>(key: string | null, ask: () => Promise<T>): T | null | undefined {
  const [result, setResult] = useState<{ key: string; value: T | null } | null>(null)
  useEffect(() => {
    if (key === null) return
    let live = true
    const timer = setTimeout(() => {
      void ask().then(
        (value) => live && setResult({ key, value }),
        () => live && setResult({ key, value: null })
      )
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // `ask` is rebuilt every render; `key` says when it asks something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return key !== null && result?.key === key ? result.value : undefined
}

export function AddRepoDialog() {
  const request = useAddProjectRequest()
  const hosts = useStore((s) => s.hosts)
  const projectCount = useStore((s) => Object.values(s.hosts).reduce((n, h) => n + (h.harness?.projects.length ?? 0), 0))
  const [tab, setTab] = useState<AddTab>('open')
  const [hostId, setHostId] = useState<HostId>('local')
  const [distros, setDistros] = useState<string[]>([])
  const [defaults, setDefaults] = useState<Record<HostId, HostDefaults>>({})
  // Typed or picked parents win over the host's defaults, per host.
  const [cloneParents, setCloneParents] = useState<Record<HostId, string>>({})
  const [createParents, setCreateParents] = useState<Record<HostId, string>>({})
  const [path, setPath] = useState('')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [account, setAccount] = useState<HostingAccountRef | null>(null)
  const [publish, setPublish] = useState<PublishDraft>({ on: false, account: null, owner: '', visibility: 'private' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sshOpen, setSshOpen] = useState(false)

  useEffect(() => {
    if (!request) return
    setTab(tabForStep(request.step))
    setHostId(initialHost(request.hostId))
    setCloneParents({})
    setCreateParents({})
    setPath('')
    setUrl('')
    setName('')
    setAccount(null)
    setPublish({ on: false, account: null, owner: '', visibility: 'private' })
    setError(null)
    if (isTauri()) void invoke<string[]>('wsl_distros').then(setDistros, () => setDistros([]))
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

  const pills = useMemo(() => hostPills(hosts, distros), [hosts, distros])
  const hostLabel = hosts[hostId]?.label ?? hostId
  const picker = canPickOn(hostId)
  const cloneParent = cloneParents[hostId] ?? hostDefaults?.cloneParent ?? ''
  const createParent = createParents[hostId] ?? hostDefaults?.createParent ?? ''
  const gitMissing = hostDefaults?.gitAvailable === false

  // What the typed folder is, and what the typed URL points at, asked on the chosen host.
  const open = request !== null && connected
  const inspection = useDebounced<FolderInspection>(open && tab === 'open' && path.trim() ? `${hostId}\n${path.trim()}` : null, () =>
    harnessRequest(HARNESS_METHODS.projectInspectFolder, { path: path.trim() }, hostId)
  )
  const urlRemote = useDebounced<HostingRemoteInfo | null>(open && tab === 'clone' && url.trim() ? `${hostId}\n${url.trim()}` : null, () =>
    harnessRequest(HARNESS_METHODS.hostingRemoteOf, { url: url.trim() }, hostId)
  )
  const remote: HostingRemoteInfo | null = tab === 'open' ? (inspection?.remote ?? null) : tab === 'clone' ? (urlRemote ?? null) : null
  const remoteKey = remote ? `${remote.provider}|${remote.host}` : ''
  // Another host or provider has other accounts: the choice starts over at the active one.
  useEffect(() => setAccount(null), [remoteKey, hostId])

  const { accounts } = useHostAccounts(hostId, open)
  const publishable = githubAccounts(accounts)

  function close() {
    if (!busy) closeAddProjectDialog()
  }

  function changed() {
    setError(null)
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
    const home = hostDefaults ? hostDefaults.cloneParent.replace(/[\\/][^\\/]+$/, '') : ''
    const picked = await pickFolder(t('Add a project folder or git repository'), path.trim() || home)
    if (!picked) return
    setHostId(picked.hostId)
    setPath(picked.path)
    changed()
  }

  async function pickParent(setParents: typeof setCloneParents, current: string) {
    const picked = await pickFolder(t('Choose the parent folder'), current)
    if (!picked) return
    setHostId(picked.hostId)
    setParents((all) => ({ ...all, [picked.hostId]: picked.path }))
    changed()
  }

  const chosenAccount = remote ? account : null
  const accountField =
    remote && connected ? (
      <div className="space-y-1.5" data-add-repo-account>
        <Label htmlFor="add-repo-account" className={fieldLabel}>
          {t('Account')}
        </Label>
        <HostingAccountField
          id="add-repo-account"
          hostId={hostId}
          remote={remote}
          value={account}
          onChange={setAccount}
          readOnlyWhenSingle
          disabled={busy}
          onLoginOpened={() => closeAddProjectDialog()}
        />
      </div>
    ) : null

  const status = folderStatus(path, tab === 'open' && path.trim() ? inspection : null)
  const canOpen = !!path.trim() && !busy && connected && inspection?.exists !== false
  const canClone = !!url.trim() && !!cloneParent.trim() && !busy && connected && !gitMissing
  const canCreate = !!name.trim() && !!createParent.trim() && !busy && connected && !gitMissing && hostDefaults !== undefined

  const addFolder = () =>
    run(async () => {
      const where = path.trim()
      // A daemon without inspectFolder, or Enter before it answered: the flow that asks before adding a non-Git folder.
      if (inspection == null) return addPickedProject(hostId, where)
      if (inspection?.kind === 'folder') return addFolderProject(hostId, where)
      return completeProjectAdd(hostId, () =>
        harnessRequest(HARNESS_METHODS.projectAdd, { path: where, requireGit: true, ...(chosenAccount ? { hostingAccount: chosenAccount } : {}) }, hostId)
      )
    })
  const clone = () =>
    run(() =>
      completeProjectAdd(hostId, () =>
        harnessRequest(
          HARNESS_METHODS.projectClone,
          { url: url.trim(), parentPath: cloneParent.trim(), ...(chosenAccount ? { hostingAccount: chosenAccount } : {}) },
          hostId
        )
      )
    )
  const publishAs = publish.on ? (publish.account ?? publishable[0] ?? null) : null
  const create = () =>
    run(async () => {
      let publishError: string | undefined
      await completeProjectAdd(hostId, async () => {
        const project = await harnessRequest(
          HARNESS_METHODS.projectCreateRepo,
          {
            parentPath: createParent.trim(),
            name: name.trim(),
            ...(publishAs ? { publish: { account: publishAs, owner: publish.owner.trim() || undefined, visibility: publish.visibility } } : {})
          },
          hostId
        )
        publishError = project.publishError
        return project
      })
      if (publishError) toast.warning(t('Created here, but not published to GitHub'), { description: publishError })
    })

  const submit = tab === 'open' ? addFolder : tab === 'clone' ? clone : create
  const canSubmit = tab === 'open' ? canOpen : tab === 'clone' ? canClone : canCreate
  const submitLabel = busy
    ? tab === 'clone'
      ? t('Cloning…')
      : tab === 'create'
        ? t('Creating…')
        : t('Adding…')
    : tab === 'open'
      ? inspection?.kind === 'folder'
        ? t('Open as Folder')
        : t('Add project')
      : tab === 'clone'
        ? t('Clone')
        : publishAs
          ? t('Create and publish')
          : t('Create project')

  const cloneTarget = url.trim() && cloneParent.trim() ? joinHostPath(cloneParent, repoFolderName(url)) : cloneParent.trim()
  const folderName = projectFolderName(name.trim() || 'project-name')
  const createTarget = createParent.trim() ? joinHostPath(createParent, folderName) : ''
  const linkTo = request?.linkTo?.name
  // Provider guessed from the URL until the host answers, so the field does not jump in late.
  const guessed = tab === 'clone' && urlRemote === undefined && url.trim() ? guessProvider(url) : null

  return (
    <>
      <Dialog open={request !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent
          className="flex max-h-[calc(100vh-2rem)] min-w-0 flex-col gap-4 sm:max-w-xl [&>*]:min-w-0"
          // An interrupted clone or create would leave a half-made folder; close explicitly instead.
          onInteractOutside={(event) => busy && event.preventDefault()}
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
          // The tab's first field takes focus, not the tab strip, so typing starts right away.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const content = event.currentTarget as HTMLElement | null
            requestAnimationFrame(() => content?.querySelector<HTMLInputElement>('[data-add-repo-field]')?.focus())
          }}
          data-add-repo-dialog={tab}
        >
          <DialogHeader>
            <DialogTitle>{linkTo ? t('Add a workspace to {project}', { project: linkTo }) : t('Add a project')}</DialogTitle>
            {linkTo ? (
              <DialogDescription>{t("A folder or repository on any host; it lists under {project} with its host's name.", { project: linkTo })}</DialogDescription>
            ) : projectCount === 0 ? (
              <DialogDescription>{t('Add a project to get started with Zomfy.')}</DialogDescription>
            ) : null}
          </DialogHeader>

          {showHostRow(pills) && (
            <AddRepoHostRow
              pills={pills}
              hostId={hostId}
              disabled={busy}
              onSelect={(id) => {
                setHostId(id)
                changed()
              }}
              onConnectSsh={() => setSshOpen(true)}
            />
          )}

          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as AddTab)
              changed()
            }}
            className="min-h-0 gap-4 overflow-y-auto px-0.5"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="open" disabled={busy} data-add-repo-tab="open">
                <FolderOpen />
                {t('Open folder')}
              </TabsTrigger>
              <TabsTrigger value="clone" disabled={busy} data-add-repo-tab="clone">
                <Globe />
                {t('Clone')}
              </TabsTrigger>
              <TabsTrigger value="create" disabled={busy} data-add-repo-tab="create">
                <Plus />
                {t('New repository')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="open">
              <OpenFolderPanel
                path={path}
                status={status}
                hostLabel={hostLabel}
                busy={busy}
                canSubmit={canOpen}
                onPathChange={(v) => {
                  setPath(v)
                  changed()
                }}
                onPick={picker ? () => void browse() : undefined}
                onSubmit={() => void addFolder()}
                account={accountField}
              />
            </TabsContent>
            <TabsContent value="clone">
              <ClonePanel
                url={url}
                parent={cloneParent}
                target={cloneTarget}
                busy={busy}
                canSubmit={canClone}
                gitMissing={gitMissing}
                typedParent={!picker}
                onUrlChange={(v) => {
                  setUrl(v)
                  changed()
                }}
                onParentChange={(v) => {
                  setCloneParents((all) => ({ ...all, [hostId]: v }))
                  changed()
                }}
                onPickParent={picker ? () => void pickParent(setCloneParents, cloneParent) : undefined}
                onSubmit={() => void clone()}
                account={
                  accountField ??
                  (guessed ? (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      {t('Looking up the accounts for this host…')}
                    </p>
                  ) : null)
                }
              />
            </TabsContent>
            <TabsContent value="create">
              <CreatePanel
                name={name}
                folderName={folderName}
                parent={createParent}
                target={createTarget}
                busy={busy}
                canSubmit={canCreate}
                gitMissing={gitMissing}
                typedParent={!picker}
                publishAccounts={publishable}
                publish={publish}
                onNameChange={(v) => {
                  setName(v)
                  changed()
                }}
                onParentChange={(v) => {
                  setCreateParents((all) => ({ ...all, [hostId]: v }))
                  changed()
                }}
                onPickParent={picker ? () => void pickParent(setCreateParents, createParent) : undefined}
                onPublishChange={setPublish}
                onSubmit={() => void create()}
              />
            </TabsContent>
          </Tabs>

          {!connected && (
            <p className="text-[11px] text-muted-foreground" data-add-repo-offline>
              {t('{host} is not connected. Pick a connected host, or connect it first.', { host: hostLabel })}
            </p>
          )}
          {error && (
            <p className="text-[11px] break-words text-destructive" role="alert" data-add-repo-error>
              {error}
            </p>
          )}

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                data-add-repo-orca-import
                onClick={() => {
                  closeAddProjectDialog()
                  setOrcaImportOpen(true)
                }}
              >
                {t('Import from Orca…')}
              </button>
              {!showHostRow(pills) && (
                <button type="button" className="text-xs text-muted-foreground transition-colors hover:text-foreground" onClick={() => setSshOpen(true)} data-add-repo-other-machine>
                  {t('On another machine…')}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                {t('Cancel')}
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={!canSubmit} data-add-repo-submit>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SshConnectDialog open={sshOpen} onClose={() => setSshOpen(false)} onConnecting={setHostId} />
    </>
  )
}
