import { useState, type KeyboardEvent } from 'react'
import { ChevronDown, Folder, GitBranch, Loader2 } from 'lucide-react'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { joinHostPath, projectFolderName, repoFolderName } from '@/lib/project-target-path'
import { t } from '@/i18n/i18n'

// Orca's AddRepoCloneStep, AddRepoCreateStep and server-path step: each shows where the project will
// land on the chosen host before anything runs there.

const fieldLabel = 'block text-[11px] font-medium text-muted-foreground'

function submitOnEnter(canSubmit: boolean, submit: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (canSubmit) submit()
  }
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p className="text-[11px] break-words text-destructive" role="alert">
      {error}
    </p>
  ) : null
}

function ParentField({
  value,
  placeholder,
  busy,
  onChange,
  onPick,
  onEnter
}: {
  value: string
  placeholder: string
  busy: boolean
  onChange: (value: string) => void
  /** Absent where no folder picker reaches the host (SSH). */
  onPick?: () => void
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter}
        placeholder={placeholder}
        className="h-8 flex-1 font-mono text-xs"
        disabled={busy}
        spellCheck={false}
        data-add-repo-parent
      />
      {onPick ? (
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 px-2" onClick={onPick} disabled={busy} title={t('Choose folder')} aria-label={t('Choose folder')}>
          <Folder className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

export function AddRepoCloneStep({
  hostLabel,
  url,
  parent,
  busy,
  error,
  gitAvailable,
  onUrlChange,
  onParentChange,
  onPickParent,
  onClone
}: {
  hostLabel: string
  url: string
  parent: string
  busy: boolean
  error: string | null
  gitAvailable: boolean | null
  onUrlChange: (value: string) => void
  onParentChange: (value: string) => void
  onPickParent?: () => void
  onClone: () => void
}) {
  const canClone = !!url.trim() && !!parent.trim() && !busy && gitAvailable !== false
  const enter = submitOnEnter(canClone, onClone)
  const target = url.trim() && parent.trim() ? joinHostPath(parent, repoFolderName(url)) : ''
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('Clone from URL')}</DialogTitle>
        <DialogDescription>{t('Enter the Git URL and choose where to clone it on {host}.', { host: hostLabel })}</DialogDescription>
      </DialogHeader>
      <div className="min-w-0 space-y-3 pt-1" data-add-repo-step="clone">
        <div className="space-y-1">
          <label className={fieldLabel}>{t('Git URL')}</label>
          <Input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={enter}
            placeholder="https://github.com/user/repo.git"
            className="h-8 text-xs"
            disabled={busy}
            autoFocus
            spellCheck={false}
            data-add-repo-url
          />
        </div>
        <div className="space-y-1">
          <label className={fieldLabel}>{t('Parent folder')}</label>
          <ParentField value={parent} placeholder="/path/to/destination" busy={busy} onChange={onParentChange} onPick={onPickParent} onEnter={enter} />
          {target ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={target} data-add-repo-target>
              {target}
            </p>
          ) : null}
        </div>
        {gitAvailable === false ? <p className="text-[11px] text-destructive">{t('Git is required to clone a repository.')}</p> : null}
        <ErrorText error={error} />
        <Button onClick={onClone} disabled={!canClone} className="w-full">
          {busy ? t('Cloning…') : t('Clone')}
        </Button>
      </div>
    </>
  )
}

export function AddRepoCreateStep({
  name,
  parent,
  busy,
  error,
  gitAvailable,
  defaultsPending,
  typedParent,
  onNameChange,
  onParentChange,
  onPickParent,
  onCreate
}: {
  name: string
  parent: string
  busy: boolean
  error: string | null
  gitAvailable: boolean | null
  defaultsPending: boolean
  /** No picker reaches the host, so the location field starts open. */
  typedParent: boolean
  onNameChange: (value: string) => void
  onParentChange: (value: string) => void
  onPickParent?: () => void
  onCreate: () => void
}) {
  const [locationOpen, setLocationOpen] = useState(typedParent)
  // A failed probe is unknown; only a confirmed miss blocks creating.
  const canCreate = !!name.trim() && !!parent.trim() && gitAvailable !== false && !defaultsPending && !busy
  const enter = submitOnEnter(canCreate, onCreate)
  const target = parent.trim() ? joinHostPath(parent, projectFolderName(name.trim() || 'project-name')) : ''
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('Create a new project')}</DialogTitle>
        <DialogDescription>{t('Name it and Zomfy will create a Git repository with a first commit.')}</DialogDescription>
      </DialogHeader>
      <div className="min-w-0 space-y-3.5 pt-1" data-add-repo-step="create">
        <div className="space-y-1">
          <label htmlFor="create-project-name" className={fieldLabel}>
            {t('Name')}
          </label>
          <Input
            id="create-project-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={enter}
            placeholder="my-project"
            className="h-11 font-mono text-sm"
            disabled={busy}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* The summary doubles as the disclosure for the location, as in Orca. */}
        <div className="min-w-0 rounded-md border border-border bg-muted/30">
          <button
            type="button"
            onClick={() => setLocationOpen((o) => !o)}
            aria-expanded={locationOpen}
            className="flex w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground">
              <GitBranch className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t('Git repository in {location}', { location: parent.trim() || t('location not selected') })}</p>
              {defaultsPending ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  {t('Checking Git on this host...')}
                </p>
              ) : gitAvailable === false ? (
                <p className="mt-0.5 text-[11px] text-destructive">{t('Git is required to create a project.')}</p>
              ) : target ? (
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={target} data-add-repo-target>
                  {target}
                </p>
              ) : (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{t('Choose or enter a parent folder before creating.')}</p>
              )}
            </div>
            <ChevronDown className={cn('size-4 shrink-0 self-center text-muted-foreground transition-transform', locationOpen && 'rotate-180')} />
          </button>
          {locationOpen ? (
            <div className="space-y-1 border-t border-border px-3 py-3">
              <span className={fieldLabel}>{t('Location')}</span>
              <ParentField value={parent} placeholder="/home/user/projects" busy={busy} onChange={onParentChange} onPick={onPickParent} onEnter={enter} />
            </div>
          ) : null}
        </div>

        <ErrorText error={error} />
        <Button onClick={onCreate} disabled={!canCreate} size="lg" className="w-full">
          {busy ? t('Creating…') : t('Create project')}
        </Button>
      </div>
    </>
  )
}

export function AddRepoPathStep({
  hostLabel,
  path,
  busy,
  error,
  onPathChange,
  onAdd
}: {
  hostLabel: string
  path: string
  busy: boolean
  error: string | null
  onPathChange: (value: string) => void
  onAdd: () => void
}) {
  const canAdd = !!path.trim() && !busy
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('Add folder on {host}', { host: hostLabel })}</DialogTitle>
        <DialogDescription>{t('Enter the path of an existing Git repository or folder on the host.')}</DialogDescription>
      </DialogHeader>
      <div className="min-w-0 space-y-3 pt-1" data-add-repo-step="path">
        <div className="space-y-1">
          <label className={fieldLabel}>{t('Folder path on the host')}</label>
          <Input
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            onKeyDown={submitOnEnter(canAdd, onAdd)}
            placeholder="~/src/project"
            className="h-8 font-mono text-xs"
            disabled={busy}
            autoFocus
            spellCheck={false}
            data-add-repo-path
          />
        </div>
        <ErrorText error={error} />
        <Button onClick={onAdd} disabled={!canAdd} className="w-full">
          {busy ? t('Adding…') : t('Add project')}
        </Button>
      </div>
    </>
  )
}
