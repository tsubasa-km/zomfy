import { describe, expect, test } from 'bun:test'
import { cyclesOf, workflowCycles, type Workflow, type WorkflowNodeKind, type WorkflowOutcome } from '@acp-harness/protocol'

// Cycles come from the graph: each edge back to an earlier step frames the steps a round repeats.

function graph(
  steps: [string, WorkflowNodeKind][],
  edges: [string, string, WorkflowOutcome][],
  extra: Partial<Workflow> = {}
): Workflow {
  return {
    id: 'w',
    projectId: 'p',
    name: 'w',
    nodes: steps.map(([id, kind], i) => ({ id, kind, label: id, x: i * 100, y: 0, config: {} })),
    edges: edges.map(([from, to, outcome]) => ({ id: `${from}>${to}`, from, to, outcome })),
    updatedAt: 0,
    ...extra
  }
}

// The Lead-led template: plan → dev → tests → review → check → done, with ask ⇄ check.
const leadLed = graph(
  [
    ['start', 'start'],
    ['plan', 'agent'],
    ['dev', 'agent'],
    ['tests', 'check'],
    ['review', 'review'],
    ['check', 'review'],
    ['ask', 'human'],
    ['done', 'end']
  ],
  [
    ['start', 'plan', 'next'],
    ['plan', 'dev', 'next'],
    ['dev', 'tests', 'next'],
    ['tests', 'review', 'pass'],
    ['tests', 'dev', 'fail'],
    ['review', 'check', 'approve'],
    ['review', 'dev', 'changes'],
    ['check', 'done', 'approve'],
    ['check', 'plan', 'changes'],
    ['check', 'ask', 'ask'],
    ['ask', 'check', 'answered']
  ]
)

describe('workflowCycles', () => {
  test('nests dev ⇄ review inside the Lead cycle; loops back to one step merge', () => {
    const [outer, inner] = workflowCycles(leadLed)
    expect(workflowCycles(leadLed)).toHaveLength(2)
    expect(outer!.id).toBe('plan')
    expect(outer!.nodeIds).toEqual(['plan', 'dev', 'tests', 'review', 'check', 'ask'])
    expect(outer!.label).toBe('plan ⇄ check')
    expect(inner!.id).toBe('dev')
    expect(inner!.parentId).toBe('plan')
    expect(inner!.nodeIds).toEqual(['dev', 'tests', 'review'])
    expect(inner!.backEdgeIds.sort()).toEqual(['review>dev', 'tests>dev'])
    expect(cyclesOf(leadLed, 'tests').map((c) => c.id)).toEqual(['dev', 'plan'])
    expect(cyclesOf(leadLed, 'done')).toEqual([])
  })

  test('asking the person and coming back is not a cycle', () => {
    expect(workflowCycles(leadLed).some((c) => c.id === 'check')).toBe(false)
  })

  test('settings name a cycle and set its limit; others get the default', () => {
    const named = { ...leadLed, cycleSettings: [{ entryId: 'dev', label: 'Develop ⇄ review', maxRounds: 5 }] }
    const [outer, inner] = workflowCycles(named)
    expect(inner!.label).toBe('Develop ⇄ review')
    expect(inner!.maxRounds).toBe(5)
    expect(outer!.maxRounds).toBe(3)
  })

  test('a step that loops to itself is its own cycle', () => {
    const retry = graph(
      [
        ['start', 'start'],
        ['fix', 'custom'],
        ['done', 'end']
      ],
      [
        ['start', 'fix', 'next'],
        ['fix', 'fix', 'fail'],
        ['fix', 'done', 'pass']
      ]
    )
    expect(workflowCycles(retry).map((c) => [c.id, c.nodeIds])).toEqual([['fix', ['fix']]])
  })

  test('no back edges, no cycles', () => {
    const line = graph(
      [
        ['start', 'start'],
        ['a', 'agent'],
        ['done', 'end']
      ],
      [
        ['start', 'a', 'next'],
        ['a', 'done', 'next']
      ]
    )
    expect(workflowCycles(line)).toEqual([])
  })
})
