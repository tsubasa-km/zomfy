import { Fragment, useMemo, type ReactNode } from 'react'
import { ChevronRight, MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import type { Workspace } from '@zomfy/protocol'
import { floatingWorkspaceId, selectWorkspace, useStore, type HostedProject, type HostId, type Session } from '@/session-store'
import { toggleProjectCollapsed, toggleSectionCollapsed, useSidebarStore } from '@/stores/sidebar-store'
import { AgentStateDot } from '@/components/AgentStateDot'
import { useProjectCatalog } from '@/stores/project-catalog-store'
import { useSetting } from '@/stores/settings-store'
import { SessionRow } from '@/components/sidebar/SessionRow'
import { TurnGroupMark } from '@/components/TurnGroupMark'
import { projectColor, projectInitials, type ChatCardInfo } from '@/components/sidebar/ChatCard'
import { useWaitingGlow } from '@/components/native-chat/composer-waiting-glow'
import '@/components/native-chat/composer-waiting-glow.css'
import type { SidebarActions } from '@/components/sidebar/sidebar-actions'
import { ProjectActionsMenuItems } from '@/components/sidebar/ProjectActionsMenu'
import { projectEntries, shortHostNames, type ProjectEntry } from '@/components/sidebar/project-entries'
import { mergeOrder, projectLabel, sortProjects, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { sortedHosts } from '@/components/settings/HostsPane'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { foldedTurnPhase } from '@zomfy/protocol'
import { chatSectionLabel, chatSections, chatTree, mostPressing, projectGroups, searchTree, waitsForAnswer, useCoarseNow, type ChatNode, type ChatSectionId } from '@/lib/chat-list'
import { phaseOf, turnPhaseDot, turnPhaseLabel, useQuietAfterHours } from '@/lib/turn-phase'
import { startChat } from '@/lib/chat-worktree'
import { defaultHostId } from '@/lib/default-host'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The sidebar as a stack of project cards, each with its chats inside, pinned first, then most
// recent; nothing is grouped or ordered by whose turn it is. Each row keeps its turn mark, and a
// chat waiting for the person's answer glows, as does a folded card holding one
// (docs/specs/threads-under-projects.md). Archived chats sit on their shelf below.

type HostedWorkspace = Workspace & { hostId: HostId }

const NO_PROJECT = 'none'

/** How many chats the list holds and how many the search keeps, for the search field's counter. */
export function useChatListCounts(): { total: number; matched: number } {
  const query = useSidebarStore((s) => s.filters.query)
  // Counted in the selector and handed out as a string, so a chat streaming does not redraw the sidebar.
  const counts = useStore((s) => {
    const floating = floatingWorkspaceId(s)
    const bots = s.sidebarView.botChats === true
    const listed = s.sessions.filter(
      (x) => !x.sideOf && !x.parentId && x.origin !== 'workflow' && (bots || x.origin !== 'bot') && x.workspaceId !== floating && !x.archived
    )
    const needle = query.trim().toLowerCase()
    if (!needle) return `${listed.length} ${listed.length}`
    const where = new Map<string, string>()
    for (const host of Object.values(s.hosts)) {
      for (const w of host.harness?.workspaces ?? []) {
        const project = host.harness?.projects.find((p) => p.id === w.projectId)
        where.set(w.id, `${project ? projectLabel(project) : ''} ${w.branch ?? ''} ${workspaceLabel(w)}`.toLowerCase())
      }
    }
    const hit = (x: Session) => x.title.toLowerCase().includes(needle) || (where.get(x.workspaceId) ?? '').includes(needle)
    // A chat counts as found when a chat under it is: the search shows it, with that one beneath.
    const childHit = new Set(s.sessions.filter((x) => x.parentId && !x.archived && hit(x)).map((x) => x.parentId))
    const matched = listed.filter((x) => hit(x) || childHit.has(x.id))
    return `${listed.length} ${matched.length}`
  })
  return useMemo(() => {
    const [total, matched] = counts.split(' ').map(Number)
    return { total: total!, matched: matched! }
  }, [counts])
}

function SectionHeader({
  id,
  label,
  mark,
  count,
  collapsed,
  trailing
}: {
  id: string
  label: string
  /** A state group: its mark and a hairline instead of its name. */
  mark?: ChatSectionId
  count: number
  collapsed: boolean
  trailing?: ReactNode
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      aria-label={mark ? label : undefined}
      title={mark ? label : undefined}
      data-chat-section-header={id}
      // As T3 Code's: the name (or the group's mark) on the left, the count and the fold on the right.
      className="group/section flex h-8 min-w-0 cursor-pointer items-center gap-1.5 pt-2 pr-2 pl-2 select-none"
      onClick={() => toggleSectionCollapsed(id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        toggleSectionCollapsed(id)
      }}
    >
      {mark ? (
        <>
          <TurnGroupMark id={mark} />
          <div
            className={cn(
              'h-px min-w-4 flex-1',
              mark === 'needs-answer' ? 'bg-agent-question/35' : mark === 'your-turn' ? 'bg-emerald-500/30' : 'bg-border'
            )}
          />
        </>
      ) : (
        <div className="min-w-0 truncate text-[12px] leading-none font-semibold text-muted-foreground">{label}</div>
      )}
      <div className={cn('flex shrink-0 items-center gap-1', !mark && 'ml-auto')}>
        {trailing && (
          <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
            {trailing}
          </div>
        )}
        <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
      </div>
    </div>
  )
}

export function ChatList({ actions }: { actions: SidebarActions }) {
  const hosts = useStore((s) => s.hosts)
  const allSessions = useStore((s) => s.sessions)
  const unread = useStore((s) => s.unread)
  const floating = useStore((s) => floatingWorkspaceId(s))
  const showWorkflow = useStore((s) => s.sidebarView.workflowChats === true)
  const showBots = useStore((s) => s.sidebarView.botChats === true)
  // Only how many tab terminals each workspace has: a string, so a terminal's new title redraws nothing here.
  const terminalWorkspaces = useStore((s) => s.terminals.flatMap((t) => (t.inline ? [] : [t.workspaceId])).join(' '))
  const query = useSidebarStore((s) => s.filters.query)
  const pinned = useSidebarStore((s) => s.pinnedChats)
  const collapsedSections = useSidebarStore((s) => s.collapsedSections)
  const collapsedProjects = useSidebarStore((s) => s.collapsedProjects)
  const expanded = useSidebarStore((s) => s.expandedChats)
  const summaries = useSidebarStore((s) => s.summaries)
  const projectOrder = useSidebarStore((s) => s.projectOrder)
  const catalog = useProjectCatalog()
  useSetting('defaultHost')
  const defaultHost = defaultHostId()
  // A seen thread goes Quiet with time, not only with a change: the list looks again twice a minute.
  const now = useCoarseNow()
  const quietAfter = useQuietAfterHours()
  const phase = (s: Session) => phaseOf(s, now, quietAfter)

  const ordered = sortedHosts(hosts)
  const names = shortHostNames(ordered)
  const workspaces: HostedWorkspace[] = ordered.flatMap((h) => h.harness?.workspaces.map((w) => ({ ...w, hostId: h.id })) ?? [])
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]))
  const projects: HostedProject[] = ordered.flatMap((h) => sortProjects(h.harness?.projects ?? []).map((p) => ({ ...p, hostId: h.id })))
  const projectOf = (w: HostedWorkspace | undefined) => (w ? projects.find((p) => p.hostId === w.hostId && p.id === w.projectId) : undefined)

  const terminalCount = new Map<string, number>()
  for (const workspaceId of terminalWorkspaces ? terminalWorkspaces.split(' ') : []) {
    terminalCount.set(workspaceId, (terminalCount.get(workspaceId) ?? 0) + 1)
  }

  const cardOf = (session: Session): ChatCardInfo => {
    const w = workspaceById.get(session.workspaceId)
    const project = projectOf(w)
    return {
      project: project ? projectLabel(project) : w?.scratch ? t('Quick thread') : w ? workspaceLabel(w) : '',
      quick: !project && Boolean(w?.scratch),
      // Inside its project's card a row need not repeat the project.
      foldered: !session.archived,
      workspaceId: session.workspaceId,
      branch: w?.branch,
      worktree: Boolean(w && project && !w.isPrimary),
      path: w?.path,
      terminals: terminalCount.get(session.workspaceId) ?? 0,
      host: session.hostId !== defaultHost ? (names[session.hostId] ?? session.hostId) : undefined,
      pinned: pinned.includes(session.id),
      unread: Boolean(unread[session.id]),
      summary: summaries[session.workspaceId]
    }
  }

  // The floating panel's chats are that panel's, and a chat whose workspace this window has not heard of has no row to draw.
  const known = allSessions.filter((s) => s.workspaceId !== floating && workspaceById.has(s.workspaceId))
  // A workflow run's step chats stay folded under the chat the run was started from. One with no
  // such chat to sit under is left out (the Workflows page has it), unless it waits for the person.
  const parents = new Set(known.map((s) => s.id))
  const shown = showWorkflow
    ? known
    : known.filter((s) => s.origin !== 'workflow' || (s.parentId !== undefined && parents.has(s.parentId)) || s.status === 'needs-you')
  // Bots' chats live on the Bots page; one waiting for the person still shows here.
  const listed = showBots ? shown : shown.filter((s) => s.origin !== 'bot' || s.status === 'needs-you')
  const needle = query.trim().toLowerCase()
  const matches = (s: Session) => {
    if (!needle) return true
    const card = cardOf(s)
    return [s.title, card.project, card.branch ?? ''].some((text) => text.toLowerCase().includes(needle))
  }
  // A search lists the chats it found at the top; one it found under another shows beneath that one, quieter.
  const tree = chatTree(listed, phase)
  const nodes: (ChatNode & { hits?: Session[] })[] = needle ? searchTree(tree, matches) : tree

  const row = (node: ChatNode & { hits?: Session[] }) => {
    const { chat, children } = node
    const open = expanded.includes(chat.id)
    const under = open ? children : (node.hits ?? [])
    const w = workspaceById.get(chat.workspaceId)
    const dragOf = (s: Session) => (w ? { kind: 'workspace' as const, id: w.id, hostId: w.hostId, projectId: w.projectId, sessionId: s.id } : undefined)
    // What the chats under it are doing that lifts the row: a child's own Your turn or Quiet does not.
    const childPhase = foldedTurnPhase('quiet', children.map(phase))
    return (
      <Fragment key={chat.id}>
        <SessionRow
          session={chat}
          showActive
          drag={dragOf(chat)}
          card={cardOf(chat)}
          phase={node.phase}
          glow={waitsForAnswer(node)}
          fold={children.length > 0 ? { count: children.length, expanded: open, phase: childPhase } : undefined}
        />
        {under.map((child) => (
          <SessionRow
            key={child.id}
            session={child}
            showActive
            drag={dragOf(child)}
            card={cardOf(child)}
            phase={phase(child)}
            glow={child.status === 'needs-you'}
            child
            muted={Boolean(needle)}
          />
        ))}
      </Fragment>
    )
  }

  const section = (id: ChatSectionId, list: ChatNode[], trailing?: ReactNode) => {
    const collapsed = collapsedSections.includes(id) && !needle
    return (
      <section key={id} className="mb-1.5" data-chat-section={id}>
        <SectionHeader id={id} label={chatSectionLabel(id)} mark={id} count={list.length} collapsed={collapsed} trailing={trailing} />
        {!collapsed && <div className="space-y-px pr-1">{list.map(row)}</div>}
      </section>
    )
  }

  const sections = chatSections(nodes, pinned)
  const empty = (
    <div className="flex flex-col items-center gap-2 px-4 pt-8 text-center text-xs text-muted-foreground" data-chat-list-empty>
      <MessageSquare className="size-5 opacity-60" />
      {needle ? t('No threads match the search.') : t('No threads yet. Start one with New thread.')}
    </div>
  )

  // A card per project, pinned chats first in each; archived ones on their shelf at the bottom.
  const entryKey = (e: ProjectEntry) => `${e.primary.hostId}:${e.primary.id}`
  const unordered = projectEntries(projects, catalog)
  const rank = new Map(mergeOrder(unordered.map(entryKey), projectOrder).map((key, i) => [key, i]))
  const entries = [...unordered].sort((a, b) => rank.get(entryKey(a))! - rank.get(entryKey(b))!)
  const archivedSection = sections.find((s) => s.id === 'archived')
  // A chat's project entry: copies of one project on other hosts share their primary's group.
  const entryOfProject = new Map(entries.flatMap((e) => [e.primary, ...e.copies].map((m) => [`${m.hostId}:${m.id}`, entryKey(e)] as const)))
  const grouped = projectGroups(
    nodes,
    pinned,
    (chat) => {
      const w = workspaceById.get(chat.workspaceId)
      return w?.projectId ? (entryOfProject.get(`${w.hostId}:${w.projectId}`) ?? null) : null
    },
    entries.map(entryKey)
  )
  const inProject = new Map(grouped.projects.map((g) => [g.key, g.nodes]))
  const loose = grouped.loose
  const looseCollapsed = collapsedProjects.includes(NO_PROJECT) && !needle
  // Workspaces some chat works in, shown or not.
  const busy = new Set(allSessions.filter((s) => !s.archived).map((s) => s.workspaceId))

  return (
    <div data-chat-list="project">
      {entries.map(({ primary: project, copies }) => {
        const members = [project, ...copies]
        const list = inProject.get(entryKey({ primary: project, copies })) ?? []
        // A search leaves out the projects it found nothing in.
        if (needle && list.length === 0) return null
        const collapsed = collapsedProjects.includes(project.id) && !needle
        const label = projectLabel(project)
        const hostBadge = [project.hostId !== defaultHost ? names[project.hostId] : null, ...copies.map((c) => `+${names[c.hostId] ?? c.hostId}`)]
          .filter(Boolean)
          .join(' ')
        return (
          <ProjectCard
            key={entryKey({ primary: project, copies })}
            id={project.id}
            label={label}
            title={project.path}
            badge={<ProjectBadge name={label} />}
            nodes={list}
            collapsed={collapsed}
            extra={
              hostBadge && (
                <span className="shrink-0 rounded border border-worktree-sidebar-border px-1 text-[10px] leading-4 text-muted-foreground">
                  {hostBadge}
                </span>
              )
            }
            actions={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t('New thread in {project}', { project: label })}
                      data-project-new-chat
                      onClick={() => void startChat(project)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{project.kind === 'git' ? t('New thread in its own worktree') : t('New thread')}</TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-xs" variant="ghost" aria-label={t('Project actions for {project}', { project: label })}>
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    <ProjectActionsMenuItems project={project} actions={actions} copies={copies} badgeFor={(hostId) => names[hostId] ?? hostId} />
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
          >
            {!collapsed && (
              <div className="space-y-px">
                {list.map(row)}
                {/* A worktree no chat works in still needs a way in, and a way to be seen and cleaned up. */}
                {!needle &&
                  workspaces
                    .filter((w) => members.some((m) => m.hostId === w.hostId && m.id === w.projectId) && !w.isPrimary && !busy.has(w.id))
                    .map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        data-empty-workspace={w.id}
                        onClick={() => selectWorkspace(w.id)}
                        className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 pr-1.5 pl-5 text-left text-[12px] text-muted-foreground/70 hover:bg-worktree-sidebar-accent/60 hover:text-foreground"
                      >
                        <span className="min-w-0 flex-1 truncate italic">{t('No threads yet')}</span>
                        <span className="max-w-32 shrink-0 truncate font-mono text-[10px]">{w.branch ?? workspaceLabel(w)}</span>
                      </button>
                    ))}
                {list.length === 0 && !workspaces.some((w) => members.some((m) => m.hostId === w.hostId && m.id === w.projectId) && !w.isPrimary && !busy.has(w.id)) && (
                  <p className="py-0.5 pl-5 text-[12px] text-muted-foreground/70 italic">{t('No threads yet')}</p>
                )}
              </div>
            )}
          </ProjectCard>
        )
      })}
      {loose.length > 0 && (
        <ProjectCard
          id={NO_PROJECT}
          label={t('No project')}
          badge={<span aria-hidden className="block h-4 w-[18px] shrink-0 rounded-[4px] border border-dashed border-muted-foreground/60" />}
          nodes={loose}
          collapsed={looseCollapsed}
        >
          {!looseCollapsed && <div className="space-y-px">{loose.map(row)}</div>}
        </ProjectCard>
      )}
      {archivedSection && section('archived', archivedSection.nodes)}
      {nodes.length === 0 && projects.length === 0 && empty}
    </div>
  )
}

/** The project's colour, with its initials, as the rows of that project used to carry it. */
function ProjectBadge({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex h-4 w-[18px] shrink-0 items-center justify-center rounded-[4px] text-[8.5px] leading-none font-bold tracking-tight', projectColor(name))}
    >
      {projectInitials(name)}
    </span>
  )
}

/**
 * Where a card's badge sits: a folded card shows there the mark of its most pressing chat
 * (docs/specs/threads-under-projects.md), the badge otherwise.
 */
function ProjectMark({ nodes, children }: { nodes: ChatNode[]; children: ReactNode }) {
  const top = mostPressing(nodes)
  const dot = top ? turnPhaseDot(top.phase, top.status) : null
  if (!top || !dot) return <>{children}</>
  return (
    <span className="flex h-4 w-[18px] shrink-0 items-center justify-center" data-project-phase={top.phase}>
      <AgentStateDot state={dot} size="md" title={turnPhaseLabel(top.phase, top.status)} />
    </span>
  )
}

/** The card's surface, which a glowing border (its own or a row's) is drawn around. */
const CARD_GLOW_SURFACE = { '--composer-glow-surface': 'var(--card)', '--chat-composer-border': 'var(--border)' } as React.CSSProperties

/**
 * A project's card (docs/specs/threads-under-projects.md): a contained region with the project's
 * badge and name on top and its chats inside. Folded, it glows when one of its chats waits for the
 * person's answer.
 */
function ProjectCard({
  id,
  label,
  title,
  badge,
  nodes,
  collapsed,
  extra,
  actions,
  children
}: {
  id: string
  label: string
  title?: string
  badge: ReactNode
  nodes: ChatNode[]
  collapsed: boolean
  extra?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const glowing = useWaitingGlow(collapsed && nodes.some(waitsForAnswer))
  return (
    <section
      className="group/project mb-1.5 rounded-lg border border-border bg-card px-1 pb-1 shadow-xs"
      data-chat-project={id}
      data-waiting-glow={glowing}
      style={CARD_GLOW_SURFACE}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        className="flex h-8 min-w-0 cursor-pointer items-center gap-1.5 pl-1 select-none"
        title={title}
        data-project-header
        onClick={() => toggleProjectCollapsed(id)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          toggleProjectCollapsed(id)
        }}
      >
        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
        <ProjectMark nodes={collapsed ? nodes : []}>{badge}</ProjectMark>
        <div className="min-w-0 truncate text-[13px] leading-none font-semibold">{label}</div>
        <span className="text-[11px] text-muted-foreground tabular-nums">{nodes.length}</span>
        {extra}
        {actions && (
          <div
            className="ml-auto flex items-center opacity-0 group-hover/project:opacity-100 has-[[data-state=open]]:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}
