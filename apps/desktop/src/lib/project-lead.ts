import { HARNESS_METHODS } from '@acp-harness/protocol'
import { closeSession, createSession, ensureSessionLoaded, harnessRequest } from '@/daemon-connection'
import {
  allProjects,
  allWorkspaces,
  getState,
  onSessionTransition,
  type HostedProject,
  type HostId,
  type Session
} from '@/session-store'
import { getProjectLinks } from '@/stores/project-links-store'
import { WINDOW_ROLE } from '@/lib/window-role'

// Each project's Lead chat (role 'lead'): one Claude session in the project's main workspace that
// the person talks to and that runs the project's other sessions. It hears what the person told
// those sessions directly, and how they ended, as context at the start of its next turn.

type MemberKey = `${HostId}:${string}`
const keyOf = (hostId: HostId, projectId: string): MemberKey => `${hostId}:${projectId}`

/** The host projects that form `project`'s project, main member first: its link's members, else itself. */
function membersOf(hostId: HostId, projectId: string): MemberKey[] {
  const link = getProjectLinks().find((l) => l.members.some((m) => m.hostId === hostId && m.projectId === projectId))
  return link ? link.members.map((m) => keyOf(m.hostId, m.projectId)) : [keyOf(hostId, projectId)]
}

/** The project's Lead session; a member linked in later may bring its own, so the main member's wins. */
export function leadOf(hostId: HostId, projectId: string): Session | null {
  const { sessions } = getState()
  const workspaces = allWorkspaces()
  for (const member of membersOf(hostId, projectId)) {
    const ids = new Set(workspaces.filter((w) => w.projectId && keyOf(w.hostId, w.projectId) === member).map((w) => w.id))
    const lead = sessions.find((s) => s.role === 'lead' && ids.has(s.workspaceId))
    if (lead) return lead
  }
  return null
}

/** The host project a session's workspace belongs to. */
export function projectOfSession(session: Session): HostedProject | null {
  const workspace = allWorkspaces().find((w) => w.id === session.workspaceId && w.hostId === session.hostId)
  return allProjects().find((p) => p.id === workspace?.projectId && p.hostId === session.hostId) ?? null
}

/** Projects this window already tried to give a Lead; never retried, so a failure cannot repeat. */
const attempted = new Set<MemberKey>()

/**
 * Gives every project whose main host is connected its Lead, in the main member's own checkout.
 * Only once that host has listed its sessions (it reads as connected then), so none is made twice.
 */
export function ensureProjectLeads(): void {
  if (WINDOW_ROLE !== 'main') return
  const { hosts } = getState()
  const links = getProjectLinks()
  const linkedNonMain = new Set(links.flatMap((l) => l.members.slice(1).map((m) => keyOf(m.hostId, m.projectId))))
  for (const project of allProjects()) {
    const key = keyOf(project.hostId, project.id)
    if (linkedNonMain.has(key) || attempted.has(key)) continue
    if (hosts[project.hostId]?.connection.kind !== 'connected' || leadOf(project.hostId, project.id)) continue
    const primary = allWorkspaces().find((w) => w.hostId === project.hostId && w.projectId === project.id && w.isPrimary)
    if (!primary) continue
    attempted.add(key)
    void createSession(primary.id, 'claude', { hostId: project.hostId, role: 'lead', focus: false })
      .then((sessionId) => {
        // A daemon older than Lead chats makes a plain chat instead; take it back.
        const made = getState().sessions.find((s) => s.id === sessionId)
        if (made && made.role !== 'lead') void closeSession(sessionId)
      })
      .catch(() => undefined)
  }
}

function tellLead(about: Session, text: string): void {
  const project = projectOfSession(about)
  if (!project || about.role === 'lead') return
  const lead = leadOf(project.hostId, project.id)
  if (!lead) return
  const where = allWorkspaces().find((w) => w.id === about.workspaceId)
  const label = `"${about.title}" (session ${about.id}, ${where ? (where.displayName ?? where.name) : 'workspace'})`
  void harnessRequest(HARNESS_METHODS.sessionAddContext, { sessionId: lead.id, text: text.replace('{session}', label) }, lead.hostId).catch(
    () => undefined
  )
}

/** The person typed into another session of a project: its Lead should know. */
export function relayPromptToLead(sessionId: string, text: string): void {
  const session = getState().sessions.find((s) => s.id === sessionId)
  if (session && text.trim()) tellLead(session, `The person told {session}: ${text.trim()}`)
}

/** Main window: a project's sessions finishing, failing or asking reach its Lead as context. */
export function installLeadActivity(): () => void {
  if (WINDOW_ROLE !== 'main') return () => {}
  return onSessionTransition(({ session, from, to }) => {
    if (to === 'needs-you') tellLead(session, '{session} is waiting for the person (an approval or a question).')
    else if (from === 'working' && to === 'idle') {
      // The reply's start when this window has the transcript; read_session gives the rest.
      const reply = [...session.items].reverse().find((i) => i.kind === 'agent')
      const excerpt = reply?.kind === 'agent' ? reply.text.replace(/\s+/g, ' ').trim().slice(0, 400) : ''
      tellLead(session, `{session} finished its turn${excerpt ? `, replying: ${excerpt}` : '.'}`)
    }
    else if (from === 'working' && to === 'error') tellLead(session, '{session} ended with an error.')
  })
}

/** A project linked into another gives up its own Lead when that Lead never had a conversation. */
export async function retireLeadsOf(hostId: HostId, projectId: string): Promise<void> {
  const workspaces = new Set(
    allWorkspaces()
      .filter((w) => w.hostId === hostId && w.projectId === projectId)
      .map((w) => w.id)
  )
  for (const lead of getState().sessions.filter((s) => s.role === 'lead' && workspaces.has(s.workspaceId))) {
    await ensureSessionLoaded(lead.id).catch(() => undefined)
    const loaded = getState().sessions.find((s) => s.id === lead.id)
    if (loaded?.loaded && loaded.items.length === 0 && loaded.status === 'idle') closeSession(lead.id)
  }
}
