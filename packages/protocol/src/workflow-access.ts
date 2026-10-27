// Who runs a step and what it may see. Agents are defined once per host and used by steps in any
// workflow; data sources sit on a workflow's canvas, and only the steps linked to one see it. A
// local-only source reaches only agents whose model runs on the person's own machines, and what a
// step learned from it is never handed to an agent that does not (nor to the Lead).

import { chatAgentLabel, type ChatAgentId } from './chat-agents'
import type { Workflow, WorkflowNode, WorkflowToolPolicy } from './workflows'

/** An agent defined once on a host and used by steps in any workflow. */
export interface WorkflowAgentProfile {
  id: string
  name: string
  /** Does work (an Agent step) or approves and sends back (a Review step). */
  kind: 'agent' | 'review'
  /** Which agent runs it; absent means Claude. */
  agent?: ChatAgentId
  /** Its model runs on the person's own machines (a local LLM), so it may see local-only data. */
  local?: boolean
  /**
   * The model it runs, as the agent names it. Zomfy sets it when a session starts and refuses to go
   * on if the agent will not take it; a local agent must name one, or "local" would be only a claim.
   */
  model?: string
  role?: string
  /** Its standing instructions; a step's own come after them. */
  prompt?: string
  tools?: WorkflowToolPolicy
  maxAgents?: number
  updatedAt: number
}

/** A file or folder a workflow's steps may be given. */
export interface WorkflowDataSource {
  id: string
  name: string
  /** Absolute, or relative to the step's workspace. */
  path: string
  /** Only local agents may see it, and what they learn from it stays with local agents and the person. */
  localOnly?: boolean
  note?: string
  /** Canvas position. */
  x: number
  y: number
}

/** A step's use of a data source. */
export interface WorkflowDataLink {
  id: string
  dataId: string
  nodeId: string
  /** May change it, not only read it. */
  write?: boolean
}

export interface WorkflowAccessIssue {
  level: 'error' | 'warning'
  message: string
  nodeId?: string
  edgeId?: string
  dataId?: string
}

/** Steps whose work is an agent session (as opposed to a command, the person, Start or End). */
export function isSessionStep(node: Pick<WorkflowNode, 'kind' | 'config'>): boolean {
  return node.kind === 'agent' || node.kind === 'review' || (node.kind === 'custom' && node.config.runner !== 'command')
}

function isCommandStep(node: Pick<WorkflowNode, 'kind' | 'config'>): boolean {
  return node.kind === 'check' || (node.kind === 'custom' && node.config.runner === 'command')
}

/** The step stays on this host's machines: a command, or a session on an agent marked local. */
export function runsLocally(node: Pick<WorkflowNode, 'kind' | 'config'>): boolean {
  if (isCommandStep(node)) return true
  return isSessionStep(node) && node.config.runBy !== 'lead' && node.config.local === true
}

/** A step that uses an agent gets its settings; the step's own instructions come after the agent's. */
export function resolveStep(node: WorkflowNode, profiles: WorkflowAgentProfile[]): WorkflowNode {
  const profile = node.config.profileId ? profiles.find((p) => p.id === node.config.profileId) : undefined
  if (!profile) return node
  const prompt = [profile.prompt?.trim(), node.config.prompt?.trim()].filter(Boolean).join('\n\n')
  const config = { ...node.config, role: profile.role?.trim() || profile.name }
  delete config.agent
  delete config.local
  delete config.model
  delete config.tools
  if (prompt) config.prompt = prompt
  if (profile.agent && profile.agent !== 'claude') config.agent = profile.agent
  if (profile.local) config.local = true
  if (profile.model?.trim()) config.model = profile.model.trim()
  if (profile.tools) config.tools = profile.tools
  if (config.maxAgents === undefined && profile.maxAgents) config.maxAgents = profile.maxAgents
  return { ...node, config }
}

/** The workflow as a run sees it: every step with its agent's settings filled in. */
export function resolveWorkflowAgents(workflow: Workflow, profiles: WorkflowAgentProfile[]): Workflow {
  if (!workflow.nodes.some((n) => n.config.profileId)) return workflow
  return { ...workflow, nodes: workflow.nodes.map((n) => resolveStep(n, profiles)) }
}

const tainted = new WeakMap<object, Set<string>>()

/**
 * Steps that may hold what was learned from local-only data: the steps linked to it, and the local
 * steps after them (sessions handed their work, and commands, whose output may show it). The
 * person (an Ask step) decides what goes further. Expects agents resolved.
 */
export function localOnlySteps(workflow: Pick<Workflow, 'nodes' | 'edges' | 'data' | 'dataLinks'>): Set<string> {
  const known = tainted.get(workflow)
  if (known) return known
  const local = new Set((workflow.data ?? []).filter((d) => d.localOnly).map((d) => d.id))
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]))
  const holds = new Set((workflow.dataLinks ?? []).filter((l) => local.has(l.dataId) && byId.has(l.nodeId)).map((l) => l.nodeId))
  const queue = [...holds]
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const edge of workflow.edges) {
      const to = edge.from === id ? byId.get(edge.to) : undefined
      if (!to || holds.has(to.id) || !runsLocally(to)) continue
      holds.add(to.id)
      queue.push(to.id)
    }
  }
  tainted.set(workflow, holds)
  return holds
}

function agentName(node: WorkflowNode): string {
  return node.config.runBy === 'lead' ? 'the chat that started the run (Claude)' : chatAgentLabel(node.config.agent ?? 'claude')
}

/** What breaks the data rules; expects agents resolved (profiles that are gone are reported here too). */
export function workflowAccessIssues(workflow: Workflow, profiles: WorkflowAgentProfile[]): WorkflowAccessIssue[] {
  const issues: WorkflowAccessIssue[] = []
  for (const node of workflow.nodes) {
    const profile = node.config.profileId ? profiles.find((p) => p.id === node.config.profileId) : undefined
    if (node.config.profileId && !profile) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${node.label}" uses an agent that no longer exists.` })
    } else if (profile?.local && (profile.agent ?? 'claude') === 'claude') {
      issues.push({ level: 'error', nodeId: node.id, message: `"${profile.name}" is marked local, but Claude runs in the cloud.` })
    } else if (profile?.local && !profile.model?.trim()) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        message: `"${profile.name}" is marked local but names no model, so Zomfy cannot hold it to a local one. Set its model.`
      })
    }
  }
  const resolved = resolveWorkflowAgents(workflow, profiles)
  const byId = new Map(resolved.nodes.map((n) => [n.id, n]))
  const data = new Map((resolved.data ?? []).map((d) => [d.id, d]))
  for (const source of data.values()) {
    if (!source.path.trim()) issues.push({ level: 'error', dataId: source.id, message: `"${source.name}" has no path.` })
    else if (source.localOnly && !isAbsolutePath(source.path)) {
      issues.push({
        level: 'warning',
        dataId: source.id,
        message: `"${source.name}" is inside the project, where agents not linked to it can still open it (Zomfy blocks Claude steps only). Keep local-only data outside the project.`
      })
    }
  }
  for (const link of resolved.dataLinks ?? []) {
    const node = byId.get(link.nodeId)
    const source = data.get(link.dataId)
    if (!node || !source) continue
    if (!isSessionStep(node) && !isCommandStep(node)) {
      issues.push({ level: 'error', nodeId: node.id, dataId: source.id, message: `"${node.label}" cannot use data; link "${source.name}" to an agent or command step.` })
    } else if (source.localOnly && !runsLocally(node)) {
      issues.push({
        level: 'error',
        nodeId: node.id,
        dataId: source.id,
        message: `"${node.label}" runs on ${agentName(node)}, not a local model, so it may not see "${source.name}" (local only). Use an agent marked as local.`
      })
    }
  }
  const holds = localOnlySteps(resolved)
  for (const edge of resolved.edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to || !holds.has(from.id) || !isSessionStep(to) || runsLocally(to)) continue
    if (isCommandStep(from)) {
      // Its output is withheld from the cloud agent, but the files the local steps changed are not.
      issues.push({
        level: 'warning',
        edgeId: edge.id,
        message: `"${to.label}" (${agentName(to)}) comes after local-only work: "${from.label}"'s output is withheld from it, but it can read the files the local steps changed.`
      })
      continue
    }
    issues.push({
      level: 'error',
      edgeId: edge.id,
      message: `"${to.label}" (${agentName(to)}) would be handed what "${from.label}" learned from local-only data. Put an "Ask the person" step between them, or run "${to.label}" on a local agent.`
    })
  }
  return issues
}

export function isAbsolutePath(path: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/]|~)/.test(path.trim())
}

export const WORKFLOW_AGENT_METHODS = {
  workflowAgentsList: '_harness/workflowAgents/list',
  workflowAgentSave: '_harness/workflowAgents/save',
  workflowAgentRemove: '_harness/workflowAgents/remove'
} as const

export interface WorkflowAgentRequests {
  [WORKFLOW_AGENT_METHODS.workflowAgentsList]: { params: Record<string, never>; result: WorkflowAgentProfile[] }
  [WORKFLOW_AGENT_METHODS.workflowAgentSave]: { params: { agent: WorkflowAgentProfile }; result: WorkflowAgentProfile[] }
  [WORKFLOW_AGENT_METHODS.workflowAgentRemove]: { params: { id: string }; result: WorkflowAgentProfile[] }
}
