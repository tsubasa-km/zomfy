import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  HARNESS_METHODS,
  isChatAgentId,
  type BranchList,
  type ChatAgentId,
  type ProjectHookInfo,
  type Workspace
} from '@acp-harness/protocol'
import { createSession, harnessRequest, sendPrompt } from '@/daemon-connection'
import { LOCAL_HOST, selectTerminal, selectWorkspace, useStore, type HostedProject } from '@/session-store'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { useChatAgents } from '@/lib/chat-agents'
import { BranchCombobox } from '@/components/sidebar/BranchCombobox'
import { projectLabel, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { defaultChatAgent } from '@/lib/default-chat-agent'

// Orca's NewWorkspaceComposerModal: name, agent and first prompt up front; branch name override,
// base branch or an existing branch, parent workspace, note and the setup script under Advanced.

const NO_PARENT = '__none__'
const fieldLabel = 'text-xs font-medium text-muted-foreground'
const textareaClass =
  'w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'

type StartFrom = 'new-branch' | 'existing-branch'
type AgentChoice = ChatAgentId | 'none'

export interface NewWorkspaceRequest {
  project: HostedProject
  parent?: Workspace
}

export function NewWorkspaceDialog({ request, onClose }: { request: NewWorkspaceRequest | null; onClose: () => void }) {
  const project = request?.project ?? null
  const isGit = project?.kind === 'git'
  const hosts = useStore((s) => s.hosts)
  const [name, setName] = useState('')
  const [agent, setAgent] = useState<AgentChoice>(defaultChatAgent)
  const chatAgents = useChatAgents(project?.hostId ?? LOCAL_HOST).agents.filter((a) => a.status === 'ready')
  const [prompt, setPrompt] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [startFrom, setStartFrom] = useState<StartFrom>('new-branch')
  const [baseRef, setBaseRef] = useState('')
  const [existingBranch, setExistingBranch] = useState('')
  const [branchName, setBranchName] = useState('')
  const [parentId, setParentId] = useState(NO_PARENT)
  const [note, setNote] = useState('')
  const [runSetup, setRunSetup] = useState(true)
  const [branches, setBranches] = useState<BranchList | null>(null)
  const [hooks, setHooks] = useState<ProjectHookInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName('')
    setPrompt('')
    setAgent(defaultChatAgent())
    setStartFrom('new-branch')
    setExistingBranch('')
    setBranchName('')
    setNote('')
    setRunSetup(true)
    setError(null)
    setBranches(null)
    setHooks(null)
    setParentId(request?.parent?.id ?? NO_PARENT)
    // A child starts from its parent's branch, as Orca's lineage does.
    setBaseRef(request?.parent?.branch ?? '')
    setAdvanced(!!request?.parent)
    if (request?.project.kind === 'git') {
      const { id, hostId } = request.project
      void harnessRequest(HARNESS_METHODS.branchesList, { projectId: id }, hostId).then(setBranches, () => undefined)
      void harnessRequest(HARNESS_METHODS.projectHooks, { projectId: id }, hostId).then(setHooks, () => undefined)
    }
  }, [request])

  const siblings = useMemo(
    () => (project ? (hosts[project.hostId]?.harness?.workspaces ?? []).filter((w) => w.projectId === project.id && w.branch) : []),
    [hosts, project]
  )
  const setupScript = [hooks?.fileHooks.setup, hooks?.localHooks.setup].filter(Boolean).join('\n')
  const checkedOut = new Set(branches?.checkedOut ?? [])

  async function create() {
    if (!project) return
    if (startFrom === 'existing-branch' && isGit && !existingBranch) {
      setError('Pick the branch to check out')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const existing = isGit && startFrom === 'existing-branch'
      const workspace = await harnessRequest(
        HARNESS_METHODS.workspaceCreate,
        {
          projectId: project.id,
          name: name.trim() || (existing ? '' : 'workspace'),
          ...(existing ? { existingBranch } : {}),
          ...(!existing && baseRef ? { baseRef } : {}),
          ...(!existing && branchName.trim() ? { branchName: branchName.trim() } : {}),
          ...(parentId !== NO_PARENT ? { parentWorkspaceId: parentId } : {}),
          ...(note.trim() ? { comment: note.trim() } : {}),
          runSetup: runSetup && !!setupScript
        },
        project.hostId
      )
      selectWorkspace(workspace.id)
      if (agent !== 'none') {
        const sessionId = await createSession(workspace.id, agent)
        if (prompt.trim()) void sendPrompt(sessionId, prompt.trim())
      } else if (workspace.setupTerminalId) {
        selectTerminal(workspace.setupTerminalId)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const label = project ? projectLabel(project) : ''
  return (
    <Dialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-lg" data-new-workspace-dialog>
        <DialogHeader>
          <DialogTitle>{isGit ? 'Create Workspace' : 'Create Folder Workspace'}</DialogTitle>
          <DialogDescription>
            {isGit
              ? request?.parent
                ? `A child of ${workspaceLabel(request.parent)} in ${label}.`
                : `A new git worktree and branch in ${label}.`
              : `A new workspace in ${label}. Folder workspaces share the folder.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-h-0 space-y-4 overflow-y-auto px-0.5 pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name" className={fieldLabel}>
              Name
            </Label>
            <Input
              id="workspace-name"
              autoFocus
              placeholder={startFrom === 'existing-branch' ? 'Defaults to the branch name' : 'fix-login-bug'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-[8rem_1fr] items-start gap-3">
            <div className="space-y-1.5">
              <Label className={fieldLabel}>Agent</Label>
              <Select value={agent} onValueChange={(v) => setAgent(isChatAgentId(v) ? v : 'none')}>
                <SelectTrigger className="w-full" data-agent-select>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(chatAgents.length > 0 ? chatAgents : [{ id: 'claude' as const, label: 'Claude' }]).map((a) => (
                    <SelectItem key={a.id} value={a.id} data-agent-option={a.id}>
                      <TuiAgentIcon agent={a.id} size={14} />
                      {a.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="none">No agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workspace-prompt" className={fieldLabel}>
                First prompt
              </Label>
              <textarea
                id="workspace-prompt"
                rows={2}
                disabled={agent === 'none'}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={agent === 'none' ? 'No agent will start' : 'What should the agent do? (optional)'}
                className={cn(textareaClass, 'max-h-40 disabled:opacity-50')}
              />
            </div>
          </div>

          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={advanced}
            data-advanced-toggle
            onClick={() => setAdvanced(!advanced)}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', advanced && 'rotate-90')} />
            Advanced
          </button>

          {advanced && (
            <div className="space-y-4" data-advanced-section>
              {isGit && (
                <>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={startFrom}
                    onValueChange={(v) => v && setStartFrom(v === 'existing-branch' ? 'existing-branch' : 'new-branch')}
                  >
                    <ToggleGroupItem value="new-branch" data-start-from="new-branch" className="px-3 text-xs">
                      New branch
                    </ToggleGroupItem>
                    <ToggleGroupItem value="existing-branch" data-start-from="existing-branch" className="px-3 text-xs">
                      Existing branch
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {startFrom === 'new-branch' ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="workspace-base" className={fieldLabel}>
                          Base branch
                        </Label>
                        <BranchCombobox
                          id="workspace-base"
                          value={baseRef}
                          placeholder={`Default (${branches?.defaultBaseRef ?? 'origin/HEAD, main or master'})`}
                          onChange={setBaseRef}
                          groups={[
                            {
                              heading: 'Local',
                              options: (branches?.branches ?? []).map((b) => ({
                                value: b,
                                hint: b === branches?.current ? 'current' : undefined
                              }))
                            },
                            { heading: 'Remote', options: (branches?.remoteBranches ?? []).map((b) => ({ value: b })) }
                          ]}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="workspace-branch-name" className={fieldLabel}>
                          Branch name
                        </Label>
                        <Input
                          id="workspace-branch-name"
                          placeholder="Defaults to <git user>/<name>"
                          value={branchName}
                          onChange={(e) => setBranchName(e.target.value)}
                          className="font-mono text-xs"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-existing" className={fieldLabel}>
                        Branch to check out
                      </Label>
                      <BranchCombobox
                        id="workspace-existing"
                        value={existingBranch}
                        placeholder="Pick a branch"
                        onChange={setExistingBranch}
                        groups={[
                          {
                            heading: 'Local',
                            options: (branches?.branches ?? []).map((b) => ({
                              value: b,
                              disabled: checkedOut.has(b),
                              hint: checkedOut.has(b) ? 'checked out' : undefined
                            }))
                          }
                        ]}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className={fieldLabel}>Parent workspace</Label>
                    <Select value={parentId} onValueChange={setParentId}>
                      <SelectTrigger className="w-full" data-parent-select>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_PARENT}>None</SelectItem>
                        {siblings.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {workspaceLabel(w)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="workspace-note" className={fieldLabel}>
                  Note
                </Label>
                <textarea
                  id="workspace-note"
                  rows={1}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Write a note"
                  className={cn(textareaClass, 'max-h-40')}
                />
              </div>

            </div>
          )}

          {/* Shown outside Advanced: a repo's script should never run unseen. */}
            {isGit && setupScript && (
              <div className="space-y-2" data-setup-section>
                <div className="flex items-center justify-between gap-2">
                  <span className={fieldLabel}>Setup script</span>
                  <span className="rounded border border-border/50 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {hooks?.file && hooks.localHooks.setup
                      ? `${hooks.file} + local`
                      : hooks?.fileHooks.setup
                        ? hooks.file
                        : 'local settings'}
                  </span>
                </div>
                <pre className="max-h-28 overflow-auto rounded-md border border-border/60 bg-muted/25 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
                  {setupScript}
                </pre>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/25 p-2.5">
                  <span className="text-xs font-medium text-foreground">Run setup script in a terminal</span>
                  <Switch checked={runSetup} onCheckedChange={setRunSetup} data-run-setup />
                </label>
              </div>
            )}

          {error && <p className="text-sm break-words text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
