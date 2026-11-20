import { Fragment, useMemo, type ReactNode } from 'react'
import { ChevronRight, FolderGit2, FolderOpen, MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import type { Workspace } from '@acp-harness/protocol'
import { floatingWorkspaceId, selectWorkspace, useStore, type HostedProject, type HostId, type Session } from '@/session-store'
import { toggleProjectCollapsed, toggleSectionCollapsed, useSidebarStore } from '@/stores/sidebar-store'
import { setInboxOpen } from '@/stores/inbox-store'
import { useProjectCatalog } from '@/stores/project-catalog-store'
import { useSetting } from '@/stores/settings-store'
import { SessionRow } from '@/components/sidebar/SessionRow'
import type { ChatCardInfo } from '@/components/sidebar/ChatCard'
import type { SidebarActions } from '@/components/sidebar/sidebar-actions'
import { ProjectActionsMenuItems } from '@/components/sidebar/ProjectActionsMenu'
import { projectEntries, shortHostNames, type ProjectEntry } from '@/components/sidebar/project-entries'
import { mergeOrder, projectLabel, sortProjects, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { sortedHosts } from '@/components/settings/HostsPane'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { byUrgency, chatSectionLabel, chatSections, chatTree, type ChatNode, type ChatSectionId } from '@/lib/chat-list'
import { startChat } from '@/lib/chat-worktree'
import { defaultHostId } from '@/lib/default-host'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The sidebar as a list of chats, as T3 Code's thread list: every chat of every project, ordered by
// what needs the person. Where a chat works is a line on its row, not a level to open first; a
// folder per project is a grouping the person can turn on.

type HostedWorkspace = Workspace & { hostId: HostId }

const NO_PROJECT = 'none'

/** The sections held at the list's top; the rest sit at its bottom. */
const TOP_SECTIONS: ChatSectionId[] = ['pinned', 'needs-you', 'unread']

/** How many chats the list holds and how many the search keeps, for the search field's counter. */
export function useChatListCounts(): { total: number; matched: number } {
  const sessions = useStore((s) => s.sessions)
  const floating = useStore((s) => floatingWorkspaceId(s))
  const query = useSidebarStore((s) => s.filters.query)
  const hosts = useStore((s) => s.hosts)
  return useMemo(() => {
    const listed = sessions.filter((s) => !s.sideOf && !s.parentId && s.origin !== 'workflow' && s.workspaceId !== floating && !s.archived)
    const needle = query.trim().toLowerCase()
    if (!needle) return { total: listed.length, matched: listed.length }
    const where = new Map<string, string>()
    for (const host of Object.values(hosts)) {
      for (const w of host.harness?.workspaces ?? []) {
        const project = host.harness?.projects.find((p) => p.id === w.projectId)
        where.set(w.id, `${project ? projectLabel(project) : ''} ${w.branch ?? ''} ${workspaceLabel(w)}`.toLowerCase())
      }
    }
    const matched = listed.filter((s) => s.title.toLowerCase().includes(needle) || (where.get(s.workspaceId) ?? '').includes(needle))
    return { total: listed.length, matched: matched.length }
  }, [sessions, floating, query, hosts])
}

function SectionHeader({
  id,
  label,
  count,
  collapsed,
  trailing
}: {
  id: string
  label: string
  count: number
  collapsed: boolean
  trailing?: ReactNode
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      data-chat-section-header={id}
      // As T3 Code's: the name on the left, the count and the fold on the right.
      className="flex h-8 min-w-0 cursor-pointer items-center gap-1.5 pt-2 pr-2 pl-2 select-none"
      onClick={() => toggleSectionCollapsed(id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        toggleSectionCollapsed(id)
      }}
    >
      {id === 'needs-you' && <span className="block size-1.5 shrink-0 rounded-full bg-agent-question" />}
      <div
        className={cn(
          'min-w-0 truncate text-[12px] leading-none font-semibold',
          id === 'needs-you' ? 'text-agent-question-text' : 'text-muted-foreground'
        )}
      >
        {label}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
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
  const groupBy = useStore((s) => s.sidebarView.chatGroupBy ?? 'state')
  const showWorkflow = useStore((s) => s.sidebarView.workflowChats === true)
  const terminals = useStore((s) => s.terminals)
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

  const ordered = sortedHosts(hosts)
  const names = shortHostNames(ordered)
  const workspaces: HostedWorkspace[] = ordered.flatMap((h) => h.harness?.workspaces.map((w) => ({ ...w, hostId: h.id })) ?? [])
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]))
  const projects: HostedProject[] = ordered.flatMap((h) => sortProjects(h.harness?.projects ?? []).map((p) => ({ ...p, hostId: h.id })))
  const projectOf = (w: HostedWorkspace | undefined) => (w ? projects.find((p) => p.hostId === w.hostId && p.id === w.projectId) : undefined)

  const terminalCount = new Map<string, number>()
  for (const terminal of terminals) {
    if (!terminal.inline) terminalCount.set(terminal.workspaceId, (terminalCount.get(terminal.workspaceId) ?? 0) + 1)
  }

  const cardOf = (session: Session): ChatCardInfo => {
    const w = workspaceById.get(session.workspaceId)
    const project = projectOf(w)
    return {
      project: project ? projectLabel(project) : w?.scratch ? t('Quick thread') : w ? workspaceLabel(w) : '',
      quick: !project && Boolean(w?.scratch),
      // Under its project's folder a row need not repeat the project.
      foldered: groupBy === 'project' && project !== undefined && !pinned.includes(session.id) && !session.archived,
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
  const listed = showWorkflow
    ? known
    : known.filter((s) => s.origin !== 'workflow' || (s.parentId !== undefined && parents.has(s.parentId)) || s.status === 'needs-you')
  const needle = query.trim().toLowerCase()
  const matches = (s: Session) => {
    if (!needle) return true
    const card = cardOf(s)
    return [s.title, card.project, card.branch ?? ''].some((text) => text.toLowerCase().includes(needle))
  }
  const nodes = chatTree(listed).filter((n) => [n.chat, ...n.children].some(matches))

  const row = (node: ChatNode) => {
    const { chat, children } = node
    const open = expanded.includes(chat.id)
    const w = workspaceById.get(chat.workspaceId)
    const dragOf = (s: Session) => (w ? { kind: 'workspace' as const, id: w.id, hostId: w.hostId, projectId: w.projectId, sessionId: s.id } : undefined)
    const childStatus = children.reduce<Session['status']>(
      (top, s) => (s.status === 'needs-you' || (s.status === 'error' && top !== 'needs-you') || (s.status === 'working' && top === 'idle') ? s.status : top),
      'idle'
    )
    return (
      <Fragment key={chat.id}>
        <SessionRow
          session={chat}
          showActive
          drag={dragOf(chat)}
          card={cardOf(chat)}
          fold={children.length > 0 ? { count: children.length, expanded: open, status: childStatus } : undefined}
        />
        {open && children.map((child) => <SessionRow key={child.id} session={child} showActive drag={dragOf(child)} card={cardOf(child)} child />)}
      </Fragment>
    )
  }

  const section = (id: ChatSectionId, list: ChatNode[], trailing?: ReactNode) => {
    // What finished since the person last looked heads the list with no header, as in T3 Code.
    if (id === 'unread') {
      return (
        <section key={id} className="mb-1.5 space-y-px pt-1 pr-1" data-chat-section={id}>
          {list.map(row)}
        </section>
      )
    }
    const collapsed = collapsedSections.includes(id) && !needle
    return (
      <section key={id} className="mb-1.5" data-chat-section={id}>
        <SectionHeader id={id} label={chatSectionLabel(id)} count={list.length} collapsed={collapsed} trailing={trailing} />
        {!collapsed && <div className="space-y-px pr-1">{list.map(row)}</div>}
      </section>
    )
  }

  const inbox = (
    <button type="button" className="px-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setInboxOpen(true)}>
      {t('Inbox')}
    </button>
  )

  const sections = chatSections(nodes, pinned, (id) => Boolean(unread[id]))
  const empty = (
    <div className="flex flex-col items-center gap-2 px-4 pt-8 text-center text-xs text-muted-foreground" data-chat-list-empty>
      <MessageSquare className="size-5 opacity-60" />
      {needle ? t('No threads match the search.') : t('No threads yet. Start one with New thread.')}
    </div>
  )

  if (groupBy === 'state') {
    // As T3 Code's: what wants the person sits at the top, what is working and what has settled at
    // the bottom, so each stays where the eye expects it however long the other gets.
    const draw = (s: (typeof sections)[number]) => section(s.id, s.nodes, s.id === 'needs-you' ? inbox : undefined)
    const top = sections.filter((s) => TOP_SECTIONS.includes(s.id))
    const bottom = sections.filter((s) => !TOP_SECTIONS.includes(s.id))
    return (
      <div data-chat-list="state" className="flex flex-1 flex-col">
        {sections.length === 0 ? (
          empty
        ) : (
          <>
            <div data-chat-list-top>{top.map(draw)}</div>
            <div data-chat-list-bottom className="mt-auto pt-3">
              {bottom.map(draw)}
            </div>
          </>
        )}
      </div>
    )
  }

  // By project: pinned chats stay on top and archived ones at the bottom, as in the state view.
  const entryKey = (e: ProjectEntry) => `${e.primary.hostId}:${e.primary.id}`
  const unordered = projectEntries(projects, catalog)
  const rank = new Map(mergeOrder(unordered.map(entryKey), projectOrder).map((key, i) => [key, i]))
  const entries = [...unordered].sort((a, b) => rank.get(entryKey(a))! - rank.get(entryKey(b))!)
  const pinnedSection = sections.find((s) => s.id === 'pinned')
  const archivedSection = sections.find((s) => s.id === 'archived')
  const foldered = nodes.filter((n) => !n.chat.archived && !pinned.includes(n.chat.id))
  const inProject = (members: HostedProject[]) =>
    foldered
      .filter((n) => {
        const w = workspaceById.get(n.chat.workspaceId)
        return members.some((m) => m.hostId === w?.hostId && m.id === w?.projectId)
      })
      .sort(byUrgency)
  const loose = foldered.filter((n) => !projectOf(workspaceById.get(n.chat.workspaceId))).sort(byUrgency)
  // Workspaces some chat works in, shown or not.
  const busy = new Set(allSessions.filter((s) => !s.archived).map((s) => s.workspaceId))

  return (
    <div data-chat-list="project">
      {pinnedSection && section('pinned', pinnedSection.nodes)}
      {loose.length > 0 && (
        <section className="mb-1.5" data-chat-project={NO_PROJECT}>
          <SectionHeader
            id={`project:${NO_PROJECT}`}
            label={t('Quick threads')}
            count={loose.length}
            collapsed={collapsedSections.includes(`project:${NO_PROJECT}`) && !needle}
          />
          {(!collapsedSections.includes(`project:${NO_PROJECT}`) || needle) && <div className="space-y-px pr-1">{loose.map(row)}</div>}
        </section>
      )}
      {entries.map(({ primary: project, copies }) => {
        const members = [project, ...copies]
        const list = inProject(members)
        // A search leaves out the projects it found nothing in.
        if (needle && list.length === 0) return null
        const collapsed = collapsedProjects.includes(project.id) && !needle
        const label = projectLabel(project)
        const hostBadge = [project.hostId !== defaultHost ? names[project.hostId] : null, ...copies.map((c) => `+${names[c.hostId] ?? c.hostId}`)]
          .filter(Boolean)
          .join(' ')
        return (
          <section key={entryKey({ primary: project, copies })} className="group/project mb-1.5" data-chat-project={project.id}>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={!collapsed}
              className="flex h-7 min-w-0 cursor-pointer items-center gap-1 pt-1 pr-1 pl-1 select-none"
              title={project.path}
              data-project-header
              onClick={() => toggleProjectCollapsed(project.id)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                toggleProjectCollapsed(project.id)
              }}
            >
              <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
              {project.kind === 'git' ? (
                <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 truncate pl-0.5 text-[13px] leading-none font-semibold">{label}</div>
              <span className="text-[11px] text-muted-foreground tabular-nums">{list.length}</span>
              {hostBadge && (
                <span className="shrink-0 rounded border border-worktree-sidebar-border px-1 text-[10px] leading-4 text-muted-foreground">
                  {hostBadge}
                </span>
              )}
              <div
                className="ml-auto flex items-center opacity-0 group-hover/project:opacity-100 has-[[data-state=open]]:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
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
              </div>
            </div>
            {!collapsed && (
              <div className="space-y-px pr-1">
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
          </section>
        )
      })}
      {archivedSection && section('archived', archivedSection.nodes)}
      {nodes.length === 0 && projects.length === 0 && empty}
    </div>
  )
}
