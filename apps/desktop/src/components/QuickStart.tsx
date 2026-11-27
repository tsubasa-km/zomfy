import { useMemo, useState } from 'react'
import { ChevronDown, Folder, GitBranchPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS } from '@zomfy/protocol'
import { createSession, harnessRequest } from '@/daemon-connection'
import {
  allProjects,
  allWorkspaces,
  closeStartTab,
  getState,
  setStartWorkspace,
  START_TAB,
  useStore,
  type ChatImage,
  type HostId
} from '@/session-store'
import { groupOfTab, layoutFor, placeTab, setGroupContext, WINDOW_TABS } from '@/stores/tab-layout-store'
import { setStartProject, useSidebarStore } from '@/stores/sidebar-store'
import { patchChatSession } from '@/stores/chat-store'
import { NEW_THREAD_DRAFT, type NewThreadStart } from '@/stores/new-thread-store'
import { setSessionOptions, submitPrompt } from '@/chat-actions'
import { announceSent } from '@/lib/chat-after-send'
import { suggestWorkspaceName } from '@/lib/workspace-name-suggestion'
import { useSetting } from '@/stores/settings-store'
import { projectLabel, sortProjects, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { sortedHosts } from '@/components/settings/HostsPane'
import { defaultHostId } from '@/lib/default-host'
import { NewThreadComposer } from '@/components/native-chat/NewThreadComposer'
import { ProjectPicker, projectKey } from '@/components/projects/ProjectPicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { t } from '@/i18n/i18n'

// The "New thread" tab, as in the Claude apps: type and go. With no project picked the chat starts in
// its own scratch folder, and its agent moves it into a project when the work needs one
// (move_chat). With a project picked it starts there: in a worktree of its own for a git project,
// so chats working at once never edit the same checkout. The composer is an open chat's own
// (NewThreadComposer); under it, as under T3 Code's new thread, sits where the thread starts.


export function QuickStart() {
  const hosts = useStore((s) => s.hosts)
  const connected = sortedHosts(hosts).filter((h) => h.connection.kind === 'connected')
  const [hostId, setHostId] = useState<HostId | null>(null)
  const [busy, setBusy] = useState(false)
  const afterSend = useSetting('chatAfterSend')
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
  // The chip offers the project's other workspaces, so a chat can start beside the one it came from.
  const everyWorkspace = useStore((s) => allWorkspaces(s))
  const siblings = useMemo(
    () => (workspace?.projectId ? everyWorkspace.filter((w) => w.hostId === workspace.hostId && w.projectId === workspace.projectId) : []),
    [everyWorkspace, workspace]
  )
  // Leaving the workspace keeps its project picked, so "somewhere else" starts from the same project.
  const startElsewhere = () => {
    setStartProject(workspaceProject ? projectKey(workspaceProject) : null)
    setStartWorkspace(null)
  }
  // A git project's thread gets a worktree of its own; until it exists, the main checkout stands in for its files and commands.
  const projectFolder = useStore((s) =>
    project ? (allWorkspaces(s).find((w) => w.hostId === project.hostId && w.projectId === project.id && w.isPrimary)?.id ?? null) : null
  )

  async function start(text: string, images: ChatImage[], choice: NewThreadStart) {
    if (busy) return
    setBusy(true)
    // The words leave the box at once; a start that fails gives them back.
    patchChatSession(NEW_THREAD_DRAFT, { draft: '', draftImages: [] })
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
        if (!primary) throw new Error(t('The project has no folder to start a thread in.'))
        place = primary
      } else {
        const scratch = await harnessRequest(HARNESS_METHODS.workspaceCreateScratch, {}, target)
        place = { id: scratch.id, hostId: target }
      }
      const { agent, options } = choice
      const sessionId = await createSession(place.id, agent, { hostId: place.hostId, focus: !stay, permissionMode: options.permissionMode })
      // The session's options are what its next turn launches with: set before the prompt goes, they are the first turn's.
      if (agent === 'claude' && (options.model !== null || options.effort !== null)) {
        await setSessionOptions(sessionId, { model: options.model, effort: options.effort })
      }
      submitPrompt(sessionId, text, images)
      if (workspaceId) setStartWorkspace(null)
      if (stay) announceSent(sessionId)
      else {
        if (slot && index !== -1) placeTab(WINDOW_TABS, sessionId, slot.id, index)
        // The pane follows the chat it now shows (docs/specs/panes-as-workspaces.md).
        if (slot) setGroupContext(WINDOW_TABS, slot.id, place.id)
        closeStartTab()
      }
    } catch (error) {
      patchChatSession(NEW_THREAD_DRAFT, (c) => ({
        draft: c.draft.trim() ? `${text}\n\n${c.draft}` : text,
        draftImages: [...images, ...c.draftImages]
      }))
      toast.error(t('Could not start the thread'), { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="m-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-4 px-3 py-6 sm:px-4" data-quick-start>
      <h1 className="text-center text-lg font-medium text-foreground">{t('What should we work on?')}</h1>
      <div className="flex flex-col gap-1.5 select-none">
        <NewThreadComposer
          hostId={workspace?.hostId ?? project?.hostId ?? target}
          workspaceId={workspace?.id ?? projectFolder}
          busy={busy}
          onStart={(text, images, choice) => void start(text, images, choice)}
        />
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1" data-quick-start-strip>
          <div className="flex min-w-0 items-center gap-1">
            {workspace ? (
              // The person came from this workspace; the chip gives the choice back.
              <span
                className="inline-flex h-7 min-w-0 items-center gap-1 rounded-md bg-accent/60 pr-0.5 pl-2 text-xs text-foreground"
                data-quick-start-workspace
              >
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-1 rounded-sm hover:text-foreground"
                      aria-label={t('Choose where the thread starts')}
                      title={t('Choose where the thread starts')}
                      data-quick-start-workspace-menu
                    >
                      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">
                        {workspaceProject ? projectLabel(workspaceProject) : workspaceLabel(workspace)}
                        {workspaceProject && workspace.branch ? ` · ${workspace.branch}` : ''}
                      </span>
                      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-w-80">
                    {siblings.map((w) => (
                      <DropdownMenuItem key={w.id} data-quick-start-sibling={w.id} onSelect={() => setStartWorkspace(w.id)}>
                        <Folder className="size-4" />
                        <span className="min-w-0 flex-1 truncate">{w.branch ?? workspaceLabel(w)}</span>
                        {w.id === workspace.id ? <span className="text-xs text-muted-foreground">{t('Current')}</span> : null}
                      </DropdownMenuItem>
                    ))}
                    {workspaceProject?.kind === 'git' && (
                      <DropdownMenuItem data-quick-start-new-worktree onSelect={startElsewhere}>
                        <GitBranchPlus className="size-4" />
                        {t('New worktree')}
                      </DropdownMenuItem>
                    )}
                    {siblings.length > 0 || workspaceProject?.kind === 'git' ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem
                      data-quick-start-elsewhere
                      onSelect={() => {
                        setStartProject(null)
                        setStartWorkspace(null)
                      }}
                    >
                      <X className="size-4" />
                      {t('Another project or host…')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  aria-label={t('Start somewhere else')}
                  title={t('Start somewhere else')}
                  className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={startElsewhere}
                >
                  <X className="size-3" />
                </button>
              </span>
            ) : (
              // Choosing and creating a project are one control: its list ends with add, clone and create.
              <ProjectPicker value={project ? projectKey(project) : null} onChange={setStartProject} hostId={target} />
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
        </div>
      </div>
    </div>
  )
}
