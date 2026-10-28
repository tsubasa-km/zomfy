import { memo, type ReactNode } from 'react'
import { BookOpen, CalendarClock, Github, Gitlab, LayoutDashboard, List, Search, SquarePen, Workflow, type LucideIcon } from 'lucide-react'
import type { HostingProviderId } from '@acp-harness/protocol'
import { allProjects, getState, setDashboardOpen, showQuickStart, useStore } from '@/session-store'
import { setBoardOpen, useSidebarStore } from '@/stores/sidebar-store'
import { setAutomationsPageOpen, useAutomationState } from '@/stores/automation-store'
import { setCommandPalette, setSkillsPageOpen, useAppOverlays } from '@/stores/app-overlay-store'
import { getTasks, setTasks, useTasks } from '@/stores/tasks-store'
import { openWorkflows, useWorkflowsPage } from '@/stores/workflows-store'
import { openWorkflowsHere } from '@/lib/workflows-entry'
import { setSetting, useSetting, type SettingKey } from '@/stores/settings-store'
import { useShortcutKeys } from '@/keybindings/keybinding-registry'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { AgentQuestionIcon } from '@/components/AgentQuestionIcon'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { SetupChecklistSidebarEntry } from './SetupChecklistSidebarEntry'
import { HideSidebarMenu } from './sidebar-nav-controls'

// Orca's SidebarNav (sidebar/SidebarNav.tsx, SidebarTaskNavButton, AgentDashboardSidebarEntry): the
// rows above the workspace list. Optional rows hide from their context menu or Settings › Appearance.

const ROW = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors'
const ROW_ACTIVE = 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
const ROW_IDLE = 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'

function NavRow({
  icon: Icon,
  label,
  active,
  onClick,
  hideSetting,
  data,
  trailing
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
  hideSetting: SettingKey
  data: string
  trailing?: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-current={active ? 'page' : undefined}
          data-sidebar-nav={data}
          className={cn(ROW, active ? ROW_ACTIVE : ROW_IDLE)}
        >
          <Icon className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')} strokeWidth={active ? 2.25 : 1.75} />
          <span className="flex-1">{label}</span>
          {trailing}
        </button>
      </ContextMenuTrigger>
      <HideSidebarMenu onHide={() => setSetting(hideSetting, false)} />
    </ContextMenu>
  )
}

/** Tasks draws in the main area; the dashboard and board draw over it, so they close first. */
function openTasksPage(open: boolean): void {
  setDashboardOpen(false)
  setBoardOpen(false)
  setTasks({ open })
}

function SearchRow() {
  const keys = useShortcutKeys('workspace.palette')
  return (
    <button
      type="button"
      onClick={() => setCommandPalette(true, 'workspaces')}
      aria-label="Search workspaces"
      data-sidebar-nav="search"
      className="group flex w-full items-center gap-2 rounded-md bg-worktree-sidebar-foreground/5 px-2 py-1.5 text-left text-[13px] font-medium tracking-tight text-worktree-sidebar-foreground/60 transition-colors hover:bg-worktree-sidebar-foreground/8"
    >
      <Search className="size-4 shrink-0 text-worktree-sidebar-foreground/30" strokeWidth={1.75} />
      <span className="flex-1">Search</span>
      {keys ? (
        <span className="pointer-events-none hidden shrink-0 items-center gap-1 group-focus-within:flex group-hover:flex">
          <ShortcutKeyCombo
            keys={keys}
            className="inline-flex gap-0.5"
            keyCapClassName="min-w-4 border-worktree-sidebar-border/80 bg-worktree-sidebar-foreground/8 px-1 py-px text-[9px] text-worktree-sidebar-foreground/55 shadow-none"
            separatorClassName="text-[9px] text-worktree-sidebar-foreground/45"
          />
        </span>
      ) : null}
    </button>
  )
}

const PROVIDER_SHORTCUTS: { provider: HostingProviderId; label: string; icon: LucideIcon }[] = [
  { provider: 'github', label: 'Open GitHub tasks', icon: Github },
  { provider: 'gitlab', label: 'Open GitLab tasks', icon: Gitlab }
]

/** Opens Tasks on a project hosted by `provider`, keeping the current project when it already is. */
function openProviderTasks(provider: HostingProviderId): void {
  const { projectId, providerByProject } = getTasks()
  const projects = allProjects(getState().hosts).filter((p) => p.kind === 'git')
  const current = projectId && providerByProject[projectId] === provider ? projectId : null
  const match = current ?? projects.find((p) => providerByProject[p.id] === provider)?.id ?? null
  if (match) setTasks({ projectId: match })
  openTasksPage(true)
}

function TasksRow() {
  const shown = useSetting('showTasksButton')
  const open = useTasks((s) => s.open)
  const providerByProject = useTasks((s) => s.providerByProject)
  // The dashboard and board draw over Tasks, so Tasks only reads as active when they are closed.
  const dashboardOpen = useStore((s) => s.dashboardOpen)
  const boardOpen = useSidebarStore((s) => s.boardOpen)
  if (!shown) return null
  const active = open && !dashboardOpen && !boardOpen
  // GitHub is the default source, as in Orca; GitLab shows once a project is known to use it.
  const providers = PROVIDER_SHORTCUTS.filter(
    (p) => p.provider === 'github' || Object.values(providerByProject).includes(p.provider)
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* Shortcuts sit beside the Tasks button, not inside it, so each stays keyboard-reachable. */}
        <div className="group relative">
          <button
            type="button"
            aria-current={active ? 'page' : undefined}
            data-tasks-nav
            data-sidebar-nav="tasks"
            className={cn(ROW, active ? ROW_ACTIVE : 'text-worktree-sidebar-foreground/60 group-hover:bg-worktree-sidebar-foreground/8')}
            onClick={() => openTasksPage(!active)}
          >
            <List className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')} strokeWidth={active ? 2.25 : 1.75} />
            <span className="flex-1">Tasks</span>
          </button>
          <span className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
            {providers.map(({ provider, label, icon: Icon }) => (
              <button
                key={provider}
                type="button"
                aria-label={label}
                data-task-provider={provider}
                onClick={() => openProviderTasks(provider)}
                className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none"
              >
                <Icon className="size-3.5" aria-hidden />
              </button>
            ))}
          </span>
        </div>
      </ContextMenuTrigger>
      <HideSidebarMenu onHide={() => setSetting('showTasksButton', false)} />
    </ContextMenu>
  )
}

/** Orca's DashboardBucketCounts: needs-you, working and done tallies beside the row label. */
function DashboardCounts() {
  const counts = useStore((s) => {
    let attention = 0
    let working = 0
    let done = 0
    for (const session of s.sessions) {
      // An unseen failure is not done (the dashboard lists it under Needs You).
      if (session.status === 'needs-you' || (session.status === 'error' && s.unread[session.id])) attention++
      else if (session.status === 'working') working++
      else if (s.unread[session.id]) done++
    }
    return `${attention}:${working}:${done}`
  })
  const [attention, working, done] = counts.split(':').map(Number)
  const buckets = [
    { id: 'attention', label: 'Needs You', count: attention ?? 0 },
    { id: 'working', label: 'Working', count: working ?? 0 },
    { id: 'done', label: 'Done', count: done ?? 0 }
  ].filter((b) => b.count > 0)
  if (buckets.length === 0) return null
  return (
    <span className="flex items-center gap-1.5">
      {buckets.map((bucket) => (
        <span
          key={bucket.id}
          aria-label={`${bucket.label}: ${bucket.count}`}
          className="inline-flex items-center gap-1 text-[10px] text-worktree-sidebar-foreground/55 tabular-nums"
        >
          {bucket.id === 'attention' ? (
            <AgentQuestionIcon className="size-2.5" />
          ) : (
            <span className={cn('size-1.5 rounded-full', bucket.id === 'working' ? 'bg-yellow-500' : 'bg-emerald-500')} />
          )}
          {bucket.count}
        </span>
      ))}
    </span>
  )
}

export const SidebarNav = memo(function SidebarNav() {
  const showSkills = useSetting('showSkillsButton')
  const showAutomations = useSetting('showAutomationsButton')
  const showDashboard = useSetting('showAgentDashboardButton')
  const showWorkflows = useSetting('showWorkflowsButton')
  const workflowsOpen = useWorkflowsPage() !== null
  const skillsOpen = useAppOverlays((s) => s.skills)
  const automationsOpen = useAutomationState((s) => s.pageOpen)
  const dashboardOpen = useStore((s) => s.dashboardOpen)
  const showNewChat = useSetting('showNewChatButton')
  const quickStartShown = useStore((s) => s.activeWorkspaceId === null && !s.dashboardOpen)
  const boardOpen = useSidebarStore((s) => s.boardOpen)
  const tasksOpen = useTasks((s) => s.open)
  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2 pb-1" data-sidebar-navigation>
      <SearchRow />
      {showNewChat ? (
        <NavRow
          icon={SquarePen}
          label="New chat"
          data="new-chat"
          active={quickStartShown && !boardOpen && !tasksOpen}
          onClick={() => {
            setBoardOpen(false)
            setTasks({ open: false })
            openWorkflows(null)
            showQuickStart()
          }}
          hideSetting="showNewChatButton"
        />
      ) : null}
      <SetupChecklistSidebarEntry />
      <TasksRow />
      {showSkills ? (
        <NavRow
          icon={BookOpen}
          label="Skills"
          data="skills"
          active={skillsOpen}
          onClick={() => setSkillsPageOpen(!skillsOpen)}
          hideSetting="showSkillsButton"
        />
      ) : null}
      {showWorkflows ? (
        <NavRow
          icon={Workflow}
          label="Workflows"
          data="workflows"
          active={workflowsOpen}
          onClick={() => (workflowsOpen ? openWorkflows(null) : openWorkflowsHere())}
          hideSetting="showWorkflowsButton"
        />
      ) : null}
      {showAutomations ? (
        <NavRow
          icon={CalendarClock}
          label="Automations"
          data="automations"
          active={automationsOpen}
          onClick={() => setAutomationsPageOpen(!automationsOpen)}
          hideSetting="showAutomationsButton"
        />
      ) : null}
      {showDashboard ? (
        <NavRow
          icon={LayoutDashboard}
          label="Agent Dashboard"
          data="dashboard"
          active={dashboardOpen}
          onClick={() => {
            if (!dashboardOpen) setBoardOpen(false)
            setDashboardOpen(!dashboardOpen)
          }}
          hideSetting="showAgentDashboardButton"
          trailing={<DashboardCounts />}
        />
      ) : null}
    </div>
  )
})
