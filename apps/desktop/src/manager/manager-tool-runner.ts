import {
  HARNESS_METHODS,
  isChatAgentId,
  type ManagedSessionStatus,
  type ManagerCallParams,
  type ManagerCallResult,
  type TodoLink
} from '@acp-harness/protocol'
import {
  answerPermission,
  createSession,
  ensureSessionLoaded,
  harnessRequest,
  sendPrompt
} from '@/daemon-connection'
import {
  allProjects,
  allWorkspaces,
  floatingWorkspaceId,
  getState,
  workspaceStatus,
  type HostId,
  type Session,
  type ThreadItem
} from '@/session-store'
import { addTodo, getInbox } from '@/stores/inbox-store'
import { linkOf } from '@/stores/project-links-store'
import { leadOf } from '@/lib/project-lead'

// Runs the manager agent's tool calls in this window, which is linked to every host. Status is
// the hosts' (broadcast into the session store); this file only reads it and presents it, and a
// host out of contact reads as `unverifiable`, never as finished or dead.

/** Turns a manager started here, so wait_for_session waits for that turn rather than a stale idle. */
const managerTurns = new Map<string, Promise<void>>()

class ToolError extends Error {}

export async function runManagerTool(params: ManagerCallParams): Promise<ManagerCallResult> {
  try {
    return { result: await dispatch(params) }
  } catch (error) {
    return { result: error instanceof Error ? error.message : String(error), isError: true }
  }
}

function dispatch({ tool, args, callerSessionId }: ManagerCallParams): Promise<unknown> | unknown {
  switch (tool) {
    case 'list_hosts':
      return listHosts()
    case 'list_workspaces':
      return listWorkspaces(optString(args, 'hostId'))
    case 'list_sessions':
      return listSessions(args, callerSessionId)
    case 'read_session':
      return readSession(reqString(args, 'sessionId'), clamp(args.limit, 20, 1, 100))
    case 'send_prompt':
      return promptSession(reqString(args, 'sessionId'), reqString(args, 'text'), callerSessionId)
    case 'create_session':
      return startSession(reqString(args, 'workspaceId'), optString(args, 'agent'), optString(args, 'prompt'))
    case 'create_workspace':
      return startWorkspace(args)
    case 'move_chat':
      return moveChat(args, callerSessionId)
    case 'wait_for_session':
      return waitForSessions(reqStringArray(args, 'sessionIds'), clamp(args.timeoutSeconds, 300, 1, 1800), callerSessionId)
    case 'list_approvals':
      return listApprovals(optString(args, 'sessionId'))
    case 'answer_approval':
      return answerApproval(reqString(args, 'requestId'), reqString(args, 'optionId'))
    case 'forward_to_person':
      return forward(reqString(args, 'text'), optString(args, 'sessionId'), optString(args, 'workspaceId'), callerSessionId)
    case 'list_todos':
      return getInbox().todos.filter((t) => args.includeDone === true || !t.done)
  }
}

// ── Reads ────────────────────────────────────────────────────────────────

function hostConnected(hostId: HostId): boolean {
  return getState().hosts[hostId]?.connection.kind === 'connected'
}

function statusOf(session: Session): ManagedSessionStatus {
  return hostConnected(session.hostId) ? session.status : 'unverifiable'
}

function listHosts(): unknown {
  return Object.values(getState().hosts).map((h) => ({
    hostId: h.id,
    label: h.label,
    connection: h.connection.kind,
    ...(h.connection.kind === 'offline'
      ? { reason: h.connection.reason, daemon: h.connection.daemon ?? 'unverifiable' }
      : {})
  }))
}

function listWorkspaces(hostId?: string): unknown {
  const state = getState()
  const workspaces = allWorkspaces().filter((w) => !hostId || w.hostId === hostId)
  const floating = floatingWorkspaceId()
  const describe = (w: (typeof workspaces)[number]) => {
    const sessions = state.sessions.filter((s) => s.workspaceId === w.id)
    return {
      workspaceId: w.id,
      name: w.displayName ?? w.name,
      path: w.path,
      branch: w.branch,
      isPrimary: w.isPrimary,
      sessions: sessions.length,
      status: hostConnected(w.hostId) ? workspaceStatus(sessions) : 'unverifiable'
    }
  }
  return {
    projects: allProjects()
      .filter((p) => !hostId || p.hostId === hostId)
      .map((p) => ({
        projectId: p.id,
        hostId: p.hostId,
        name: p.displayName ?? p.name,
        kind: p.kind,
        path: p.path,
        // The same project on other hosts (Add Workspace on Another Host); its workspaces are this project's too.
        linkedWith: (linkOf({ hostId: p.hostId, projectId: p.id })?.members ?? [])
          .filter((m) => m.hostId !== p.hostId || m.projectId !== p.id),
        leadSessionId: leadOf(p.hostId, p.id)?.id ?? null,
        workspaces: workspaces.filter((w) => w.projectId === p.id && w.hostId === p.hostId).map(describe)
      })),
    floatingWorkspace: workspaces.filter((w) => w.id === floating).map(describe)[0] ?? null
  }
}

function sessionSummary(s: Session, callerSessionId: string): Record<string, unknown> {
  const state = getState()
  const workspace = allWorkspaces().find((w) => w.id === s.workspaceId)
  const project = allProjects().find((p) => p.id === workspace?.projectId)
  return {
    sessionId: s.id,
    title: s.title,
    agent: s.agent ?? 'claude',
    ...(s.role ? { role: s.role } : {}),
    hostId: s.hostId,
    workspaceId: s.workspaceId,
    workspace: workspace ? (workspace.displayName ?? workspace.name) : null,
    project: project ? (project.displayName ?? project.name) : null,
    status: statusOf(s),
    ...(s.turnStartedAt ? { workingForSeconds: Math.round((Date.now() - s.turnStartedAt) / 1000) } : {}),
    unseenResult: Boolean(state.unread[s.id]),
    pendingApprovals: pendingApprovalsOf(s).length,
    ...(s.id === callerSessionId ? { isYou: true } : {})
  }
}

function listSessions(args: Record<string, unknown>, callerSessionId: string): unknown {
  const hostId = optString(args, 'hostId')
  const workspaceId = optString(args, 'workspaceId')
  const status = optString(args, 'status')
  return getState()
    .sessions.filter((s) => (!hostId || s.hostId === hostId) && (!workspaceId || s.workspaceId === workspaceId))
    .filter((s) => !status || statusOf(s) === status)
    .map((s) => sessionSummary(s, callerSessionId))
}

function requireSession(sessionId: string): Session {
  const session = getState().sessions.find((s) => s.id === sessionId)
  if (!session) throw new ToolError(`Unknown session ${sessionId}; use list_sessions for ids.`)
  return session
}

function requireReachable(session: Session): void {
  if (!hostConnected(session.hostId)) {
    throw new ToolError(`${session.hostId} is out of contact, so this session is unverifiable (it may still be running). Try again later.`)
  }
}

async function readSession(sessionId: string, limit: number): Promise<unknown> {
  const session = requireSession(sessionId)
  requireReachable(session)
  await ensureSessionLoaded(sessionId)
  const current = requireSession(sessionId)
  return {
    ...sessionSummary(current, ''),
    items: current.items.slice(-limit).flatMap(describeItem)
  }
}

function describeItem(item: ThreadItem): unknown[] {
  switch (item.kind) {
    case 'user':
      return [{ user: clip(item.text, 2000) }]
    case 'agent':
      return item.text.trim() ? [{ agent: clip(item.text.trim(), 4000) }] : []
    case 'tool':
      return [{ tool: item.title, status: item.status }]
    case 'permission':
      return [{ approval: item.title, requestId: item.requestId, answered: item.chosen ?? null }]
    case 'notice':
      return [{ notice: item.text }]
    default:
      return []
  }
}

function pendingApprovalsOf(session: Session): Extract<ThreadItem, { kind: 'permission' }>[] {
  return session.items.filter((i): i is Extract<ThreadItem, { kind: 'permission' }> => i.kind === 'permission' && !i.chosen)
}

function listApprovals(sessionId?: string): unknown {
  return getState()
    .sessions.filter((s) => !sessionId || s.id === sessionId)
    .flatMap((s) =>
      pendingApprovalsOf(s).map((p) => ({
        requestId: p.requestId,
        sessionId: s.id,
        session: s.title,
        hostId: s.hostId,
        title: p.title,
        input: p.input === undefined || p.input === null ? null : clip(JSON.stringify(p.input), 800),
        options: p.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind }))
      }))
    )
}

// ── Actions ──────────────────────────────────────────────────────────────

async function promptSession(sessionId: string, text: string, callerSessionId: string): Promise<unknown> {
  if (sessionId === callerSessionId) throw new ToolError('That is your own session; prompt another one.')
  const session = requireSession(sessionId)
  requireReachable(session)
  if (session.status === 'working' || managerTurns.has(sessionId)) {
    throw new ToolError('That session is still working; call wait_for_session first.')
  }
  // Loaded first: a replay after the prompt would drop approvals the turn asks for.
  await ensureSessionLoaded(sessionId)
  const turn = sendPrompt(sessionId, text).finally(() => managerTurns.delete(sessionId))
  managerTurns.set(sessionId, turn)
  return { sent: true, sessionId, next: 'Call wait_for_session to get the result.' }
}

async function startSession(workspaceId: string, agent: string | undefined, prompt: string | undefined): Promise<unknown> {
  const workspace = allWorkspaces().find((w) => w.id === workspaceId)
  if (!workspace) throw new ToolError(`Unknown workspace ${workspaceId}; use list_workspaces for ids.`)
  if (!hostConnected(workspace.hostId)) throw new ToolError(`${workspace.hostId} is out of contact; cannot start a session there now.`)
  return { workspaceId, ...(await startSessionOn(workspace.hostId, workspaceId, agent, prompt)) }
}

async function startWorkspace(args: Record<string, unknown>): Promise<unknown> {
  const projectId = reqString(args, 'projectId')
  const project = allProjects().find((p) => p.id === projectId)
  if (!project) throw new ToolError(`Unknown project ${projectId}; use list_workspaces for ids.`)
  if (project.kind !== 'git') {
    throw new ToolError('This is a folder project, which has no worktrees; use create_session in its primary workspace.')
  }
  const baseRef = optString(args, 'baseRef')
  const workspace = await harnessRequest(
    HARNESS_METHODS.workspaceCreate,
    { projectId, name: reqString(args, 'name'), ...(baseRef ? { baseRef } : {}) },
    project.hostId
  )
  const started = await startSessionOn(project.hostId, workspace.id, optString(args, 'agent'), optString(args, 'prompt'))
  return { workspaceId: workspace.id, path: workspace.path, branch: workspace.branch, ...started }
}

/** Moves the calling chat; a new worktree is made first, on the chat's own host. */
async function moveChat(args: Record<string, unknown>, callerSessionId: string): Promise<unknown> {
  const session = requireSession(callerSessionId)
  requireReachable(session)
  const worktree = args.newWorktree
  let workspaceId = optString(args, 'workspaceId')
  const folder = optString(args, 'folder')
  if ([workspaceId, folder, worktree].filter((v) => v !== undefined).length !== 1) {
    throw new ToolError('Give exactly one of workspaceId, folder or newWorktree.')
  }
  if (worktree !== undefined) {
    if (typeof worktree !== 'object' || worktree === null) throw new ToolError('newWorktree must be { projectId, name }.')
    const fields = { ...worktree }
    const projectId = reqString(fields, 'projectId')
    const project = allProjects().find((p) => p.id === projectId)
    if (!project) throw new ToolError(`Unknown project ${projectId}; use list_workspaces for ids.`)
    if (project.hostId !== session.hostId) throw new ToolError('A chat can only move to a workspace on its own host.')
    if (project.kind !== 'git') throw new ToolError("Folder projects have no worktrees; move to the project's workspace instead.")
    workspaceId = (await harnessRequest(HARNESS_METHODS.workspaceCreate, { projectId, name: reqString(fields, 'name') }, project.hostId)).id
  } else if (workspaceId) {
    const target = allWorkspaces(getState()).find((w) => w.id === workspaceId)
    if (target && target.hostId !== session.hostId) throw new ToolError('A chat can only move to a workspace on its own host.')
  }
  const result = await harnessRequest(
    HARNESS_METHODS.sessionMove,
    { sessionId: session.id, ...(workspaceId ? { workspaceId } : { folder }) },
    session.hostId
  )
  return {
    workspaceId: result.workspaceId,
    moved: result.moved,
    next: result.moved ? 'Moved; your next turn runs there.' : 'The move happens when this turn ends and the chat continues there by itself. End your turn now.'
  }
}

/** For a workspace the store may not have heard about yet. */
async function startSessionOn(hostId: HostId, workspaceId: string, agent?: string, prompt?: string): Promise<Record<string, unknown>> {
  if (agent !== undefined && !isChatAgentId(agent)) throw new ToolError(`Unknown agent ${agent}.`)
  const sessionId = await createSession(workspaceId, agent, { hostId, focus: false })
  if (prompt) await promptSession(sessionId, prompt, '')
  return { sessionId, hostId, prompted: Boolean(prompt) }
}

/** A session settles when it stops working (or, for a turn started here, when that turn ends). */
function settledStatus(sessionId: string): ManagedSessionStatus | 'gone' | null {
  const session = getState().sessions.find((s) => s.id === sessionId)
  if (!session) return 'gone'
  const status = statusOf(session)
  if (status === 'unverifiable' || status === 'needs-you') return status
  if (managerTurns.has(sessionId)) return null
  return status === 'working' ? null : status
}

async function waitForSessions(sessionIds: string[], timeoutSeconds: number, callerSessionId: string): Promise<unknown> {
  if (sessionIds.includes(callerSessionId)) throw new ToolError('You cannot wait on your own session.')
  for (const id of sessionIds) requireSession(id)
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline && !sessionIds.some((id) => settledStatus(id) !== null)) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const report = await Promise.all(
    sessionIds.map(async (id) => {
      const status = settledStatus(id)
      const session = getState().sessions.find((s) => s.id === id)
      if (!session) return { sessionId: id, status: 'gone' }
      if (status !== 'unverifiable') await ensureSessionLoaded(id).catch(() => undefined)
      const current = getState().sessions.find((s) => s.id === id) ?? session
      const lastReply = current.items.findLast((i) => i.kind === 'agent')
      const approvals = pendingApprovalsOf(current)
      return {
        sessionId: id,
        title: current.title,
        status: status ?? 'working',
        ...(lastReply?.kind === 'agent' ? { lastReply: clip(lastReply.text.trim(), 3000) } : {}),
        ...(approvals.length > 0 ? { waitingOn: approvals.map((a) => ({ requestId: a.requestId, title: a.title })) } : {})
      }
    })
  )
  const settled = report.some((r) => r.status !== 'working')
  return { timedOut: !settled, sessions: report, ...(settled ? {} : { next: 'Still working: wait again or read_session.' }) }
}

function answerApproval(requestId: string, optionId: string): unknown {
  for (const session of getState().sessions) {
    const pending = pendingApprovalsOf(session).find((p) => p.requestId === requestId)
    if (!pending) continue
    if (!pending.options.some((o) => o.optionId === optionId)) {
      throw new ToolError(`Not an option of that request: ${pending.options.map((o) => o.optionId).join(', ')}`)
    }
    if (!answerPermission(requestId, optionId)) throw new ToolError('That request is held by another window; answer it there.')
    return { answered: true, sessionId: session.id, optionId }
  }
  throw new ToolError(`No pending approval ${requestId}; use list_approvals.`)
}

async function forward(text: string, sessionId: string | undefined, workspaceId: string | undefined, callerSessionId: string): Promise<unknown> {
  const state = getState()
  const target = sessionId ? state.sessions.find((s) => s.id === sessionId) : undefined
  const workspace = allWorkspaces().find((w) => w.id === (workspaceId ?? target?.workspaceId))
  const hostId = target?.hostId ?? workspace?.hostId
  const link: TodoLink | undefined = hostId
    ? { hostId, ...(workspace ? { workspaceId: workspace.id } : {}), ...(target ? { sessionId: target.id } : {}) }
    : undefined
  const caller = state.sessions.find((s) => s.id === callerSessionId)
  const item = await addTodo(text, link, caller?.title ?? 'Agent')
  return { forwarded: true, todoId: item.id }
}

// ── Argument checks ──────────────────────────────────────────────────────

function optString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function reqString(args: Record<string, unknown>, key: string): string {
  const value = optString(args, key)
  if (!value) throw new ToolError(`${key} is required`)
  return value
}

function reqStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key]
  const list = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : typeof value === 'string' ? [value] : []
  if (list.length === 0) throw new ToolError(`${key} needs at least one id`)
  return list
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max} more chars)` : text
}
