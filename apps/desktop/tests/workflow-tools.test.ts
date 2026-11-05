import { describe, expect, test } from 'bun:test'
import type { Workflow } from '@acp-harness/protocol'
import { copyOfWorkflow, workflowFromSpec } from '../src/manager/workflow-tools.ts'

const spec = {
  name: 'Fix and check',
  description: 'Fix a bug, then run the tests.',
  nodes: [
    { id: 'start', kind: 'start' },
    { id: 'fix', kind: 'agent', label: 'Fix', config: { prompt: 'Fix it.' } },
    { id: 'test', kind: 'check', config: { command: 'bun test' } },
    { id: 'done', kind: 'end', config: { result: 'done' } }
  ],
  edges: [
    { from: 'start', to: 'fix', outcome: 'next' },
    { from: 'fix', to: 'test', outcome: 'next' },
    { from: 'test', to: 'done', outcome: 'pass' },
    { from: 'test', to: 'fix', outcome: 'fail' }
  ]
}

describe('workflowFromSpec', () => {
  test('builds the graph an agent wrote, laid out by distance from Start', () => {
    const workflow = workflowFromSpec(spec, 'p1')
    expect(workflow.projectId).toBe('p1')
    expect(workflow.name).toBe('Fix and check')
    expect(workflow.nodes.map((n) => [n.id, n.label, n.x])).toEqual([
      ['start', 'Start', 0],
      ['fix', 'Fix', 260],
      ['test', 'Check', 520],
      ['done', 'End', 780]
    ])
    expect(workflow.edges).toHaveLength(4)
  })

  test('replacing keeps the id and drops data links to steps that are gone', () => {
    const base = {
      ...workflowFromSpec(spec, 'p1'),
      data: [{ id: 'd', name: 'Data', path: 'docs', x: 0, y: 0 }],
      dataLinks: [
        { id: 'l1', dataId: 'd', nodeId: 'fix' },
        { id: 'l2', dataId: 'd', nodeId: 'gone' }
      ]
    } as Workflow
    const next = workflowFromSpec(spec, 'p1', base)
    expect(next.id).toBe(base.id)
    expect(next.dataLinks?.map((l) => l.id)).toEqual(['l1'])
  })

  test('says what is wrong with a graph that is not one', () => {
    expect(() => workflowFromSpec({ ...spec, name: ' ' }, 'p')).toThrow('name')
    expect(() => workflowFromSpec({ ...spec, nodes: [{ id: 'a', kind: 'robot' }] }, 'p')).toThrow('kind')
    expect(() => workflowFromSpec({ ...spec, edges: [{ from: 'start', to: 'nowhere', outcome: 'next' }] }, 'p')).toThrow('unknown node')
  })
})

describe('copyOfWorkflow', () => {
  test('a new workflow of the target project, named apart from its own', () => {
    const source = workflowFromSpec(spec, 'other')
    const copy = copyOfWorkflow(source, 'mine', ['Fix and check', 'Fix and check (2)'])
    expect(copy.projectId).toBe('mine')
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Fix and check (3)')
    expect(copyOfWorkflow(source, 'mine', [], 'Hotfix').name).toBe('Hotfix')
  })
})
