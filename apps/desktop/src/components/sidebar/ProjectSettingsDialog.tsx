import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { HARNESS_METHODS, type BranchList, type HostingAccountRef, type HostingRemoteInfo, type ProjectHookInfo } from '@zomfy/protocol'
import { harnessRequest, hostForPath } from '@/daemon-connection'
import { useStore, type HostedProject } from '@/session-store'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { catalogEntryOf, renameProject } from '@/stores/project-catalog-store'
import { BranchCombobox } from '@/components/sidebar/BranchCombobox'
import { BundledSkillsSettings } from '@/components/sidebar/BundledSkillsSettings'
import { HostingAccountField } from '@/components/sidebar/HostingAccountField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useSaveState } from '@/lib/use-save-state'
import { t } from '@/i18n/i18n'

// Orca's repository settings pane: display name, default base branch, worktree location and the
// setup/archive scripts that run alongside orca.yaml's. The folder can change too, for a project
// moved or renamed on disk.

const fieldLabel = 'text-xs font-medium text-muted-foreground'
const textareaClass =
  'min-h-16 w-full resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30'

export function ProjectSettingsDialog({ project, onClose }: { project: HostedProject | null; onClose: () => void }) {
  const [folder, setFolder] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [worktreeRoot, setWorktreeRoot] = useState('')
  const [setup, setSetup] = useState('')
  const [archive, setArchive] = useState('')
  const [finishWith, setFinishWith] = useState<'merge' | 'pull-request'>('merge')
  const [agentWorkflows, setAgentWorkflows] = useState(true)
  const [agentSplitWork, setAgentSplitWork] = useState(true)
  const [mergeTarget, setMergeTarget] = useState('')
  const [cleanupMode, setCleanupMode] = useState<'host' | 'on' | 'off'>('host')
  const [claudeChrome, setClaudeChrome] = useState<'host' | 'on' | 'off'>('host')
  const [branches, setBranches] = useState<BranchList | null>(null)
  const [hooks, setHooks] = useState<ProjectHookInfo | null>(null)
  const [account, setAccount] = useState<HostingAccountRef | null>(null)
  /** undefined while asking the daemon; null without a GitHub or GitLab remote. */
  const [remote, setRemote] = useState<HostingRemoteInfo | null | undefined>(undefined)
  const primaryId = useStore((s) => (project ? s.hosts[project.hostId]?.harness?.workspaces.find((w) => w.projectId === project.id && w.isPrimary)?.id : undefined))
  const [error, setError] = useState<string | null>(null)

  // What the project has saved, as the form holds it: Save is offered only when the form differs.
  const saved = formOf(project)
  const form: ProjectForm = { folder, displayName, baseRef, worktreeRoot, setup, archive, finishWith, agentWorkflows, agentSplitWork, mergeTarget, cleanupMode, claudeChrome, account }
  const { dirty, saving, save: submit } = useSaveState(saved, form, save)

  useEffect(() => {
    const saved = formOf(project)
    setFolder(saved.folder)
    setDisplayName(saved.displayName)
    setBaseRef(saved.baseRef)
    setWorktreeRoot(saved.worktreeRoot)
    setSetup(saved.setup)
    setArchive(saved.archive)
    setFinishWith(saved.finishWith)
    setAgentWorkflows(saved.agentWorkflows)
    setAgentSplitWork(saved.agentSplitWork)
    setMergeTarget(saved.mergeTarget)
    setCleanupMode(saved.cleanupMode)
    setClaudeChrome(saved.claudeChrome)
    setError(null)
    setBranches(null)
    setHooks(null)
    setAccount(saved.account)
    setRemote(undefined)
    if (project?.kind === 'git') {
      // docs/specs/project-hosting-accounts.md; an older daemon has no accounts, and the field stays away.
      void harnessRequest(HARNESS_METHODS.hostingRemoteOf, { path: project.path }, project.hostId).then(setRemote, () => setRemote(undefined))
      void harnessRequest(HARNESS_METHODS.branchesList, { projectId: project.id }, project.hostId).then(setBranches, () => undefined)
      void harnessRequest(HARNESS_METHODS.projectHooks, { projectId: project.id }, project.hostId).then(setHooks, () => undefined)
    }
  }, [project])

  async function browse() {
    const folder = await open({ directory: true, title: t('Folder for new worktrees') })
    if (typeof folder === 'string') setWorktreeRoot(hostForPath(folder).path)
  }

  async function browseFolder() {
    const picked = await open({ directory: true, title: t('Project folder') })
    if (typeof picked !== 'string' || !project) return
    const where = hostForPath(picked)
    if (where.hostId !== project.hostId) {
      setError(t('Pick a folder on the same host as the project.'))
      return
    }
    setError(null)
    setFolder(where.path)
  }

  async function save(): Promise<boolean> {
    if (!project) return false
    setError(null)
    try {
      const moved = folder.trim() !== '' && folder.trim() !== project.path
      // Pointed at another folder first, so a bad path changes nothing else.
      if (moved) await harnessRequest(HARNESS_METHODS.projectRelocate, { projectId: project.id, path: folder.trim() }, project.hostId)
      // A project on several hosts is named in the catalog, the same on each; one on a single host
      // is named on that host, so every computer connecting to it sees the name.
      const location = { hostId: project.hostId, projectId: project.id }
      const entry = catalogEntryOf(location)
      const shared = entry.locations.length > 1 || entry.name !== undefined
      if (shared && displayName.trim() !== projectLabel(project)) await renameProject(location, displayName.trim())
      // An unchanged name follows the folder's new name.
      const ownName = displayName.trim() === project.name
      await harnessRequest(
        HARNESS_METHODS.projectUpdate,
        {
          projectId: project.id,
          patch: {
            ...(shared ? {} : { displayName: ownName ? '' : displayName }),
            agentWorkflows,
            claudeChrome: claudeChrome === 'host' ? null : claudeChrome === 'on',
            ...(project.kind === 'git'
              ? {
                  defaultBaseRef: baseRef,
                  worktreeRoot,
                  hooks: { setup, archive },
                  finishWith,
                  agentSplitWork,
                  mergeTarget,
                  ...(remote !== undefined ? { hostingAccount: account } : {}),
                  // Only the switch this dialog shows is the project's own; the rest follow the host.
                  cleanup: cleanupMode === 'host' ? { ...project.cleanup, deleteMerged: undefined } : { ...project.cleanup, deleteMerged: cleanupMode === 'on' }
                }
              : {})
          }
        },
        project.hostId
      )
      onClose()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  const isGit = project?.kind === 'git'
  return (
    <Dialog open={project !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-3xl" data-project-settings-dialog>
        <DialogHeader>
          <DialogTitle>{t('Project Settings')}</DialogTitle>
          <DialogDescription className="break-all">{project?.path}</DialogDescription>
        </DialogHeader>
        <form
          // Two columns from sm up: related settings side by side; the folder, skills and buttons span both.
          className="grid min-h-0 grid-cols-1 content-start gap-x-6 gap-y-4 overflow-y-auto px-0.5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (dirty) void submit()
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="project-folder" className={fieldLabel}>
              {t('Folder')}
            </Label>
            <div className="flex gap-2">
              <Input id="project-folder" value={folder} onChange={(e) => setFolder(e.target.value)} className="font-mono text-xs" data-project-folder />
              {isTauri() && (
                <Button type="button" variant="outline" onClick={() => void browseFolder()}>
                  {t('Browse…')}
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-display-name" className={fieldLabel}>
              {t('Display name')}
            </Label>
            <Input id="project-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          {isGit && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="project-base-ref" className={fieldLabel}>
                  {t('Default base branch')}
                </Label>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <BranchCombobox
                      id="project-base-ref"
                      value={baseRef}
                      placeholder={t('Automatic (origin/HEAD, main or master)')}
                      onChange={setBaseRef}
                      groups={[
                        { heading: t('Local'), options: (branches?.branches ?? []).map((b) => ({ value: b })) },
                        { heading: t('Remote'), options: (branches?.remoteBranches ?? []).map((b) => ({ value: b })) }
                      ]}
                    />
                  </div>
                  {baseRef && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setBaseRef('')}>
                      {t('Reset')}
                    </Button>
                  )}
                </div>
              </div>
              {project && remote !== undefined && (
                <div className="space-y-1.5">
                  <Label htmlFor="project-account" className={fieldLabel}>
                    {t('Account')}
                  </Label>
                  <HostingAccountField
                    id="project-account"
                    hostId={project.hostId}
                    remote={remote}
                    value={account}
                    onChange={setAccount}
                    workspaceId={primaryId}
                    onLoginOpened={onClose}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="project-finish-with" className={fieldLabel}>
                  {t("When a thread's work is done")}
                </Label>
                <Select value={finishWith} onValueChange={(v) => setFinishWith(v === 'pull-request' ? 'pull-request' : 'merge')}>
                  <SelectTrigger id="project-finish-with" className="w-full" data-project-finish-with>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">{t('Merge into the main checkout, then remove the worktree')}</SelectItem>
                    <SelectItem value="pull-request">{t('Push and open a pull request, keep the worktree')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-merge-target" className={fieldLabel}>
                  {t('Work is merged into')}
                </Label>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <BranchCombobox
                      id="project-merge-target"
                      value={mergeTarget}
                      placeholder={
                        branches?.current
                          ? t("The main checkout's branch ({branch})", { branch: branches.current })
                          : t("The main checkout's branch")
                      }
                      onChange={setMergeTarget}
                      groups={[
                        { heading: t('Local'), options: (branches?.branches ?? []).map((b) => ({ value: b })) },
                        { heading: t('Remote'), options: (branches?.remoteBranches ?? []).map((b) => ({ value: b })) }
                      ]}
                    />
                  </div>
                  {mergeTarget && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setMergeTarget('')}>
                      {t('Reset')}
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-cleanup" className={fieldLabel}>
                  {t('Delete merged worktrees automatically')}
                </Label>
                <Select value={cleanupMode} onValueChange={(v) => setCleanupMode(v === 'on' || v === 'off' ? v : 'host')}>
                  <SelectTrigger id="project-cleanup" className="w-full" data-project-cleanup>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="host">{t("As the host's setting (Settings → Hosts)")}</SelectItem>
                    <SelectItem value="on">{t('On for this project')}</SelectItem>
                    <SelectItem value="off">{t('Off for this project')}</SelectItem>
                  </SelectContent>
                </Select>
                {cleanupMode !== 'off' && (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground" data-project-cleanup-kept>
                    <ShieldCheck className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    {t('Kept: unpushed work, running threads and terminals, pins')}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-worktree-root" className={fieldLabel}>
                  {t('Worktree location')}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="project-worktree-root"
                    value={worktreeRoot}
                    onChange={(e) => setWorktreeRoot(e.target.value)}
                    placeholder={t('Default (the harness workspaces folder)')}
                    className="font-mono text-xs"
                  />
                  {isTauri() && (
                    <Button type="button" variant="outline" onClick={() => void browse()}>
                      {t('Browse…')}
                    </Button>
                  )}
                </div>
              </div>
              <HookField
                id="project-setup"
                label={t('Setup script')}
                hint={t('Runs in a terminal after a worktree is created.')}
                fileScript={hooks?.fileHooks.setup}
                file={hooks?.file ?? null}
                value={setup}
                onChange={setSetup}
              />
              <HookField
                id="project-archive"
                label={t('Archive script')}
                hint={t('Runs before a worktree is deleted.')}
                fileScript={hooks?.fileHooks.archive}
                file={hooks?.file ?? null}
                value={archive}
                onChange={setArchive}
              />
            </>
          )}
          <div className="space-y-2" data-project-agent-settings>
            <p className={fieldLabel}>{t('What agents may do on their own')}</p>
            <SettingSwitch
              id="project-agent-workflows"
              label={t('Agents can start workflows')}
              checked={agentWorkflows}
              onChange={setAgentWorkflows}
            />
            {isGit && (
              <SettingSwitch
                id="project-agent-split-work"
                label={t('Agents can split work into parallel worktrees')}
                checked={agentSplitWork}
                onChange={setAgentSplitWork}
              />
            )}
          </div>
          <div className="space-y-1.5" data-project-claude-chrome={claudeChrome}>
            <Label htmlFor="project-claude-chrome" className={fieldLabel}>
              {t('Claude in Chrome')}
            </Label>
            <Select value={claudeChrome} onValueChange={(value) => setClaudeChrome(value as 'host' | 'on' | 'off')}>
              <SelectTrigger id="project-claude-chrome" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="host">{t('Use the host’s setting (Settings › Agents › Claude)')}</SelectItem>
                <SelectItem value="on">{t('On for this project')}</SelectItem>
                <SelectItem value="off">{t('Off for this project')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isGit && project && (
            <div className="sm:col-span-2">
              <BundledSkillsSettings project={project} />
            </div>
          )}
          {error && <p className="text-sm break-words text-destructive sm:col-span-2">{error}</p>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!dirty || saving} title={dirty ? undefined : t('Nothing has changed')} data-project-settings-save>
              {saving ? t('Saving…') : t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type ProjectForm = {
  folder: string
  displayName: string
  baseRef: string
  worktreeRoot: string
  setup: string
  archive: string
  finishWith: 'merge' | 'pull-request'
  agentWorkflows: boolean
  agentSplitWork: boolean
  mergeTarget: string
  cleanupMode: 'host' | 'on' | 'off'
  claudeChrome: 'host' | 'on' | 'off'
  account: HostingAccountRef | null
}

/** The form's fields as the project has them saved. */
function formOf(project: HostedProject | null): ProjectForm {
  return {
    folder: project?.path ?? '',
    displayName: project ? projectLabel(project) : '',
    baseRef: project?.defaultBaseRef ?? '',
    worktreeRoot: project?.worktreeRoot ?? '',
    setup: project?.hooks?.setup ?? '',
    archive: project?.hooks?.archive ?? '',
    finishWith: project?.finishWith ?? 'merge',
    agentWorkflows: project?.agentWorkflows !== false,
    agentSplitWork: project?.agentSplitWork !== false,
    mergeTarget: project?.mergeTarget ?? '',
    cleanupMode: project?.cleanup?.deleteMerged === undefined ? 'host' : project.cleanup.deleteMerged ? 'on' : 'off',
    claudeChrome: project?.claudeChrome === undefined ? 'host' : project.claudeChrome ? 'on' : 'off',
    account: project?.hostingAccount ?? null
  }
}

function SettingSwitch({
  id,
  label,
  hint,
  checked,
  onChange
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm font-normal">
          {label}
        </Label>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-setting={id} />
    </div>
  )
}

function HookField({
  id,
  label,
  hint,
  file,
  fileScript,
  value,
  onChange
}: {
  id: string
  label: string
  hint: string
  file: string | null
  fileScript?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={fieldLabel}>
        {label}
      </Label>
      {fileScript && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{t('From {file}, runs first:', { file })}</p>
          <pre className="max-h-24 overflow-auto rounded-md border border-border/60 bg-muted/25 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
            {fileScript}
          </pre>
        </div>
      )}
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={fileScript ? t('Additional local commands') : t('One command per line, e.g. pnpm install')}
        className={cn(textareaClass)}
      />
      <p className="text-[11px] text-muted-foreground">
        {hint} {t('On Windows the script runs with cmd unless it starts with #!, which runs it in Git Bash.')}
      </p>
    </div>
  )
}
