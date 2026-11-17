import { useRef, useState } from 'react'
import { ArrowUp, FolderPlus, GitBranch, X } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { createSession, harnessRequest } from '@/daemon-connection'
import {
  allProjects,
  allWorkspaces,
  closeStartTab,
  getState,
  setStartWorkspace,
  START_TAB,
  useStore,
  type HostedProject,
  type HostId
} from '@/session-store'
import { groupOfTab, layoutFor, placeTab, WINDOW_TABS } from '@/stores/tab-layout-store'
import { setStartProject, useSidebarStore } from '@/stores/sidebar-store'
import { submitPrompt } from '@/chat-actions'
import { announceSent } from '@/lib/chat-after-send'
import { defaultChatAgent } from '@/lib/default-chat-agent'
import { suggestWorkspaceName } from '@/lib/workspace-name-suggestion'
import { useSetting } from '@/stores/settings-store'
import { isSubmitShortcut, SUBMIT_SHORTCUT_LABEL } from '@/lib/terminal-shortcuts'
import { openAddProjectDialog } from '@/lib/project-dialogs'
import { projectLabel, sortProjects, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { sortedHosts } from '@/components/settings/HostsPane'
import { defaultHostId } from '@/lib/default-host'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n/i18n'

// The "New chat" tab, as in the Claude apps: type and go. With no project picked the chat starts in
// its own scratch folder, and its agent moves it into a project when the work needs one
// (move_chat). With a project picked it starts there: in a worktree of its own for a git project,
// so chats working at once never edit the same checkout.

const NO_PROJECT = 'none'
const projectKey = (p: HostedProject) => `${p.hostId}:${p.id}`

export function QuickStart() {
  const hosts = useStore((s) => s.hosts)
  const connected = sortedHosts(hosts).filter((h) => h.connection.kind === 'connected')
  const [hostId, setHostId] = useState<HostId | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const sendKey = useSetting('chatSendKey')
  const afterSend = useSetting('chatAfterSend')
  useSetting('defaultChatAgent')
  useSetting('defaultHost')
  const defaultHost = defaultHostId()
  const target = hostId && connected.some((h) => h.id === hostId) ? hostId : defaultHost

  // Where the chat starts: a workspace the person came from that has nothing open, else the project picked here, else a scratch folder.
  const projects = connected.flatMap((h) => sortProjects(h.harness?.projects ?? []).map((p) => ({ ...p, hostId: h.id })))
  const picked = useSidebarStore((s) => s.startProject)
  const project = projects.find((p) => projectKey(p) === picked) ?? null
  const workspaceId = useStore((s) => s.startTab.workspaceId)
  const workspace = useStore((s) => (workspaceId ? (allWorkspaces(s).find((w) => w.id === workspaceId) ?? null) : null))
  const workspaceProject = workspace ? allProjects(hosts).find((p) => p.hostId === workspace.hostId && p.id === workspace.projectId) : undefined

  async function start() {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    // The chat takes this tab's place unless the person stays here for the next one.
    const stay = afterSend === 'new-chat'
    const slot = groupOfTab(layoutFor(WINDOW_TABS), START_TAB)
    const index = slot?.tabOrder.indexOf(START_TAB) ?? -1
    try {
      let place: { id: string; hostId: HostId }
      if (workspace) place = workspace
      else if (project?.kind === 'git') {
        const created = await harnessRequest(
          HARNESS_METHODS.workspaceCreate,
          { projectId: project.id, name: suggestWorkspaceName(), runSetup: true },
          project.hostId
        )
        place = { id: created.id, hostId: project.hostId }
      } else if (project) {
        const primary = allWorkspaces(getState()).find((w) => w.hostId === project.hostId && w.projectId === project.id && w.isPrimary)
        if (!primary) throw new Error(t('The project has no folder to start a chat in.'))
        place = primary
      } else {
        const scratch = await harnessRequest(HARNESS_METHODS.workspaceCreateScratch, {}, target)
        place = { id: scratch.id, hostId: target }
      }
      const sessionId = await createSession(place.id, defaultChatAgent(), { hostId: place.hostId, focus: !stay })
      submitPrompt(sessionId, text, [])
      setDraft('')
      if (workspaceId) setStartWorkspace(null)
      if (stay) announceSent(sessionId)
      else {
        if (slot && index !== -1) placeTab(WINDOW_TABS, sessionId, slot.id, index)
        closeStartTab()
      }
    } catch (error) {
      toast.error(t('Could not start the chat'), { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
      // The box was disabled while sending, which dropped its focus; staying here means typing on.
      if (stay) requestAnimationFrame(() => input.current?.focus())
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return
    if (isSubmitShortcut(e) || (sendKey === 'enter' && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault()
      void start()
    }
  }

  const hostBadge = (id: HostId) => (id !== defaultHost ? ` · ${hosts[id]?.label ?? id}` : '')
  const where = workspace
    ? t('Starts in {place}.', {
        place: workspaceProject ? `${projectLabel(workspaceProject)} · ${workspace.branch ?? workspaceLabel(workspace)}` : workspaceLabel(workspace)
      })
    : project?.kind === 'git'
      ? t('Starts in a worktree of its own in {project}, so it never edits the same checkout as another chat.', { project: projectLabel(project) })
      : project
        ? t('Starts in {place}.', { place: projectLabel(project) })
        : t('Starts right away in a fresh folder. The agent moves the chat into a project when the work needs one.')

  return (
    <div className="m-auto flex w-full max-w-xl flex-col gap-4 px-6 py-6" data-quick-start>
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-medium text-foreground">{t('What should we work on?')}</h1>
        <p className="text-xs text-muted-foreground" data-quick-start-where>
          {where}
        </p>
      </div>
      <div className="rounded-xl border border-input bg-card p-1.5 shadow-xs focus-within:border-ring">
        <Textarea
          ref={input}
          autoFocus
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('Ask anything, or describe a task')}
          aria-label={t('Start a chat')}
          className="max-h-60 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <div className="flex min-w-0 items-center gap-1">
            {workspace ? (
              // The person came from this workspace; the chip gives the choice back.
              <span
                className="inline-flex h-7 min-w-0 items-center gap-1 rounded-md bg-accent/60 pr-0.5 pl-2 text-xs text-foreground"
                data-quick-start-workspace
              >
                <span className="min-w-0 truncate">
                  {workspaceProject ? projectLabel(workspaceProject) : workspaceLabel(workspace)}
                  {workspaceProject && workspace.branch ? ` · ${workspace.branch}` : ''}
                </span>
                <button
                  type="button"
                  aria-label={t('Start somewhere else')}
                  title={t('Start somewhere else')}
                  className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setStartWorkspace(null)}
                >
                  <X className="size-3" />
                </button>
              </span>
            ) : (
              <Select value={project ? projectKey(project) : NO_PROJECT} onValueChange={(v) => setStartProject(v === NO_PROJECT ? null : v)}>
                <SelectTrigger size="sm" className="h-7 w-auto max-w-56 border-0 text-xs shadow-none" aria-label={t('Project')} data-quick-start-project>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT}>{t('No project')}</SelectItem>
                  {projects.length > 0 && <SelectSeparator />}
                  {projects.map((p) => (
                    <SelectItem key={projectKey(p)} value={projectKey(p)}>
                      {projectLabel(p)}
                      {hostBadge(p.hostId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!workspace && !project && connected.length > 1 && (
              <Select value={target} onValueChange={setHostId}>
                <SelectTrigger size="sm" className="h-7 w-auto border-0 text-xs shadow-none" aria-label={t('Host')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {connected.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <Button
            size="icon"
            className="size-7 shrink-0 rounded-full"
            disabled={!draft.trim() || busy}
            aria-label={t('Start chat ({key})', { key: sendKey === 'enter' ? '↵' : SUBMIT_SHORTCUT_LABEL })}
            onClick={() => void start()}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex justify-center gap-2">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => openAddProjectDialog({ hostId: target })}>
          <FolderPlus className="size-4" />
          {t('Add a project')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => openAddProjectDialog({ hostId: target, step: 'clone' })}
        >
          <GitBranch className="size-4" />
          {t('Clone a repository')}
        </Button>
      </div>
    </div>
  )
}
