import { describe, expect, test } from 'bun:test'
import {
  localOnlySteps,
  resolveWorkflowAgents,
  workflowAccessIssues,
  type Workflow,
  type WorkflowAgentProfile,
  type WorkflowNodeKind,
  type WorkflowOutcome
} from '@acp-harness/protocol'
import { guardedUse, type PathGuard } from './step-path-guard.ts'

// Agents defined once and used by steps; data only the linked steps see; local-only data that stays
// with local agents and the person.

const localDev: WorkflowAgentProfile = { id: 'local', name: 'Local dev', kind: 'agent', agent: 'opencode', local: true, prompt: 'Use the house style.', updatedAt: 0 }
const cloudDev: WorkflowAgentProfile = { id: 'cloud', name: 'Cloud dev', kind: 'agent', agent: 'codex', updatedAt: 0 }

function graph(steps: [string, WorkflowNodeKind, string?][], edges: [string, string, WorkflowOutcome][], extra: Partial<Workflow> = {}): Workflow {
  return {
    id: 'w',
    projectId: 'p',
    name: 'w',
    nodes: steps.map(([id, kind, profileId], i) => ({ id, kind, label: id, x: i * 100, y: 0, config: profileId ? { profileId } : {} })),
    edges: edges.map(([from, to, outcome]) => ({ id: `${from}>${to}`, from, to, outcome })),
    updatedAt: 0,
    ...extra
  }
}

const secrets = { id: 'd', name: 'Customer data', path: 'C:/data/customers', localOnly: true, x: 0, y: 0 }

describe('agents', () => {
  test("a step takes its agent's settings, its own instructions after the agent's", () => {
    const w = graph([['dev', 'agent', 'local']], [])
    w.nodes[0]!.config.prompt = 'Fix the bug.'
    const dev = resolveWorkflowAgents(w, [localDev]).nodes[0]!
    expect(dev.config).toMatchObject({ agent: 'opencode', local: true, role: 'Local dev', prompt: 'Use the house style.\n\nFix the bug.' })
  })

  test('a step whose agent is gone cannot run', () => {
    const issues = workflowAccessIssues(graph([['dev', 'agent', 'gone']], []), [])
    expect(issues.map((i) => i.level)).toEqual(['error'])
  })
})

describe('local-only data', () => {
  const flow = (devProfile: string, reviewProfile?: string) =>
    graph(
      [
        ['start', 'start'],
        ['dev', 'agent', devProfile],
        ['review', 'review', reviewProfile],
        ['done', 'end']
      ],
      [
        ['start', 'dev', 'next'],
        ['dev', 'review', 'next'],
        ['review', 'done', 'approve'],
        ['review', 'dev', 'changes']
      ],
      { data: [secrets], dataLinks: [{ id: 'l', dataId: 'd', nodeId: 'dev' }] }
    )

  test('only a local agent may see it', () => {
    const issues = workflowAccessIssues(flow('cloud', 'local'), [localDev, cloudDev])
    expect(issues.some((i) => i.level === 'error' && i.nodeId === 'dev' && i.dataId === 'd')).toBe(true)
  })

  test('what a local step learned is not handed to a cloud agent', () => {
    const issues = workflowAccessIssues(flow('local'), [localDev])
    expect(issues.filter((i) => i.level === 'error').map((i) => i.edgeId)).toEqual(['dev>review'])
  })

  test('it may pass on to local agents, which then hold it too', () => {
    const w = flow('local', 'local')
    expect(workflowAccessIssues(w, [localDev]).filter((i) => i.level === 'error')).toEqual([])
    expect([...localOnlySteps(resolveWorkflowAgents(w, [localDev]))].sort()).toEqual(['dev', 'review'])
  })

  test('the person in between decides what goes on', () => {
    const w = graph(
      [
        ['start', 'start'],
        ['dev', 'agent', 'local'],
        ['ask', 'human'],
        ['review', 'review'],
        ['done', 'end']
      ],
      [
        ['start', 'dev', 'next'],
        ['dev', 'ask', 'next'],
        ['ask', 'review', 'answered'],
        ['review', 'done', 'approve']
      ],
      { data: [secrets], dataLinks: [{ id: 'l', dataId: 'd', nodeId: 'dev' }] }
    )
    expect(workflowAccessIssues(w, [localDev]).filter((i) => i.level === 'error')).toEqual([])
  })

  test('kept inside the project it only warns, since only Claude steps can be stopped there', () => {
    const w = flow('local', 'local')
    w.data = [{ ...secrets, path: 'data/customers' }]
    expect(workflowAccessIssues(w, [localDev]).map((i) => i.level)).toEqual(['warning'])
  })
})

describe('path guard', () => {
  const cwd = process.platform === 'win32' ? 'C:\\repo' : '/repo'
  const outside = process.platform === 'win32' ? 'C:\\data\\customers' : '/data/customers'
  const none: PathGuard[] = [{ path: outside, name: 'Customer data', allow: 'none' }]

  test('refuses reading or searching what the step is not linked to', () => {
    expect(guardedUse(none, 'Read', { file_path: `${outside}/a.csv` }, cwd)).toContain('Customer data')
    expect(guardedUse(none, 'Grep', { pattern: 'x', path: outside }, cwd)).not.toBeNull()
    expect(guardedUse(none, 'Bash', { command: `cat ${outside.replace(/\\/g, '/')}/a.csv` }, cwd)).not.toBeNull()
    expect(guardedUse(none, 'PowerShell', { command: `Get-Content -LiteralPath "${outside}\\a.csv"` }, cwd)).not.toBeNull()
    expect(guardedUse(none, 'Read', { file_path: 'src/a.ts' }, cwd)).toBeNull()
    expect(guardedUse(none, 'Grep', { pattern: 'x' }, cwd)).toBeNull()
  })

  test('a folder search that holds an in-project source is refused', () => {
    const inside: PathGuard[] = [{ path: 'data/customers', name: 'Customer data', allow: 'none' }]
    expect(guardedUse(inside, 'Grep', { pattern: 'x' }, cwd)).toContain('Search a folder')
    expect(guardedUse(inside, 'Grep', { pattern: 'x', path: 'src' }, cwd)).toBeNull()
    expect(guardedUse(inside, 'Bash', { command: 'type data\\customers\\a.csv' }, cwd)).not.toBeNull()
  })

  test('read-only data can be read but not changed', () => {
    const read: PathGuard[] = [{ path: outside, name: 'Customer data', allow: 'read' }]
    expect(guardedUse(read, 'Read', { file_path: `${outside}/a.csv` }, cwd)).toBeNull()
    expect(guardedUse(read, 'Edit', { file_path: `${outside}/a.csv` }, cwd)).toContain('change')
  })
})
