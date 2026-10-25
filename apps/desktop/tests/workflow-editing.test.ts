import { describe, expect, test } from 'bun:test'
import type { Workflow } from '@acp-harness/protocol'
import { EditHistory } from '../src/components/workflows/workflow-edit-history.ts'
import { pasteSnippet, snippetOf } from '../src/components/workflows/workflow-clipboard.ts'
import { newAgentStep, reviewLoopTemplate, validateWorkflow, withoutData, withoutSteps } from '../src/components/workflows/workflow-model.ts'

const named = (w: Workflow, name: string): Workflow => ({ ...w, name })

describe('EditHistory', () => {
  test('a quick burst undoes as one step; redo brings it back', () => {
    const h = new EditHistory()
    const a = named(reviewLoopTemplate('p'), 'a')
    const b = named(a, 'b')
    const c = named(a, 'c')
    h.record(a, 1000)
    h.record(b, 1100) // same burst as the change from a
    expect(h.undo(c)?.name).toBe('a')
    expect(h.redo(a)?.name).toBe('c')
    expect(h.redo(c)).toBeNull()
  })

  test('changes apart are separate steps, and a new change drops what could be redone', () => {
    const h = new EditHistory()
    const a = named(reviewLoopTemplate('p'), 'a')
    h.record(a, 1000)
    h.record(named(a, 'b'), 3000)
    expect(h.undo(named(a, 'c'))?.name).toBe('b')
    h.record(named(a, 'b'), 9000)
    expect(h.redo(named(a, 'x'))).toBeNull()
    expect(h.undo(named(a, 'x'))?.name).toBe('b')
    expect(h.undo(named(a, 'b'))?.name).toBe('a')
  })
})

describe('copying steps', () => {
  test('copies the steps and the edges between them, never Start', () => {
    const w = reviewLoopTemplate('p')
    const ids = w.nodes.filter((n) => ['Lead hands off a task', 'Developer', 'Run tests'].includes(n.label)).map((n) => n.id)
    const snippet = snippetOf(w, ids)!
    expect(snippet.nodes.map((n) => n.label)).toEqual(['Developer', 'Run tests'])
    expect(snippet.edges.map((e) => e.outcome).sort()).toEqual(['fail', 'next'])
  })

  test('pastes as new steps, moved, with their edges rewired', () => {
    const w = reviewLoopTemplate('p')
    const dev = w.nodes.find((n) => n.label === 'Developer')!
    const tests = w.nodes.find((n) => n.label === 'Run tests')!
    const { workflow, ids } = pasteSnippet(w, snippetOf(w, [dev.id, tests.id])!, 40)
    expect(workflow.nodes).toHaveLength(w.nodes.length + 2)
    expect(ids.some((id) => w.nodes.some((n) => n.id === id))).toBe(false)
    const copy = workflow.nodes.find((n) => n.id === ids[0])!
    expect([copy.x - dev.x, copy.y - dev.y]).toEqual([40, 40])
    const added = workflow.edges.slice(w.edges.length)
    expect(added.every((e) => ids.includes(e.from) && ids.includes(e.to))).toBe(true)
  })
})

describe('agents and data in the editor', () => {
  test('a step from a defined agent is named after it and uses it', () => {
    const step = newAgentStep({ id: 'a1', name: 'Local developer', kind: 'agent', local: true, updatedAt: 0 }, 0, 0)
    expect(step.kind).toBe('agent')
    expect(step.label).toBe('Local developer')
    expect(step.config.profileId).toBe('a1')
    expect(step.config.role).toBeUndefined()
  })

  test('deleting a step or a data source takes its data links along', () => {
    const w = reviewLoopTemplate('p')
    const dev = w.nodes.find((n) => n.label === 'Developer')!
    const review = w.nodes.find((n) => n.label === 'Reviewer')!
    const withData: Workflow = {
      ...w,
      data: [{ id: 'd', name: 'Specs', path: 'docs', x: 0, y: 0 }],
      dataLinks: [
        { id: 'l1', dataId: 'd', nodeId: dev.id },
        { id: 'l2', dataId: 'd', nodeId: review.id }
      ]
    }
    expect(withoutSteps(withData, new Set([dev.id])).dataLinks?.map((l) => l.id)).toEqual(['l2'])
    const noData = withoutData(withData, new Set(['d']))
    expect([noData.data, noData.dataLinks]).toEqual([[], []])
  })
})

describe('arrows that continue the chat', () => {
  const withContinue = (w: Workflow, from: string, to: string): Workflow => ({
    ...w,
    edges: w.edges.map((e) => {
      const a = w.nodes.find((n) => n.id === e.from)?.label
      const b = w.nodes.find((n) => n.id === e.to)?.label
      return a === from && b === to ? { ...e, session: 'continue' as const } : e
    })
  })

  test('join two agent steps on the same agent', () => {
    const w = withContinue(reviewLoopTemplate('p'), 'Reviewer', 'Developer')
    expect(validateWorkflow(w).filter((i) => i.message.includes('continues the chat'))).toEqual([])
  })

  test('not into a check step, nor between different agents', () => {
    const toCheck = withContinue(reviewLoopTemplate('p'), 'Developer', 'Run tests')
    expect(validateWorkflow(toCheck).some((i) => i.message.includes('continues the chat'))).toBe(true)
    const mixed = withContinue(reviewLoopTemplate('p'), 'Reviewer', 'Developer')
    mixed.nodes = mixed.nodes.map((n) => (n.label === 'Reviewer' ? { ...n, config: { ...n.config, agent: 'codex' as const } } : n))
    expect(validateWorkflow(mixed).some((i) => i.message.includes('same agent'))).toBe(true)
  })
})
