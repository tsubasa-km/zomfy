import { expect, test } from 'bun:test'
import { runAnswersAsks, workflowPermissionMode, type Workflow, type WorkflowRun } from '@acp-harness/protocol'

// A workflow's permission mode decides whether its steps' asks wait on the person; unset is auto.

const workflow = (permissionMode?: Workflow['permissionMode']): Workflow => ({
  id: 'w',
  projectId: 'p',
  name: 'w',
  nodes: [],
  edges: [],
  updatedAt: 0,
  ...(permissionMode ? { permissionMode } : {})
})

const run = (w: Workflow, autoApprove?: boolean): Pick<WorkflowRun, 'autoApprove' | 'workflow'> => ({
  workflow: w,
  ...(autoApprove !== undefined ? { autoApprove } : {})
})

test('an unset mode is auto, and its asks are answered for the person', () => {
  expect(workflowPermissionMode(workflow())).toBe('auto')
  expect(runAnswersAsks(run(workflow()))).toBe(true)
  expect(runAnswersAsks(run(workflow('bypassPermissions')))).toBe(true)
})

test('modes that ask the person leave the asks to them', () => {
  expect(runAnswersAsks(run(workflow('acceptEdits')))).toBe(false)
  expect(runAnswersAsks(run(workflow('default')))).toBe(false)
})

test("a comparison's own setting wins over the mode", () => {
  expect(runAnswersAsks(run(workflow('default'), true))).toBe(true)
  expect(runAnswersAsks(run(workflow(), false))).toBe(false)
})
