import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle, Folder, FolderGit2, GitBranch, Loader2, XCircle } from 'lucide-react'
import type { HostingAccount, HostingAccountRef } from '@zomfy/protocol'
import type { FolderStatus } from '@/lib/add-project-form'
import { accountValue } from '@/lib/hosting-account-choice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The three tabs of the Add a project dialog (docs/specs/add-project-dialog.md), as fields only:
// AddRepoDialog holds the state and runs them.

export const fieldLabel = 'text-xs font-medium text-muted-foreground'
const hint = 'text-[11px] text-muted-foreground'

export function submitOnEnter(canSubmit: boolean, submit: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (canSubmit) submit()
  }
}

function PathInput({
  id,
  value,
  placeholder,
  busy,
  autoFocus,
  onChange,
  onPick,
  onEnter,
  data
}: {
  id: string
  value: string
  placeholder: string
  busy: boolean
  autoFocus?: boolean
  onChange: (value: string) => void
  /** Absent where no folder picker reaches the host (SSH, remote hosts). */
  onPick?: () => void
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void
  data?: string
}) {
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter}
        placeholder={placeholder}
        className="min-w-0 flex-1 font-mono text-xs placeholder:font-sans"
        disabled={busy}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        data-add-repo-field={data}
      />
      {onPick ? (
        <Button type="button" variant="outline" onClick={onPick} disabled={busy} data-add-repo-browse>
          <Folder className="size-3.5" />
          {t('Browse…')}
        </Button>
      ) : null}
    </div>
  )
}

const STATUS_ICON = {
  checking: Loader2,
  'git-remote': FolderGit2,
  'git-other-remote': GitBranch,
  'git-no-remote': GitBranch,
  folder: AlertTriangle,
  missing: XCircle
} as const

function statusText(status: FolderStatus, hostLabel: string): string {
  switch (status.kind) {
    case 'checking':
      return t('Checking…')
    case 'git-remote':
      return t('Git repository · {remote}', { remote: status.remote })
    case 'git-other-remote':
      return t('Git repository whose remote is not GitHub or GitLab')
    case 'git-no-remote':
      return t('Git repository with no remote')
    case 'folder':
      return t('Not a Git repository: it opens as a folder, without worktrees')
    case 'missing':
      return t('No folder at this path on {host}', { host: hostLabel })
  }
}

/** The project's display name (Project Settings' Display name), set as it is added; empty is the placeholder's. */
export function DisplayNameField({
  value,
  placeholder,
  busy,
  onChange,
  onEnter
}: {
  value: string
  placeholder: string
  busy: boolean
  onChange: (value: string) => void
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="min-w-0 space-y-1.5" data-add-repo-display-name>
      <Label htmlFor="add-repo-display-name" className={fieldLabel}>
        {t('Display name')}
      </Label>
      <Input
        id="add-repo-display-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter}
        placeholder={placeholder || t("The folder's name")}
        disabled={busy}
        spellCheck={false}
        autoComplete="off"
      />
      <p className={hint}>{t('Shown in the sidebar; editable later.')}</p>
    </div>
  )
}

export function OpenFolderPanel({
  path,
  status,
  hostLabel,
  busy,
  canSubmit,
  onPathChange,
  onPick,
  onSubmit,
  displayName,
  account
}: {
  path: string
  status: FolderStatus | null
  hostLabel: string
  busy: boolean
  canSubmit: boolean
  onPathChange: (value: string) => void
  onPick?: () => void
  onSubmit: () => void
  displayName: ReactNode
  /** The account field, when the folder's remote is GitHub or GitLab. */
  account: ReactNode
}) {
  const Icon = status ? STATUS_ICON[status.kind] : null
  return (
    <div className="space-y-4" data-add-repo-panel="open">
      <div className="space-y-1.5">
        <Label htmlFor="add-repo-folder" className={fieldLabel}>
          {t('Folder')}
        </Label>
        <PathInput
          id="add-repo-folder"
          value={path}
          placeholder={onPick ? t('A Git repository or any folder') : t('Path on {host}, e.g. ~/src/project', { host: hostLabel })}
          busy={busy}
          autoFocus
          onChange={onPathChange}
          onPick={onPick}
          onEnter={submitOnEnter(canSubmit, onSubmit)}
          data="path"
        />
        <p
          className={cn(
            'flex min-h-4 items-center gap-1.5 text-[11px]',
            status?.tone === 'error' ? 'text-destructive' : status?.tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
          )}
          data-add-repo-status={status?.kind ?? 'none'}
        >
          {Icon && status ? (
            <>
              <Icon className={cn('size-3 shrink-0', status.kind === 'checking' && 'animate-spin')} />
              <span className="min-w-0 truncate">{statusText(status, hostLabel)}</span>
            </>
          ) : onPick ? (
            t('Browse, or paste a path.')
          ) : (
            t('{host} has no folder picker here; type the path.', { host: hostLabel })
          )}
        </p>
      </div>
      {displayName}
      {account}
    </div>
  )
}

/** "Clone into <target>" with Change, which reveals the parent folder (Orca's create location). */
function LocationSummary({
  id,
  label,
  target,
  parent,
  busy,
  startOpen,
  onParentChange,
  onPick,
  onEnter,
  problem
}: {
  id: string
  label: string
  target: string
  parent: string
  busy: boolean
  startOpen: boolean
  onParentChange: (value: string) => void
  onPick?: () => void
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void
  /** Why nothing can be made at the target (it already exists), shown under it. */
  problem?: string | null
}) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="space-y-1.5" data-add-repo-location>
      <div className="flex items-center justify-between gap-2">
        <span className={fieldLabel}>{label}</span>
        {!open && (
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setOpen(true)} disabled={busy} data-add-repo-change-location>
            {t('Change')}
          </Button>
        )}
      </div>
      {open ? (
        <PathInput id={id} value={parent} placeholder="~/src" busy={busy} onChange={onParentChange} onPick={onPick} onEnter={onEnter} data="parent" />
      ) : null}
      <p
        className={cn(
          'truncate rounded-md border bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground',
          problem ? 'border-destructive/60' : 'border-border/70'
        )}
        title={target}
        data-add-repo-target
      >
        {target || t('Choose a parent folder')}
      </p>
      {problem && (
        <p className="text-[11px] break-words text-destructive" data-add-repo-target-problem>
          {problem}
        </p>
      )}
    </div>
  )
}

export function ClonePanel({
  url,
  folderName,
  folderProblem,
  folderNote,
  targetProblem,
  displayName,
  parent,
  target,
  busy,
  canSubmit,
  gitMissing,
  typedParent,
  onUrlChange,
  onFolderNameChange,
  onParentChange,
  onPickParent,
  onSubmit,
  account
}: {
  url: string
  /** The folder the clone makes, as typed; the repository's name until edited. */
  folderName: string
  /** Why that name cannot be a folder, if it cannot. */
  folderProblem: string | null
  /** The folder really made, when the daemon's name rule changes what was typed. */
  folderNote: string | null
  /** Why the target cannot be cloned into (it already exists). */
  targetProblem: string | null
  displayName: ReactNode
  parent: string
  target: string
  busy: boolean
  canSubmit: boolean
  gitMissing: boolean
  typedParent: boolean
  onUrlChange: (value: string) => void
  onFolderNameChange: (value: string) => void
  onParentChange: (value: string) => void
  onPickParent?: () => void
  onSubmit: () => void
  account: ReactNode
}) {
  const enter = submitOnEnter(canSubmit, onSubmit)
  return (
    <div className="space-y-4" data-add-repo-panel="clone">
      <div className="space-y-1.5">
        <Label htmlFor="add-repo-url" className={fieldLabel}>
          {t('Repository URL')}
        </Label>
        <Input
          id="add-repo-url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={enter}
          placeholder="https://github.com/owner/repo.git"
          className="font-mono text-xs placeholder:font-sans"
          disabled={busy}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          data-add-repo-field="url"
        />
      </div>
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="add-repo-clone-name" className={fieldLabel}>
            {t('Folder name')}
          </Label>
          <Input
            id="add-repo-clone-name"
            value={folderName}
            onChange={(e) => onFolderNameChange(e.target.value)}
            onKeyDown={enter}
            placeholder={t('From the repository URL')}
            className="font-mono text-xs placeholder:font-sans"
            disabled={busy}
            aria-invalid={folderProblem ? true : undefined}
            spellCheck={false}
            autoComplete="off"
            data-add-repo-clone-name
          />
          <p className={cn(hint, folderProblem && 'text-destructive')} data-add-repo-clone-name-hint>
            {folderProblem ?? folderNote ?? t("The repository's name unless you change it.")}
          </p>
        </div>
        {displayName}
      </div>
      {account}
      <LocationSummary
        id="add-repo-clone-parent"
        label={t('Clone into')}
        target={target}
        parent={parent}
        busy={busy}
        startOpen={typedParent && !parent}
        onParentChange={onParentChange}
        onPick={onPickParent}
        onEnter={enter}
        problem={targetProblem}
      />
      {gitMissing && <p className="text-[11px] text-destructive">{t('Git is required to clone a repository.')}</p>}
    </div>
  )
}

export interface PublishDraft {
  on: boolean
  account: HostingAccountRef | null
  owner: string
  visibility: 'private' | 'public'
}

export function CreatePanel({
  name,
  folderName,
  parent,
  target,
  busy,
  canSubmit,
  gitMissing,
  typedParent,
  publishAccounts,
  publish,
  displayName,
  onNameChange,
  onParentChange,
  onPickParent,
  onPublishChange,
  onSubmit
}: {
  name: string
  folderName: string
  parent: string
  target: string
  busy: boolean
  canSubmit: boolean
  gitMissing: boolean
  typedParent: boolean
  /** GitHub accounts on the host; publishing is offered only with one. */
  publishAccounts: HostingAccount[]
  publish: PublishDraft
  displayName: ReactNode
  onNameChange: (value: string) => void
  onParentChange: (value: string) => void
  onPickParent?: () => void
  onPublishChange: (publish: PublishDraft) => void
  onSubmit: () => void
}) {
  const enter = submitOnEnter(canSubmit, onSubmit)
  const account = publish.account ?? publishAccounts[0] ?? null
  return (
    <div className="space-y-4" data-add-repo-panel="create">
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="add-repo-name" className={fieldLabel}>
            {t('Name')}
          </Label>
          <Input
            id="add-repo-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={enter}
            placeholder="my-project"
            className="font-mono text-sm"
            disabled={busy}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            data-add-repo-field="name"
          />
          <p className={hint}>{name.trim() && folderName !== name.trim() ? t('The folder is named {name}.', { name: folderName }) : t('A Git repository with a first commit, ready for worktrees.')}</p>
        </div>
        {displayName}
      </div>
      <LocationSummary id="add-repo-create-parent" label={t('Create in')} target={target} parent={parent} busy={busy} startOpen={typedParent && !parent} onParentChange={onParentChange} onPick={onPickParent} onEnter={enter} />
      {gitMissing && <p className="text-[11px] text-destructive">{t('Git is required to create a project.')}</p>}
      {publishAccounts.length > 0 && account ? (
        <div className="space-y-3 rounded-md border border-border/70 p-3" data-add-repo-publish={publish.on ? 'on' : 'off'}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="add-repo-publish" className="text-sm font-normal">
                {t('Publish to GitHub')}
              </Label>
              <p className={hint}>{t('Creates the repository on GitHub and pushes the first commit.')}</p>
            </div>
            <Switch id="add-repo-publish" checked={publish.on} disabled={busy} onCheckedChange={(on) => onPublishChange({ ...publish, on, account })} />
          </div>
          {publish.on && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-repo-publish-account" className={fieldLabel}>
                  {t('Account')}
                </Label>
                <Select
                  value={accountValue(account)}
                  disabled={busy}
                  onValueChange={(value) => {
                    const next = publishAccounts.find((a) => accountValue(a) === value) ?? null
                    onPublishChange({ ...publish, account: next })
                  }}
                >
                  <SelectTrigger id="add-repo-publish-account" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {publishAccounts.map((a) => (
                      <SelectItem key={accountValue(a)} value={accountValue(a)}>
                        {a.host === 'github.com' ? a.login : `${a.login} · ${a.host}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-repo-publish-owner" className={fieldLabel}>
                  {t('Owner')}
                </Label>
                <Input
                  id="add-repo-publish-owner"
                  value={publish.owner}
                  onChange={(e) => onPublishChange({ ...publish, owner: e.target.value })}
                  onKeyDown={enter}
                  placeholder={account.login}
                  disabled={busy}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-repo-publish-visibility" className={fieldLabel}>
                  {t('Visibility')}
                </Label>
                <Select value={publish.visibility} disabled={busy} onValueChange={(v) => onPublishChange({ ...publish, visibility: v === 'public' ? 'public' : 'private' })}>
                  <SelectTrigger id="add-repo-publish-visibility" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">{t('Private')}</SelectItem>
                    <SelectItem value="public">{t('Public')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
