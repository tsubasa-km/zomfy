import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { HARNESS_METHODS, type BranchList, type ProjectHookInfo } from '@acp-harness/protocol'
import { harnessRequest, hostForPath } from '@/daemon-connection'
import type { HostedProject } from '@/session-store'
import { BranchCombobox } from '@/components/sidebar/BranchCombobox'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

// Orca's repository settings pane: display name, default base branch, worktree location and the
// setup/archive scripts that run alongside orca.yaml's.

const fieldLabel = 'text-xs font-medium text-muted-foreground'
const textareaClass =
  'min-h-16 w-full resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30'

export function ProjectSettingsDialog({ project, onClose }: { project: HostedProject | null; onClose: () => void }) {
  const [displayName, setDisplayName] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [worktreeRoot, setWorktreeRoot] = useState('')
  const [setup, setSetup] = useState('')
  const [archive, setArchive] = useState('')
  const [finishWith, setFinishWith] = useState<'merge' | 'pull-request'>('merge')
  const [branches, setBranches] = useState<BranchList | null>(null)
  const [hooks, setHooks] = useState<ProjectHookInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(project?.displayName ?? project?.name ?? '')
    setBaseRef(project?.defaultBaseRef ?? '')
    setWorktreeRoot(project?.worktreeRoot ?? '')
    setSetup(project?.hooks?.setup ?? '')
    setArchive(project?.hooks?.archive ?? '')
    setFinishWith(project?.finishWith ?? 'merge')
    setError(null)
    setBranches(null)
    setHooks(null)
    if (project?.kind === 'git') {
      void harnessRequest(HARNESS_METHODS.branchesList, { projectId: project.id }, project.hostId).then(setBranches, () => undefined)
      void harnessRequest(HARNESS_METHODS.projectHooks, { projectId: project.id }, project.hostId).then(setHooks, () => undefined)
    }
  }, [project])

  async function browse() {
    const folder = await open({ directory: true, title: 'Folder for new worktrees' })
    if (typeof folder === 'string') setWorktreeRoot(hostForPath(folder).path)
  }

  async function save() {
    if (!project) return
    try {
      await harnessRequest(
        HARNESS_METHODS.projectUpdate,
        {
          projectId: project.id,
          patch: {
            displayName: displayName.trim() === project.name ? '' : displayName,
            ...(project.kind === 'git' ? { defaultBaseRef: baseRef, worktreeRoot, hooks: { setup, archive }, finishWith } : {})
          }
        },
        project.hostId
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const isGit = project?.kind === 'git'
  return (
    <Dialog open={project !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-lg" data-project-settings-dialog>
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription className="break-all">{project?.path}</DialogDescription>
        </DialogHeader>
        <form
          className="min-h-0 space-y-4 overflow-y-auto px-0.5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="project-display-name" className={fieldLabel}>
              Display name
            </Label>
            <Input id="project-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          {isGit && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="project-base-ref" className={fieldLabel}>
                  Default base branch
                </Label>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <BranchCombobox
                      id="project-base-ref"
                      value={baseRef}
                      placeholder="Automatic (origin/HEAD, main or master)"
                      onChange={setBaseRef}
                      groups={[
                        { heading: 'Local', options: (branches?.branches ?? []).map((b) => ({ value: b })) },
                        { heading: 'Remote', options: (branches?.remoteBranches ?? []).map((b) => ({ value: b })) }
                      ]}
                    />
                  </div>
                  {baseRef && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setBaseRef('')}>
                      Reset
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-finish-with" className={fieldLabel}>
                  When a chat's work is done
                </Label>
                <Select value={finishWith} onValueChange={(v) => setFinishWith(v === 'pull-request' ? 'pull-request' : 'merge')}>
                  <SelectTrigger id="project-finish-with" data-project-finish-with>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">Merge into the main checkout, then remove the worktree</SelectItem>
                    <SelectItem value="pull-request">Push and open a pull request, keep the worktree</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-worktree-root" className={fieldLabel}>
                  Worktree location
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="project-worktree-root"
                    value={worktreeRoot}
                    onChange={(e) => setWorktreeRoot(e.target.value)}
                    placeholder="Default (the harness workspaces folder)"
                    className="font-mono text-xs"
                  />
                  {isTauri() && (
                    <Button type="button" variant="outline" onClick={() => void browse()}>
                      Browse…
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">New worktrees go in a folder named after the project here.</p>
              </div>
              <HookField
                id="project-setup"
                label="Setup script"
                hint="Runs in a terminal after a worktree is created."
                fileScript={hooks?.fileHooks.setup}
                file={hooks?.file ?? null}
                value={setup}
                onChange={setSetup}
              />
              <HookField
                id="project-archive"
                label="Archive script"
                hint="Runs before a worktree is deleted."
                fileScript={hooks?.fileHooks.archive}
                file={hooks?.file ?? null}
                value={archive}
                onChange={setArchive}
              />
            </>
          )}
          {error && <p className="text-sm break-words text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
          <p className="text-[11px] text-muted-foreground">From {file}, runs first:</p>
          <pre className="max-h-24 overflow-auto rounded-md border border-border/60 bg-muted/25 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
            {fileScript}
          </pre>
        </div>
      )}
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={fileScript ? 'Additional local commands' : 'One command per line, e.g. pnpm install'}
        className={cn(textareaClass)}
      />
      <p className="text-[11px] text-muted-foreground">
        {hint} On Windows the script runs with cmd unless it starts with #!, which runs it in Git Bash.
      </p>
    </div>
  )
}
