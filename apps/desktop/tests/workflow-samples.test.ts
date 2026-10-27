import { describe, expect, test } from 'bun:test'
import { unboundedLoops, workflowCycles } from '@acp-harness/protocol'
import { WORKFLOW_TEMPLATES } from '../src/components/workflows/workflow-samples.ts'
import { validateWorkflow } from '../src/components/workflows/workflow-model.ts'

describe('workflow templates', () => {
  test('each is valid but for the test command the project fills in', () => {
    for (const t of WORKFLOW_TEMPLATES.filter((x) => x.name !== 'Blank')) {
      const errors = validateWorkflow(t.make('p')).filter((i) => i.level === 'error' && !i.message.includes('has no command'))
      expect({ template: t.name, errors }).toEqual({ template: t.name, errors: [] })
    }
  })

  test('they range from no loop to nested loops, none capped by default', () => {
    const loops = Object.fromEntries(WORKFLOW_TEMPLATES.map((t) => [t.name, workflowCycles(t.make('p')).length]))
    expect(loops).toEqual({
      'Straight line': 0,
      'Develop and review': 1,
      'Test first': 1,
      'Three reviewers': 1,
      'Plan, build, check': 2,
      'Split the work': 1,
      Blank: 0
    })
    for (const t of WORKFLOW_TEMPLATES) {
      const w = t.make('p')
      expect(unboundedLoops(w).length).toBe(workflowCycles(w).length)
    }
  })
})
